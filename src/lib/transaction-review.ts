import type { Transaction } from './types'

export function duplicateTransactionKey(transaction: Transaction) {
  // Distinct statement line numbers are evidence of distinct posted events.
  if (transaction.statement) return `${transaction.accountId}|statement|${transaction.statement.key}`
  // Schwab can post multiple same-day cash dividends without a payer symbol.
  // Those rows cannot be safely matched, so they must remain separate until a
  // symbol is assigned rather than being treated as duplicate imports.
  if ((transaction.type === 'Dividend' && !(transaction.symbol ?? '').trim()) || transaction.type === 'Transfer' || transaction.type === 'Other' || transaction.type === 'Interest') return ''
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
    if (transaction.duplicateReviewed) continue
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

// Store the exact material facts approved by the user. Derived status reopens
// automatically after edits or sync without discarding the original review date.
export function transactionReviewFingerprint(t: Transaction) {
  return JSON.stringify([t.accountId, t.date, t.type, t.symbol ?? '', t.amount, t.units,
    t.fee ?? null, t.pl ?? null, t.plEstimated ?? false, t.positionEffect ?? '',
    t.strike ?? null, t.exp ?? '', t.description, t.fundingReview ?? null])
}

const reviewDateFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })

function reviewToday() {
  const parts = reviewDateFormatter.formatToParts(new Date())
  const part = (type: string) => parts.find((p) => p.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function automaticReviewCutoff(asOf = reviewToday()) {
  const date = new Date(`${asOf}T12:00:00Z`)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() - 4)
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, end))
  return date.toISOString().slice(0, 10)
}

export function isTransactionAutoReviewed(t: Transaction, asOf?: string) {
  // Explicit undo and manual approvals take precedence over the age policy.
  if (t.review !== undefined || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) return false
  const parsed = new Date(`${t.date}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === t.date
    && t.date < automaticReviewCutoff(asOf)
}

export function isTransactionReviewed(t: Transaction, asOf?: string) {
  return isTransactionAutoReviewed(t, asOf) || (!!t.review && t.review.fingerprint === transactionReviewFingerprint(t))
}
