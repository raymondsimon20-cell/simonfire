import type { Account, CsvPositionAuthority, CsvTransactionAuthority, Position, Transaction } from './types'
import { classifySchwabTransaction, normalizeTransactionPattern } from './transaction-classification'

const securityKey = (value?: string) => {
  const text = (value ?? '').trim().toUpperCase()
  const option = text.match(/^([A-Z.]+)\s+(\d{2})\/(\d{2})\/(\d{4})\s+([\d.]+)\s+([CP])$/)
  if (option) return `${option[1]}${option[4].slice(-2)}${option[2]}${option[3]}${option[6]}${Math.round(Number(option[5]) * 1000).toString().padStart(8, '0')}`
  return text.replace(/[^A-Z0-9]/g, '')
}
const cents = (value: number) => Math.round(value * 100)

function accountMask(accounts: Account[], accountId: string) {
  return accounts.find((account) => account.id === accountId)?.mask ?? ''
}

export function transactionAuthorityKey(mask: string, transaction: Pick<Transaction, 'date' | 'type' | 'symbol' | 'description' | 'amount' | 'units'>) {
  const security = securityKey(transaction.symbol) || transaction.description.trim().toUpperCase().replace(/\s+/g, ' ')
  return [mask, transaction.date, transaction.type, security, cents(transaction.amount), Math.round(Math.abs(transaction.units) * 1_000_000)].join('|')
}

export function captureCsvAuthority(accounts: Account[], positions: Position[], transactions: Transaction[], importedAt: string, importBatchId?: string) {
  return {
    positions: positions.map(({ id: _id, accountId, ...position }) => ({
      accountMask: accountMask(accounts, accountId), importedAt, importBatchId, position: { ...position, dataSource: 'csv' as const },
    })),
    transactions: transactions.map(({ id: _id, accountId, ...transaction }) => ({
      accountMask: accountMask(accounts, accountId), importedAt, importBatchId, transaction: { ...transaction, dataSource: 'csv' as const },
    })),
  }
}

export function mergePositionAuthority(current: CsvPositionAuthority[], incoming: CsvPositionAuthority[]) {
  const merged = new Map(current.map((row) => [`${row.accountMask}|${securityKey(row.position.symbol)}`, row]))
  for (const row of incoming) merged.set(`${row.accountMask}|${securityKey(row.position.symbol)}`, row)
  return [...merged.values()]
}

export function mergeTransactionAuthority(current: CsvTransactionAuthority[], incoming: CsvTransactionAuthority[]) {
  const incomingCounts = new Map<string, number>()
  for (const row of incoming) {
    const key = transactionAuthorityKey(row.accountMask, row.transaction)
    incomingCounts.set(key, (incomingCounts.get(key) ?? 0) + 1)
  }
  const retainedCounts = new Map<string, number>()
  const retained = current.filter((row) => {
    const key = transactionAuthorityKey(row.accountMask, row.transaction)
    const count = (retainedCounts.get(key) ?? 0) + 1
    retainedCounts.set(key, count)
    return count > (incomingCounts.get(key) ?? 0)
  })
  return [...incoming, ...retained]
}

