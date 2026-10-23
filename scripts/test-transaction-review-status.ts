import { strict as assert } from 'node:assert'
import type { Transaction } from '../src/lib/types'
import { transactionReviewFingerprint, isTransactionReviewed as reviewed, automaticReviewCutoff, isTransactionAutoReviewed } from '../src/lib/transaction-review'
import { recordTransactionOverride, applyTransactionOverrides, cleanTransactionOverrides, mergeTransactionOverrides } from '../src/lib/transaction-overrides'

const isTransactionReviewed = (t: Transaction) => reviewed(t, '2026-10-23')

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

assert.equal(automaticReviewCutoff('2026-10-23'), '2026-06-23')
assert.equal(automaticReviewCutoff('2026-06-30'), '2026-02-28')
assert.equal(automaticReviewCutoff('2024-06-30'), '2024-02-29')
const historical = { ...row, date: '2026-06-22', review: undefined }
assert.equal(reviewed(historical, '2026-10-23'), true)
assert.equal(isTransactionAutoReviewed(historical, '2026-10-23'), true)
assert.equal(reviewed({ ...historical, date: '2026-06-23' }, '2026-10-23'), false)
assert.equal(reviewed({ ...historical, date: '2026-06-24' }, '2026-10-23'), false)
assert.equal(reviewed({ ...historical, review: null }, '2026-10-23'), false, 'explicit undo overrides the age rule')
assert.equal(reviewed({ ...historical, date: '' }, '2026-10-23'), false)
assert.equal(reviewed({ ...historical, date: 'not-a-date' }, '2026-10-23'), false)
assert.equal(reviewed({ ...historical, date: '2026-02-30' }, '2026-10-23'), false)
const historicalManual = { ...historical, review: { reviewedAt: '2026-10-01T00:00:00Z', fingerprint: transactionReviewFingerprint(historical) } }
assert.equal(isTransactionAutoReviewed(historicalManual, '2026-10-23'), false)
assert.equal(reviewed({ ...historicalManual, amount: 999 }, '2026-10-23'), false, 'changed manually reviewed records still reopen')
const reimported = { ...historical, id: 'imported-later' }
assert.equal(reviewed(reimported, '2026-10-23'), true)
console.log('Rolling automatic reviews, cutoff boundaries, manual undo and imports passed')
