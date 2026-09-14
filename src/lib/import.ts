// Import real portfolio data from Schwab CSV exports (positions & transactions).
// Tolerant of Schwab's title rows, per-account sections, $-formatted numbers,
// parenthesised negatives, and "N/A" / "--" placeholders.

import type { Account, AccountType, Position, Transaction, TxnType } from './types'
import { classifySchwabTransaction } from './transaction-classification'
import { dividendDescriptionKey } from './dividend-symbol'
import { isClosingSale } from './transaction-review'

export interface ImportFallback {
  broker: string
  name: string
  mask: string
  isMargin: boolean
}

export interface ImportResult {
  accounts: Account[]
  positions: Position[]
  transactions: Transaction[]
  warnings: string[]
}

export interface DividendEnrichmentMatch {
  transactionId: string
  symbol: string
  date: string
  amount: number
  description: string
}

export interface DividendEnrichmentPreview {
  matches: DividendEnrichmentMatch[]
  ambiguous: Transaction[]
  unmatched: Transaction[]
  csvDividendCount: number
}

export interface RealizedPlMatch { transactionId: string; symbol: string; date: string; proceeds: number; pl: number }
export interface RealizedPlPreview { matches: RealizedPlMatch[]; ambiguous: number; unmatched: number; rows: number }

export function previewDividendEnrichment(imported: ImportResult, existingAccounts: Account[], existingTransactions: Transaction[]): DividendEnrichmentPreview {
  const importedAccounts = new Map(imported.accounts.map((account) => [account.id, account]))
  const used = new Set<string>()
  const matches: DividendEnrichmentMatch[] = []
  const ambiguous: Transaction[] = []
  const unmatched: Transaction[] = []
  const csvDividends = imported.transactions.filter((transaction) => transaction.type === 'Dividend' && !!transaction.symbol)
  for (const csvTransaction of csvDividends) {
    const importedAccount = importedAccounts.get(csvTransaction.accountId)
    const accountCandidates = importedAccount?.mask
      ? existingAccounts.filter((account) => account.mask === importedAccount.mask).map((account) => account.id)
      : existingAccounts.length === 1 ? [existingAccounts[0].id] : []
    let candidates = existingTransactions.filter((transaction) =>
      !used.has(transaction.id) && transaction.type === 'Dividend' && !transaction.symbol
      && transaction.date === csvTransaction.date && Math.abs(transaction.amount - csvTransaction.amount) < 0.011,
    )
    if (accountCandidates.length) candidates = candidates.filter((transaction) => accountCandidates.includes(transaction.accountId))
    if (candidates.length > 1) {
      const csvDescription = dividendDescriptionKey(csvTransaction.description)
      const scored = candidates.map((transaction) => {
        const existingDescription = dividendDescriptionKey(transaction.description)
        const score = csvDescription === existingDescription ? 3 : csvDescription && existingDescription && (csvDescription.includes(existingDescription) || existingDescription.includes(csvDescription)) ? 2 : 0
        return { transaction, score }
      }).sort((a, b) => b.score - a.score)
      if (scored[0].score > 0 && scored[0].score > (scored[1]?.score ?? -1)) candidates = [scored[0].transaction]
    }
    if (candidates.length === 1) {
      const existing = candidates[0]
      used.add(existing.id)
      matches.push({ transactionId: existing.id, symbol: csvTransaction.symbol!.trim().toUpperCase(), date: existing.date, amount: existing.amount, description: existing.description })
    } else if (candidates.length > 1) ambiguous.push(csvTransaction)
    else unmatched.push(csvTransaction)
  }
  return { matches, ambiguous, unmatched, csvDividendCount: csvDividends.length }
}

const uid = () => 'i' + Math.random().toString(36).slice(2, 9)

// ---- CSV line parsing (handles quoted fields with embedded commas) ----
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

