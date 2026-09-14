import type { Account, CsvPositionAuthority, CsvTransactionAuthority, Position, Transaction } from './types'

const securityKey = (value?: string) => (value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
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
  const accountByMask = new Map(accounts.map((account) => [account.mask, account]))
  const positions: Position[] = apiPositions.map((position) => ({ ...position, dataSource: 'api' }))
  const positionIndex = new Map(positions.map((position, index) => [`${accountMask(accounts, position.accountId)}|${securityKey(position.symbol)}`, index]))
  for (const row of csvPositions) {
    const account = accountByMask.get(row.accountMask)
    if (!account) continue
    const key = `${row.accountMask}|${securityKey(row.position.symbol)}`
    const index = positionIndex.get(key)
    const api = index == null ? undefined : positions[index]
    // A live API position list owns current inventory. A CSV-only position is
    // retained only while viewing an imported dataset before a live sync.
    if (!api && !includeCsvOnlyPositions) continue
    if (api && Math.abs(api.avgCost - row.position.avgCost) > 0.005) conflicts++
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
  transactions.forEach((transaction, index) => {
    const key = transactionAuthorityKey(accountMask(accounts, transaction.accountId), transaction)
    transactionIndex.set(key, [...(transactionIndex.get(key) ?? []), index])
  })
  for (const row of csvTransactions) {
    const account = accountByMask.get(row.accountMask)
    if (!account) continue
    const key = transactionAuthorityKey(row.accountMask, row.transaction)
    const index = transactionIndex.get(key)?.shift()
    const api = index == null ? undefined : transactions[index]
    if (api && (api.type !== row.transaction.type || api.description !== row.transaction.description || (api.pl ?? null) !== (row.transaction.pl ?? null))) conflicts++
    const merged: Transaction = {
      ...api,
      ...row.transaction,
      id: api?.id ?? `csv-txn-${key}`,
      accountId: account.id,
      tags: [...new Set([...(api?.tags ?? []), ...row.transaction.tags])],
      dataSource: 'csv',
    }
    if (index == null) transactions.push(merged)
    else transactions[index] = merged
  }
  transactions.sort((a, b) => b.date.localeCompare(a.date))
  return { positions, transactions, conflicts }
}
