import type { Account, StatementTransactions, Transaction, TxnType } from './types'
import { statementAccount } from './statement-history'

export interface PdfTextItem { str: string; x: number; y: number; width: number }
export interface PdfTextPage { page: number; items: PdfTextItem[] }
const normalize = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '')
const money = (text: string): number | undefined => {
  const cleaned = text.replace(/\((?:ST|LT)\)|[⁺†‡,\s$]/g, '')
  if (!cleaned || cleaned === '-') return undefined
  if (!/^\(?-?\d+(?:\.\d+)?\)?$/.test(cleaned)) return undefined
  const number = Number(cleaned.replace(/[()]/g, '')) * (cleaned.startsWith('(') ? -1 : 1)
  return Number.isFinite(number) ? number : undefined
}
const categoryPattern = /^(?:(\d{2}\/\d{2})\s*)?(Purchase|Sale|Dividend|Interest|Withdrawal|Deposit|Redemption|Expense|Other)\b/

// Use the PDF's actual columns, not whitespace or the last number on a line.
// Amount, quantity, fee and realized P/L are independent fields.
export function parseStatementTransactions(pages: PdfTextPage[], month: string, accountMask: string, fileName: string): StatementTransactions {
  const result: StatementTransactions = { accountMask, month, fileName, importedAt: new Date().toISOString(), transactions: [], issues: [], complete: false }
  let date = '', current: { page: number; row: number; cells: string[] } | undefined
  let total: number | undefined, rowNumber = 0, found = false
  const occurrences = new Map<string, number>()
  const flush = () => {
    if (!current) return
    const { page, row, cells } = current
    current = undefined
    const [left, description, qtyText, priceText, feeText, amountText, plText] = cells.map((cell) => cell.trim().replace(/ +/g, ' '))
    const match = left.match(categoryPattern)
    if (!match) return
    if (match[1]) date = `${month.slice(0, 4)}-${match[1].replace('/', '-')}`
    const category = match[2], action = left.slice(match[0].length).trim()
    const amount = money(amountText), units = money(qtyText), price = money(priceText), fee = money(feeText), pl = money(plText)
    const day = Number(date.slice(-2))
    const dateValid = date.startsWith(month + '-') && day >= 1 && day <= new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()
    let type: TxnType = category === 'Purchase' ? 'Buy' : category === 'Sale' ? 'Sell' : category === 'Dividend' ? 'Dividend' : category === 'Deposit' ? 'Contribution' : category === 'Withdrawal' ? 'Withdrawal' : category === 'Expense' ? 'Fee' : category === 'Interest' ? 'Interest' : 'Corporate Action'
    if (/Tax Withheld/i.test(action)) type = 'Tax Withholding'
    if (/Margin Interest/i.test(action + ' ' + description)) type = 'Interest'
    // Symbols occupy their own column, except PDF.js sometimes joins them to
    // the action. The extraction below marks that boundary with a tab.
    const symbolText = left.split('\t').slice(1).join(' ').trim()
    const option = symbolText.match(/^([A-Z.]+)\s+(\d{2})\/(\d{2})\/(\d{4})\s+([\d.]+)\s+([CP])$/)
    const securityId = symbolText && /^[A-Z0-9*@#]{8}\d$/.test(symbolText) ? symbolText : undefined
    const symbol = option ? `${option[1].padEnd(6)}${option[4].slice(-2)}${option[2]}${option[3]}${option[6]}${Math.round(Number(option[5]) * 1000).toString().padStart(8, '0')}`
      : !securityId && symbolText && /^[A-Z][A-Z0-9./^-]{0,15}$/.test(symbolText) ? symbolText : undefined
    const invalid = !dateValid || (amount == null && category !== 'Other') ||
      (!!qtyText && units == null) || (!!priceText && price == null) || (!!feeText && fee == null) || (!!plText && pl == null) ||
      (['Buy', 'Sell'].includes(type) && (!units || (!symbol && !securityId))) ||
      (!!symbolText && !symbol && !securityId)
    if (invalid) { result.issues.push(`Page ${page}, row ${row}: incomplete or unsupported transaction fields.`); return }
    const cash = amount ?? 0
    if ((type === 'Buy' && cash > 0) || (type === 'Sell' && cash < 0)) { result.issues.push(`Page ${page}, row ${row}: trade cash direction needs review.`); return }
    if (['Buy', 'Sell'].includes(type) && price != null) {
      const expected = Math.abs(units ?? 0) * price * (option ? 100 : 1) + (type === 'Buy' ? 1 : -1) * Math.abs(fee ?? 0)
      if (Math.abs(Math.abs(cash) - expected) > 0.05 + Math.abs(units ?? 0) * 0.0001) { result.issues.push(`Page ${page}, row ${row}: quantity, price and cash do not reconcile.`); return }
    }
    const fingerprint = `${accountMask}|${month}|${date}|${type}|${symbol || securityId || normalize(description)}|${cash.toFixed(2)}|${(units ?? 0).toFixed(6)}`
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1
    occurrences.set(fingerprint, occurrence)
    const key = `${fingerprint}|${occurrence}`
    result.transactions.push({ date, type, symbol, securityId, securityName: description,
      description: `${category} ${action.replace(/\t.*$/, '')} ${description}`.replace(/\s+/g, ' ').trim(),
      amount: cash, units: type === 'Sell' ? -Math.abs(units ?? 0) : units ?? 0,
      ...(fee != null ? { fee: Math.abs(fee) } : {}), ...(price != null ? { price } : {}),
      ...(option ? { strike: Number(option[5]), exp: `${option[4]}-${option[2]}-${option[3]}` } : {}),
      ...(option && pl != null ? { positionEffect: 'Closing' } : {}),
      ...(pl != null ? { pl, plSource: 'statement', plEstimated: false } : {}),
      tags: [], dataSource: 'statement', classificationSource: 'schwab', symbolSource: symbol ? 'broker' : undefined,
      statement: { key, fileName, page, row, date },
    })
  }
  for (const page of pages) {
    const items = page.items.filter((item) => item.str.trim())
    const title = items.find((item) => /^Transaction Details\b/.test(item.str))
    if (!title) continue
    found = true
    const header = (label: string) => items.find((item) => item.str.trim() === label && item.y < title.y && item.y > title.y - 45)
    const category = header('Category'), description = header('Description'), symbol = header('CUSIP'), quantity = header('Quantity'), price = header('per Share($)'), fee = header('Interest($)'), amount = header('Amount($)'), pl = header('Gain/(Loss)($)')
    if (!category || !description || !symbol || !quantity || !price || !fee || !amount || !pl) { result.issues.push(`Page ${page.page}: transaction columns were not recognized.`); continue }
    const ends = [quantity, price, fee, amount, pl].map((item) => item.x + item.width + 7)
    const content = items.filter((item) => item.y < category.y - 5 && item.y > 30).sort((a, b) => b.y - a.y || a.x - b.x)
    const lines: PdfTextItem[][] = []
    for (const item of content) {
      const line = lines.at(-1)
      if (line && Math.abs(line[0].y - item.y) < 1.5) line.push(item)
      else lines.push([item])
    }
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x)
      if (line.some((item) => /^Total Transactions\b/.test(item.str))) {
        flush()
        const cashItem = line.find((item) => item.x > fee.x + fee.width && item.x + item.width <= ends[3] && money(item.str) != null)
        total = cashItem ? money(cashItem.str) : undefined
        break
      }
      if (line.some((item) => item.x < category.x && /^(?:Date column|Margin Interest|Pending|Endnotes|Bank Sweep)/.test(item.str))) { flush(); break }
      const start = line.find((item) => item.x <= category.x + 1 && categoryPattern.test(item.str))
      if (!start && line.some((item) => item.x <= category.x + 1 && /^(?:\d{2}\/\d{2}|[A-Z][a-z])/.test(item.str) && item.str !== 'Activity')) {
        result.issues.push(`Page ${page.page}: an unsupported transaction category needs review.`)
      }
      if (start) { flush(); current = { page: page.page, row: ++rowNumber, cells: ['', '', '', '', '', '', ''] } }
      if (!current) continue
      for (const item of line) {
        const text = item.str.trim()
        if (/^\((?:ST|LT)\)[,]?$/.test(text)) continue
        if (item.x < description.x - 3) {
          if (item.x >= symbol.x - 3) current.cells[0] += '\t' + text
          else if (item.x + item.width > symbol.x + 5 && item.x >= category.x + 10 && /\s[A-Z][A-Z0-9./^-]*$/.test(text)) {
            current.cells[0] += ' ' + text.replace(/\s(\S+)$/, '\t$1')
          } else {
            const [prefix, security] = current.cells[0].split('\t')
            current.cells[0] = prefix + ' ' + text + (security ? '\t' + security : '')
          }
        } else if (item.x + item.width <= ends[0] && item.x < quantity.x - 45) current.cells[1] += ' ' + text
        else {
          const column = ends.findIndex((end) => item.x + item.width <= end)
          if (column >= 0) current.cells[column + 2] += ' ' + text
        }
      }
    }
  }
  flush()
  if (!found) result.issues.push('No transaction-detail table found. This PDF can supply balances only.')
  const actual = result.transactions.reduce((sum, row) => sum + Math.round(row.amount * 100), 0)
  if (found && total == null) result.issues.push('Could not verify the Total Transactions amount. Transaction import is held for review.')
  else if (total != null && Math.abs(actual - Math.round(total * 100)) > 1) result.issues.push(`Transaction cash total differs from the statement by $${(Math.abs(actual - Math.round(total * 100)) / 100).toFixed(2)}. Transaction import is held for review.`)
  result.complete = found && total != null && result.issues.length === 0
  return result
}