// ---- number cleaning ----
function toNum(raw: string | undefined): number {
  if (!raw) return 0
  let s = raw.trim()
  if (!s || s === 'N/A' || s === '--') return 0
  let neg = false
  if (/^\(.*\)$/.test(s)) {
    neg = true
    s = s.slice(1, -1)
  }
  s = s.replace(/[$,%\s]/g, '')
  const n = parseFloat(s)
  if (isNaN(n)) return 0
  return neg ? -n : n
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const securityKey = (value: string) => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()

// Find a column index by matching any of the given keywords against headers.
function colFinder(headers: string[]) {
  const H = headers.map(norm)
  return (...keys: string[]): number => {
    for (const k of keys) {
      const nk = norm(k)
      const idx = H.findIndex((h) => h === nk)
      if (idx >= 0) return idx
    }
    for (const k of keys) {
      const nk = norm(k)
      const idx = H.findIndex((h) => h.includes(nk))
      if (idx >= 0) return idx
    }
    return -1
  }
}

export function previewRealizedGainLoss(text: string, accounts: Account[], transactions: Transaction[], fallbackMask = ''): RealizedPlPreview {
  const rows = parseCsv(text)
  let header = -1
  for (let index = 0; index < rows.length; index++) {
    const joined = norm(rows[index].join('|'))
    if (joined.includes('symbol') && (joined.includes('gainloss') || joined.includes('gain') && joined.includes('loss')) && (joined.includes('datesold') || joined.includes('closeddate') || joined.includes('dateclosed'))) { header = index; break }
  }
  if (header < 0) throw new Error('Realized Gain/Loss header not found')
  const find = colFinder(rows[header])
  const cSymbol = find('symbol'); const cDate = find('date sold', 'closed date', 'date closed', 'sale date'); const cTxnDate = find('transaction closed date'); const cQty = find('quantity', 'qty'); const cProceeds = find('proceeds'); const cPl = find('gain/loss ($)', 'gain/loss', 'realized gain/loss'); const cTxnPl = find('total transaction gain/loss ($)', 'total transaction gain/loss')
  if ([cSymbol, cDate, cPl].some((index) => index < 0)) throw new Error('Required realized gain/loss columns not found')
  const groups = new Map<string, { symbol: string; date: string; quantity: number; proceeds: number; lotPl: number; transactionPl?: number }>()
  for (const cells of rows.slice(header + 1)) {
    const symbol = cells[cSymbol]?.trim() ?? ''; const date = isoDate(cTxnDate >= 0 && cells[cTxnDate]?.trim() ? cells[cTxnDate] : cells[cDate] ?? ''); const plRaw = cells[cPl]?.trim()
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !plRaw || /total/i.test(symbol)) continue
    const groupKey = `${securityKey(symbol)}|${date}`; const group = groups.get(groupKey) ?? { symbol, date, quantity: 0, proceeds: 0, lotPl: 0 }
    group.quantity += cQty >= 0 ? Math.abs(toNum(cells[cQty])) : 0; group.proceeds += cProceeds >= 0 ? Math.abs(toNum(cells[cProceeds])) : 0; group.lotPl += toNum(plRaw)
    if (cTxnPl >= 0 && cells[cTxnPl]?.trim()) group.transactionPl = toNum(cells[cTxnPl])
    groups.set(groupKey, group)
  }
  const used = new Set<string>(); const matches: RealizedPlMatch[] = []; let ambiguous = 0; let unmatched = 0
  for (const group of groups.values()) {
    const { symbol, date, quantity, proceeds } = group; const pl = group.transactionPl ?? group.lotPl
    const accountIds = fallbackMask ? accounts.filter((account) => account.mask === fallbackMask).map((account) => account.id) : accounts.length === 1 ? [accounts[0].id] : []
    let candidates = transactions.filter((transaction) => !used.has(transaction.id) && transaction.pl == null && isClosingSale(transaction) && transaction.date === date && securityKey(transaction.symbol ?? '') === securityKey(symbol))
    if (accountIds.length) candidates = candidates.filter((transaction) => accountIds.includes(transaction.accountId))
    if (quantity > 0) candidates = candidates.filter((transaction) => Math.abs(Math.abs(transaction.units) - quantity) < 0.000001)
    if (proceeds > 0) candidates = candidates.filter((transaction) => Math.abs(Math.abs(transaction.amount) + Math.abs(transaction.fee ?? 0) - proceeds) < 0.02 || Math.abs(Math.abs(transaction.amount) - proceeds) < 0.02)
    if (candidates.length === 1) { used.add(candidates[0].id); matches.push({ transactionId: candidates[0].id, symbol, date, proceeds, pl }) }
    else if (candidates.length > 1) ambiguous++
    else unmatched++
  }
  return { matches, ambiguous, unmatched, rows: groups.size }
}

