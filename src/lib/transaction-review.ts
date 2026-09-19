import type { Transaction } from './types'

export function duplicateTransactionKey(transaction: Transaction) {
  // Schwab can post multiple same-day cash dividends without a payer symbol.
  // Those rows cannot be safely matched, so they must remain separate until a
  // symbol is assigned rather than being treated as duplicate imports.
  if (transaction.type === 'Dividend' && !(transaction.symbol ?? '').trim()) return ''
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
    if (!key) continue
    if (seen.has(key)) duplicates.add(transaction.id)
    else seen.add(key)
  }
  return duplicates
}

export function isClosingSale(transaction: Transaction) {
  if (transaction.type !== 'Sell') return false
  if (transaction.positionEffect === 'Opening') return false
  if (transaction.positionEffect === 'Closing') return true
  const description = transaction.description.toUpperCase().replace(/[_-]+/g, ' ')
  if (/\bSELL(?:S)? TO OPEN\b|\bSTO\b|\bSELL SHORT\b|\bSHORT SALE\b/.test(description)) return false
  if (/\bSELL(?:S)? TO CLOSE\b|\bSTC\b/.test(description)) return true
  // Legacy Schwab option rows were stored only as "TRADE" and did not retain
  // positionEffect. Their opening/closing direction cannot be established, so
  // do not falsely report them as missing realized P/L.
  const symbol = (transaction.symbol ?? '').replace(/\s+/g, '').toUpperCase()
  if (/^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(symbol)) return false
  return true
}