export function reconcileCsvAuthority(
  accounts: Account[],
  apiPositions: Position[],
  apiTransactions: Transaction[],
  csvPositions: CsvPositionAuthority[],
  csvTransactions: CsvTransactionAuthority[],
  includeCsvOnlyPositions = false,
) {
  let conflicts = 0
  const conflictDetails: { record: string; field: string; apiValue: string; csvValue: string; winner: 'CSV' | 'API' }[] = []
  const accountByMask = new Map(accounts.map((account) => [account.mask, account]))
  // Legacy imports omitted the mask. Only infer it when there is one possible
  // destination; never assign an unidentified import across multiple accounts.
  const resolveAccount = (mask: string) => mask ? accountByMask.get(mask) : accounts.length === 1 ? accounts[0] : undefined
  const positions: Position[] = apiPositions.map((position) => ({ ...position, dataSource: 'api' }))
  const positionIndex = new Map(positions.map((position, index) => [`${accountMask(accounts, position.accountId)}|${securityKey(position.symbol)}`, index]))
  for (const row of csvPositions) {
    const account = resolveAccount(row.accountMask)
    if (!account) continue
    const key = `${account.mask}|${securityKey(row.position.symbol)}`
    const index = positionIndex.get(key)
    const api = index == null ? undefined : positions[index]
    // A live API position list owns current inventory. A CSV-only position is
    // retained only while viewing an imported dataset before a live sync.
    if (!api && !includeCsvOnlyPositions) continue
    if (api && Math.abs(api.avgCost - row.position.avgCost) > 0.005) { conflicts++; conflictDetails.push({ record: row.position.symbol, field: 'Average cost', apiValue: api.avgCost.toFixed(4), csvValue: row.position.avgCost.toFixed(4), winner: 'CSV' }) }
    const merged: Position = {
      ...api,
      ...row.position,
      id: api?.id ?? `csv-pos-${key}`,
      accountId: account.id,
      // Current inventory and market data remain live API supplements. The CSV
      // supplies the accounting identity and cost-basis snapshot.
      shares: api?.shares ?? row.position.shares,
      lastPrice: api?.lastPrice ?? row.position.lastPrice,
      prevClose: api?.prevClose ?? row.position.prevClose,
      annualDividend: api?.annualDividend ?? row.position.annualDividend,
      indicatedYield: api?.indicatedYield ?? row.position.indicatedYield,
      lastDividend: api?.lastDividend ?? row.position.lastDividend,
      dividendPayDate: api?.dividendPayDate ?? row.position.dividendPayDate,
      dataSource: 'csv',
    }
    if (index == null) { positionIndex.set(key, positions.length); positions.push(merged) }
    else positions[index] = merged
  }

  const transactions: Transaction[] = apiTransactions.map((transaction) => ({ ...transaction, dataSource: 'api' }))
  const transactionIndex = new Map<string, number[]>()
  const used = new Set<number>()
  transactions.forEach((transaction, index) => {
    const key = transactionAuthorityKey(accountMask(accounts, transaction.accountId), transaction)
    transactionIndex.set(key, [...(transactionIndex.get(key) ?? []), index])
  })
  for (const row of csvTransactions) {
    const account = resolveAccount(row.accountMask)
    if (!account) continue
    const key = transactionAuthorityKey(account.mask, row.transaction)
    let index = transactionIndex.get(key)?.find((i) => !used.has(i))
    if (index == null) {
      // API and CSV descriptions/categories/tickers can differ for the same
      // cash event. Match only within account/date/cash/quantity and prefer a
      // shared security or normalized description; consume each row once.
      const candidates = apiTransactions.flatMap((t, i) => {
        if (used.has(i) || t.accountId !== account.id || t.date !== row.transaction.date ||
          cents(t.amount) !== cents(row.transaction.amount) ||
          Math.abs(Math.abs(t.units) - Math.abs(row.transaction.units)) > 0.000001) return []
        const sameSymbol = !!t.symbol && securityKey(t.symbol) === securityKey(row.transaction.symbol)
        const descriptionKey = (s: string) => normalizeTransactionPattern(s).replace(/[^A-Z0-9]/g, '')
        const sameDescription = descriptionKey(t.description) === descriptionKey(row.transaction.description)
        const compatible = t.type === row.transaction.type || t.type === 'Other' || row.transaction.type === 'Other' ||
          [t.type, row.transaction.type].every((type) => ['Other', 'Transfer', 'Contribution', 'Withdrawal', 'Bill Payment'].includes(type))
        if (!compatible) return []
        // Conflicting trade symbols are different securities. Dividend symbols
        // may be inferred incorrectly by the API; CSV supplies the actual payer.
        if (['Buy', 'Sell'].includes(t.type) && t.symbol && row.transaction.symbol && !sameSymbol) return []
        return [{ i, score: sameSymbol ? 2 : sameDescription ? 1 : 0 }]
      }).sort((a, b) => b.score - a.score)
      if (candidates.length === 1 || candidates[0]?.score > 0) index = candidates[0]?.i
    }
    if (index == null && ['Buy', 'Sell'].includes(row.transaction.type)) {
      // Schwab CSV can aggregate multiple API fills into a single trade. Match
      // exact proceeds AND quantity before retaining the original fills.
      const candidates = apiTransactions.flatMap((t, i) => !used.has(i) && t.accountId === account.id &&
        t.date === row.transaction.date && t.type === row.transaction.type &&
        securityKey(t.symbol) === securityKey(row.transaction.symbol) ? [{ t, i }] : [])
      const targetCash = Math.abs(cents(row.transaction.amount))
      const targetUnits = Math.round(Math.abs(row.transaction.units) * 1_000_000)
      let budget = 20000
      const match = (at: number, cash: number, units: number, chosen: number[]): number[] | null => {
        if (cash === targetCash && units === targetUnits && chosen.length > 1) return chosen
        if (--budget < 0 || at >= candidates.length || cash > targetCash || units > targetUnits) return null
        const { t, i } = candidates[at]
        return match(at + 1, cash + Math.abs(cents(t.amount)), units + Math.round(Math.abs(t.units) * 1_000_000), [...chosen, i]) || match(at + 1, cash, units, chosen)
      }
      const fills = match(0, 0, 0, [])
      if (fills) {
        let assignedPl = 0
        fills.forEach((i, j) => {
          used.add(i)
          if (row.transaction.pl != null) {
            const pl = j === fills.length - 1 ? row.transaction.pl - assignedPl :
              Math.round(row.transaction.pl * Math.abs(transactions[i].units / row.transaction.units) * 100) / 100
            assignedPl += pl
            transactions[i] = { ...transactions[i], pl, plSource: 'csv', plEstimated: row.transaction.plEstimated, dataSource: 'csv' }
          }
        })
        continue
      }
    }
    if (index != null) used.add(index)
    const api = index == null ? undefined : transactions[index]
    if (api) {
      const record = `${row.transaction.symbol ?? row.transaction.type} · ${row.transaction.date}`
      if (api.type !== row.transaction.type) { conflicts++; conflictDetails.push({ record, field: 'Type', apiValue: api.type, csvValue: row.transaction.type, winner: 'CSV' }) }
      if (api.description !== row.transaction.description) { conflicts++; conflictDetails.push({ record, field: 'Description', apiValue: api.description, csvValue: row.transaction.description, winner: 'CSV' }) }
      if ((api.pl ?? null) !== (row.transaction.pl ?? null) && row.transaction.pl != null) { conflicts++; conflictDetails.push({ record, field: 'Realized P/L', apiValue: api.pl == null ? 'Missing' : api.pl.toFixed(2), csvValue: row.transaction.pl.toFixed(2), winner: 'CSV' }) }
    }
    const merged: Transaction = {
      ...api,
      ...row.transaction,
      id: api?.id ?? `csv-txn-${key}`,
      accountId: account.id,
      symbol: api && ['Buy', 'Sell'].includes(api.type) ? api.symbol : row.transaction.symbol,
      tags: [...new Set([...(api?.tags ?? []), ...row.transaction.tags])],
      pl: row.transaction.pl ?? api?.pl,
      plEstimated: row.transaction.pl != null ? row.transaction.plEstimated : api?.plEstimated,
      plSource: row.transaction.pl != null ? (row.transaction.plSource ?? 'csv') : api?.plSource,
      dataSource: 'csv',
    }
    if (['Other', 'Transfer'].includes(merged.type) && !['manual', 'rule'].includes(merged.classificationSource ?? '')) {
      const type = classifySchwabTransaction({ description: merged.description, amount: merged.amount, units: merged.units })
      if (type !== 'Other') merged.type = type
    }
    if (index == null) transactions.push(merged)
    else transactions[index] = merged
  }
  transactions.sort((a, b) => b.date.localeCompare(a.date))
  return { positions, transactions, conflicts, conflictDetails: conflictDetails.slice(0, 100) }
}