// Derive an account name + mask from a Schwab section label like
// "Individual ...123" or "Roth Contributory IRA XXXX-0870".
function parseAccountLabel(label: string): { name: string; mask: string; type: AccountType; isMargin: boolean } {
  const maskMatch = label.match(/(\d{3,4})\b(?!.*\d)/)
  const mask = maskMatch ? maskMatch[1] : ''
  let name = label.replace(/\.\.\.\s*\d+/g, '').replace(/[Xx]{2,}[-\s]?\d+/g, '').replace(/\s+/g, ' ').trim()
  name = name.replace(/(as of.*$)/i, '').trim()
  if (!name) name = 'Account'
  const lower = label.toLowerCase()
  const isMargin = /margin/.test(lower)
  let type: AccountType = 'Individual'
  if (/roth/.test(lower)) type = 'Roth IRA'
  else if (/ira/.test(lower)) type = 'Traditional IRA'
  else if (/joint/.test(lower)) type = 'Joint'
  else if (isMargin) type = 'Margin'
  return { name, mask, type, isMargin }
}

// Map a Schwab "Action" to our transaction type.
function mapAction(action: string, description: string, amount: number, units: number): TxnType {
  return classifySchwabTransaction({ rawType: action, description, amount, units })
}

function isoDate(raw: string): string {
  // Schwab dates: "MM/DD/YYYY" possibly "MM/DD/YYYY as of MM/DD/YYYY"
  const first = raw.split(/as of/i)[0].trim()
  const m = first.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) {
    let [, mo, d, y] = m
    if (y.length === 2) y = '20' + y
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  // already ISO?
  const iso = first.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return iso[0]
  return first
}

