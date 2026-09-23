import type { Transaction } from './types'

// Report the visible ledger after PDF/CSV and manual reconciliation. Server
// pre-reconciliation counters can describe hundreds of already-repaired rows.
export function dividendLookupStatus(transactions: Transaction[], accountId: string) {
  const missing = transactions.filter((row) => row.accountId === accountId && row.type === 'Dividend' && !row.symbol)
  return {
    missing: missing.length,
    deferred: missing.filter((row) => row.dividendLookupState === 'deferred').length,
    unavailable: missing.filter((row) => row.dividendLookupState === 'unavailable').length,
    unmatched: missing.filter((row) => row.dividendLookupState === 'unmatched').length,
  }
}
