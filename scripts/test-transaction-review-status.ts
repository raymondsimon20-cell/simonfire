import { strict as assert } from 'node:assert'
import type { Transaction } from '../src/lib/types'
import { transactionReviewFingerprint, isTransactionReviewed } from '../src/lib/transaction-review'
import { recordTransactionOverride, applyTransactionOverrides, cleanTransactionOverrides, mergeTransactionOverrides } from '../src/lib/transaction-overrides'

const row: Transaction = { id: 'one', brokerTransactionId: 'broker-one', accountId: 'a', date: '2026-10-01', type: 'Sell', symbol: 'ABC', amount: 100, units: -1, description: 'Sale', pl: 10, tags: [] }
assert.equal(isTransactionReviewed(row), false)
row.review = { reviewedAt: '2026-10-15T12:00:00.000Z', fingerprint: transactionReviewFingerprint(row) }
assert.equal(isTransactionReviewed(row), true)
for (const patch of [{ amount: 101 }, { date: '2026-10-02' }, { accountId: 'b' }, { symbol: 'XYZ' }, { type: 'Buy' as const }, { pl: 11 }, { units: -2 }, { fee: 1 }, { fundingReview: { kind: 'external' as const } }]) {
  assert.equal(isTransactionReviewed({ ...row, ...patch }), false, JSON.stringify(patch))
}
assert.equal(isTransactionReviewed({ ...row, tags: ['note'], dataSource: 'api' }), true)
const edits = recordTransactionOverride([row], [], {}, row.id, { review: row.review }, '2026-10-15T12:00:00.000Z')
const persisted = cleanTransactionOverrides(JSON.parse(JSON.stringify(edits)))
const synced = { ...row, id: 'new-local-id', review: undefined }
applyTransactionOverrides([synced], [], persisted)
assert.equal(isTransactionReviewed(synced), true, 'same broker transaction retains review after sync')
const changed = { ...synced, amount: 102, review: undefined }
applyTransactionOverrides([changed], [], persisted)
assert.equal(isTransactionReviewed(changed), false, 'changed broker record reopens')
const undo = recordTransactionOverride([synced], [], persisted, synced.id, { review: null }, '2026-10-15T13:00:00.000Z')
applyTransactionOverrides([synced], [], cleanTransactionOverrides(mergeTransactionOverrides(persisted, undo)))
assert.equal(synced.review, null)
assert.equal(isTransactionReviewed(synced), false)
assert.deepEqual(cleanTransactionOverrides({ bad: { updatedAt: '2026-10-15', review: { reviewedAt: 'invalid', fingerprint: 'x' } } }), {})
console.log('Transaction review persistence, invalidation, and undo passed')