export function parseSchwabFiles(
  files: { name: string; text: string }[],
  fallback: ImportFallback,
): ImportResult {
  const warnings: string[] = []
  const accountsByKey = new Map<string, Account>()
  const positions: Position[] = []
  const transactions: Transaction[] = []

  const ensureAccount = (label?: string): Account => {
    let key: string
    let meta: { name: string; mask: string; type: AccountType; isMargin: boolean }
    if (label && label.trim()) {
      meta = parseAccountLabel(label)
      key = meta.mask || meta.name
    } else {
      meta = { name: fallback.name || 'Schwab', mask: fallback.mask, type: fallback.isMargin ? 'Margin' : 'Individual', isMargin: fallback.isMargin }
      key = 'fallback'
    }
    let acc = accountsByKey.get(key)
    if (!acc) {
      acc = {
        id: 'acc_' + uid(),
        broker: fallback.broker || 'Schwab',
        name: meta.name,
        fullName: label?.trim() || `${meta.name} ${meta.mask ? '····' + meta.mask : ''}`.trim(),
        mask: meta.mask || fallback.mask || '',
        type: meta.type,
        isMargin: meta.isMargin,
        cash: 0,
        marginBalance: 0,
      }
      accountsByKey.set(key, acc)
    }
    return acc
  }

  for (const file of files) {
    const rows = parseCsv(file.text)
    if (!rows.length) {
      warnings.push(`${file.name}: empty or unreadable`)
      continue
    }
    // Determine file type: find a header row.
    let headerIdx = -1
    let kind: 'positions' | 'transactions' | null = null
    let currentAccount: Account | null = null

    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i]
      const joined = norm(cells.join('|'))
      const firstCell = cells[0]?.trim() ?? ''

      // Section header: a lone label cell (rest empty) that names an account.
      const restEmpty = cells.slice(1).every((c) => c.trim() === '')
      if (restEmpty && firstCell && !/^symbol/i.test(firstCell) && !/^date$/i.test(firstCell)) {
        if (/account|individual|roth|ira|joint|brokerage|margin|\.\.\.|xxxx|\d{3,}/i.test(firstCell) && !/transactions total|account total/i.test(firstCell)) {
          currentAccount = ensureAccount(firstCell.replace(/^positions for( account)?/i, '').replace(/^transactions for( account)?/i, ''))
        }
        continue
      }

      // Header rows. Check transactions FIRST — a Schwab transactions header also
      // has Symbol + Quantity columns, so it would otherwise match "positions".
      if (joined.includes('date') && joined.includes('action') && joined.includes('amount')) {
        headerIdx = i
        kind = 'transactions'
        continue
      }
      if (
        joined.includes('symbol') &&
        !joined.includes('action') &&
        (joined.includes('marketvalue') || joined.includes('mktval') || joined.includes('costbasis') ||
          ((joined.includes('quantity') || joined.includes('qty')) && joined.includes('price')))
      ) {
        headerIdx = i
        kind = 'positions'
        continue
      }

      if (headerIdx < 0 || !kind) continue

      const acc = currentAccount ?? ensureAccount(undefined)

      if (kind === 'positions') {
        const find = colFinder(rows[headerIdx])
        const cSym = find('symbol')
        const cDesc = find('description')
        const cQty = find('qty (quantity)', 'quantity', 'qty')
        const cPrice = find('price')
        const cPriceChg = find('price chng $ (price change $)', 'price change $', 'price chng $')
        const cMktVal = find('mkt val (market value)', 'market value', 'mkt val')
        const cCost = find('cost basis')
        const sym = cells[cSym]?.trim()
        if (!sym || /^symbol$/i.test(sym)) continue
        if (/cash & cash|cash and cash/i.test(sym)) {
          acc.cash += toNum(cells[cMktVal])
          continue
        }
        if (/account total|total|^--$/i.test(sym)) continue
        const shares = toNum(cells[cQty])
        if (shares === 0 && toNum(cells[cMktVal]) === 0) continue
        const lastPrice = toNum(cells[cPrice]) || (shares ? toNum(cells[cMktVal]) / shares : 0)
        const priceChg = cPriceChg >= 0 ? toNum(cells[cPriceChg]) : 0
        const cost = cCost >= 0 ? toNum(cells[cCost]) : shares * lastPrice
        positions.push({
          id: 'pos_' + uid(),
          accountId: acc.id,
          symbol: sym,
          name: cells[cDesc]?.trim() || sym,
          shares,
          avgCost: shares ? +(cost / shares).toFixed(4) : lastPrice,
          lastPrice,
          prevClose: +(lastPrice - priceChg).toFixed(4) || lastPrice,
          dividendsReceived: 0,
        })
      } else {
        const find = colFinder(rows[headerIdx])
        const cDate = find('date')
        const cAction = find('action')
        const cSym = find('symbol')
        const cDesc = find('description')
        const cQty = find('quantity', 'qty')
        const cFees = find('fees & comm', 'fees')
        const cAmount = find('amount')
        const cPl = find('realized gain/loss', 'gain/loss', 'profit/loss', 'p/l')
        const dateRaw = cells[cDate]?.trim()
        if (!dateRaw || /transactions total|^date$/i.test(dateRaw)) continue
        const action = cells[cAction]?.trim() ?? ''
        if (!action && !cells[cAmount]) continue
        const amount = toNum(cells[cAmount])
        let units = toNum(cells[cQty])
        const description = cells[cDesc]?.trim() || action
        let type = mapAction(action, description, amount, units)
        // Sign corrections
        if (type === 'Sell') units = -Math.abs(units)
        if (type === 'Buy') units = Math.abs(units)
        if (type === 'Contribution' && amount < 0) type = 'Withdrawal'
        transactions.push({
          id: 'txn_' + uid(),
          accountId: acc.id,
          date: isoDate(dateRaw),
          type,
          symbol: cells[cSym]?.trim() || undefined,
          description,
          amount,
          units: units || 0,
          fee: cFees >= 0 ? toNum(cells[cFees]) : undefined,
          pl: cPl >= 0 && cells[cPl]?.trim() ? toNum(cells[cPl]) : undefined,
          tags: [],
          classificationSource: type === 'Other' ? 'schwab' : 'automatic',
        })
      }
    }
  }

  // Backfill per-position lifetime dividends from imported transactions.
  const divBySymAcc = new Map<string, number>()
  for (const t of transactions) {
    if (t.type === 'Dividend' && t.symbol) {
      const k = t.accountId + '|' + t.symbol
      divBySymAcc.set(k, (divBySymAcc.get(k) ?? 0) + t.amount)
    }
  }
  for (const p of positions) {
    p.dividendsReceived = +(divBySymAcc.get(p.accountId + '|' + p.symbol) ?? 0).toFixed(2)
  }

  transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const accounts = [...accountsByKey.values()]
  if (!accounts.length) warnings.push('No accounts detected in the uploaded file(s).')
  if (!positions.length && !transactions.length)
    warnings.push('No positions or transactions were parsed — is this a Schwab CSV export?')

  return { accounts, positions, transactions, warnings }
}
