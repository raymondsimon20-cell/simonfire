import type { Account, Transaction, TransactionOverride, TxnType } from './types'

type Overrides = Record<string, TransactionOverride>
const normalize = (text: string) => text.trim().toUpperCase().replace(/\s+/g, ' ')

// Type is intentionally absent: changing a category must not change identity.
// Occurrence distinguishes identical CSV rows; broker IDs distinguish live fills
// even when Schwab returns them in a different order on the next sync.
export function transactionOverrideKeys(transactions: Transaction[], accounts: Account[]) {
  const counts = new Map<string, number>()
  return transactions.map((row) => {
    const account = accounts.find((item) => item.id === row.accountId)
    const accountKey = account ? `${account.broker}:${account.mask.replace(/\D/g, '')}` : row.accountId
    const fingerprint = JSON.stringify([accountKey, row.date, normalize(row.symbol ?? ''), normalize(row.description), row.amount.toFixed(2), row.units.toFixed(6)])
    const occurrence = counts.get(fingerprint) ?? 0
    counts.set(fingerprint, occurrence + 1)
    return {
      primary: row.brokerTransactionId ? JSON.stringify([accountKey, row.brokerTransactionId]) : `${fingerprint}:${occurrence}`,
      legacy: `${fingerprint}:${occurrence}`,
    }
  })
}

export function mergeTransactionOverrides(current: Overrides = {}, incoming: Overrides = {}): Overrides {
  const merged = { ...current }
  for (const [key, value] of Object.entries(incoming)) {
    if (!merged[key] || value.updatedAt > merged[key].updatedAt) merged[key] = value
  }
  return merged
}

export function recordTransactionOverride(transactions: Transaction[], accounts: Account[], overrides: Overrides, ids: string | string[], patch: Omit<TransactionOverride, 'updatedAt'>, updatedAt = new Date().toISOString()): Overrides {
  const selected = new Set(typeof ids === 'string' ? [ids] : ids)
  const keys = transactionOverrideKeys(transactions, accounts)
  const next = { ...overrides }
  transactions.forEach((row, index) => {
    if (!selected.has(row.id)) return
    const { primary, legacy } = keys[index]
    next[primary] = { ...(overrides[primary] ?? overrides[legacy]), ...patch, updatedAt }
  })
  return next
}

export function applyTransactionOverrides(transactions: Transaction[], accounts: Account[], overrides: Overrides = {}) {
  const keys = transactionOverrideKeys(transactions, accounts)
  transactions.forEach((row, index) => {
    const { primary, legacy } = keys[index]
    const edit = overrides[primary] ?? overrides[legacy]
    if (!edit) return
    if (edit.type) { row.type = edit.type; row.classificationSource = 'manual' }
    if (edit.symbol) { row.symbol = edit.symbol; row.symbolSource = 'manual' }
    if (edit.duplicateReviewed != null) row.duplicateReviewed = edit.duplicateReviewed
    if (edit.tags) row.tags = [...edit.tags]
  })
}

// Recover edits still present in browsers that used the old row-only format.
export function migrateTransactionOverrides(transactions: Transaction[], accounts: Account[], overrides: Overrides = {}): Overrides {
  const migrated = { ...overrides }
  const keys = transactionOverrideKeys(transactions, accounts)
  transactions.forEach((row, index) => {
    const { primary, legacy } = keys[index]
    if (migrated[primary] || migrated[legacy]) return
    if (row.classificationSource !== 'manual' && row.symbolSource !== 'manual' && !row.duplicateReviewed) return
    migrated[primary] = { updatedAt: '1970-01-01T00:00:00.000Z',
      ...(row.classificationSource === 'manual' ? { type: row.type } : {}),
      ...(row.symbolSource === 'manual' && row.symbol ? { symbol: row.symbol } : {}),
      ...(row.duplicateReviewed ? { duplicateReviewed: true } : {}),
    }
  })
  return migrated
}

const categories = new Set<TxnType>(['Buy', 'Sell', 'Dividend', 'Interest', 'Contribution', 'Withdrawal', 'Bill Payment', 'Transfer', 'Fee', 'Tax Withholding', 'Corporate Action', 'Other'])

export function cleanTransactionOverrides(input: unknown): Overrides {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const result: Overrides = {}
  for (const [key, value] of Object.entries(input).slice(0, 20_000)) {
    if (key.length > 2_000 || !value || typeof value !== 'object') continue
    const row = value as TransactionOverride
    if (typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) continue
    const cleaned: TransactionOverride = { updatedAt: new Date(row.updatedAt).toISOString() }
    if (row.type && categories.has(row.type)) cleaned.type = row.type
    if (typeof row.symbol === 'string' && /^[A-Z0-9./^-]{1,32}$/i.test(row.symbol.trim())) cleaned.symbol = row.symbol.trim().toUpperCase()
    if (typeof row.duplicateReviewed === 'boolean') cleaned.duplicateReviewed = row.duplicateReviewed
    if (Array.isArray(row.tags)) cleaned.tags = row.tags.filter((tag) => typeof tag === 'string' && tag.length <= 160).slice(0, 100)
    if (cleaned.type || cleaned.symbol || cleaned.duplicateReviewed != null || cleaned.tags) Object.defineProperty(result, key, { value: cleaned, enumerable: true, configurable: true, writable: true })
  }
  return result
}
