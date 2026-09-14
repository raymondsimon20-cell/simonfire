import type { Transaction } from './types'

export function duplicateTransactionKey(transaction: Transaction) {
  return [
    transaction.accountId,
    transaction.date,
    transaction.type,
    (transaction.symbol ?? '').trim().toUpperCase(),
    transaction.amount.toFixed(2),
    transaction.units.toFixed(6),
    transaction.description.trim().toUpperCase().replace(/\s+/g, ' '),
  ].join('|')
}

export function duplicateTransactionIds(transactions: Transaction[]) {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const transaction of transactions) {
    const key = duplicateTransactionKey(transaction)
    if (seen.has(key)) duplicates.add(transaction.id)
    else seen.add(key)
  }
  return duplicates
}