export function mergeStatementTransactions(current: StatementTransactions[] = [], incoming: StatementTransactions[] = []) {
  const groups = new Map<string, StatementTransactions>()
  for (const group of [...current, ...incoming]) {
    const key = `${group.accountMask}|${group.month}`
    if (!groups.has(key) || group.importedAt >= groups.get(key)!.importedAt) groups.set(key, group)
  }
  return [...groups.values()]
}

export function reconcileStatementTransactions(accounts: Account[], existing: Transaction[], groups: StatementTransactions[]) {
  const importedKeys = new Set(groups.filter((group) => group.complete).flatMap((group) => group.transactions.map((row) => row.statement?.key)))
  existing = existing.filter((row) => !row.statement || !!row.brokerTransactionId || importedKeys.has(row.statement.key) || !groups.some((group) => group.complete && group.month === row.statement?.date.slice(0, 7) && statementAccount(group, accounts)?.id === row.accountId))
  const transactions = existing.map((row) => ({ ...row }))
  const used = new Set<number>()
  let added = 0, matched = 0, ambiguous = 0
  const pending: { fileName: string; page: number; date: string; symbol?: string; amount: number }[] = []
  const cents = (value: number) => Math.round(value * 100)
  for (const group of groups) {
    if (!group.complete) continue
    const account = statementAccount(group, accounts)
    if (!account) continue
    for (const row of group.transactions) {
      const candidates = existing.flatMap((old, index) => {
        if (used.has(index) || old.accountId !== account.id) return []
        if (old.statement?.key === row.statement?.key) return [{ index, score: 10 }]
        if (cents(old.amount) !== cents(row.amount) || Math.abs(Math.abs(old.units) - Math.abs(row.units)) > 0.0001) return []
        const trade = ['Buy', 'Sell'].includes(row.type)
        const gap = (Date.parse(row.date) - Date.parse(old.date)) / 86_400_000
        if (old.date !== row.date && !(trade && gap > 0 && gap <= 7)) return []
        const sameSecurity = !!row.symbol && normalize(old.symbol ?? '') === normalize(row.symbol) || !!row.securityId && old.securityId === row.securityId
        const cashFlow = ['Contribution', 'Withdrawal', 'Transfer', 'Bill Payment', 'Other']
        const compatible = old.type === row.type || old.type === 'Other' || old.classificationSource === 'manual' ||
          (cashFlow.includes(old.type) && cashFlow.includes(row.type)) ||
          (sameSecurity && ((row.type === 'Tax Withholding' && ['Dividend', 'Fee', 'Withdrawal'].includes(old.type)) || (trade && old.type === 'Dividend')))
        if (!compatible) return []
        if (old.symbol && row.symbol && !sameSecurity && old.symbolSource !== 'inferred' && old.symbolSource !== 'manual') return []
        if (trade && !sameSecurity && old.symbolSource !== 'manual') return []
        return [{ index, score: (sameSecurity ? 4 : 0) + (old.date === row.date ? 2 : 0) + (old.type === row.type ? 1 : 0) }]
      }).sort((a, b) => b.score - a.score)
      const best = candidates.filter((candidate) => candidate.score === candidates[0]?.score)
      const signatures = new Set(best.map(({ index }) => { const t = existing[index]; return `${t.date}|${t.type}|${t.symbol ?? ''}|${normalize(t.description)}` }))
      const competing = group.transactions.some((other) => other !== row && other.date === row.date && cents(other.amount) === cents(row.amount) && Math.abs(other.units) === Math.abs(row.units) && (other.symbol ?? other.securityId) !== (row.symbol ?? row.securityId))
      // A statement trade may aggregate API fills. Without an exact one-to-one
      // match, hold possible overlapping fills rather than add another trade.
      const possibleFills = !best.length && ['Buy', 'Sell'].includes(row.type) && existing.some((old, index) => {
        const gap = (Date.parse(row.date) - Date.parse(old.date)) / 86_400_000
        return !used.has(index) && old.accountId === account.id && old.type === row.type && normalize(old.symbol ?? '') === normalize(row.symbol ?? '') && gap >= 0 && gap <= 7 && Math.sign(old.amount) === Math.sign(row.amount) && Math.abs(old.units) <= Math.abs(row.units)
      })
      const uncertain = possibleFills || best.length > 0 && (signatures.size > 1 || (competing && best[0].score < 4))
      if (uncertain) { ambiguous++; pending.push({ fileName: group.fileName, page: row.statement?.page ?? 0, date: row.date, symbol: row.symbol, amount: row.amount }); continue }
      const index = best[0]?.index
      const old = index == null ? undefined : transactions[index]
      const merged: Transaction = { ...old, ...row, id: old?.id ?? `statement-${row.statement!.key}`, accountId: account.id,
        brokerTransactionId: old?.brokerTransactionId, date: old?.date ?? row.date,
        tags: [...new Set([...(old?.tags ?? []), ...row.tags])],
        pl: old?.plSource === 'manual' ? old.pl : row.pl ?? old?.pl,
        plSource: old?.plSource === 'manual' ? 'manual' : row.plSource ?? old?.plSource,
        plEstimated: old?.plSource === 'manual' ? false : row.pl != null ? false : old?.plEstimated,
        ...(old?.classificationSource === 'manual' ? { type: old.type, classificationSource: 'manual' } : {}),
        ...(old?.symbolSource === 'manual' ? { symbol: old.symbol, symbolSource: 'manual' } : {}),
      }
      if (index == null) { transactions.push(merged); added++ } else { used.add(index); transactions[index] = merged; matched++ }
    }
  }
  return { transactions: transactions.sort((a, b) => b.date.localeCompare(a.date)), added, matched, ambiguous, pending }
}
