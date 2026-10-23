import { strict as assert } from 'node:assert'
import { readReviewCache, writeReviewCache, type ReviewStorage } from '../src/lib/review-cache'
const values = new Map<string, string>()
const storage: ReviewStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }
const original = { 'live:all': { review: { summary: 'Saved analysis' }, createdAt: 1000 }, 'live:account-a': { review: { summary: 'Account analysis' }, createdAt: 2000 } }
assert.equal(writeReviewCache(storage, 'reviews', original), true)
assert.deepEqual(readReviewCache(storage, 'reviews', {}), original, 'a fresh mount restores all scopes')
assert.deepEqual(JSON.parse(values.get('reviews')!).value, original, 'save happens before navigation, without an effect')
assert.equal(writeReviewCache(storage, 'shortlists', { all: { key: 'original-evidence', symbols: ['ABC'], expiresAt: 5000 } }), true)
assert.deepEqual(readReviewCache(storage, 'shortlists', {}), { all: { key: 'original-evidence', symbols: ['ABC'], expiresAt: 5000 } }, 'restoration preserves expiry rather than granting another day')
const pending = { all: [{ transactionId: 't1', fingerprint: 'original-input', category: 'Fee', reason: 'Account charge', confidence: 'high' }] }
writeReviewCache(storage, 'categories', pending)
assert.deepEqual(readReviewCache(storage, 'categories', {}), pending)
writeReviewCache(storage, 'categories', { all: [] })
assert.deepEqual(readReviewCache(storage, 'categories', {}), { all: [] }, 'dismissed suggestions do not reappear after refresh')
const inputs = { 'live:all': { contribution: 3500, mode: 'rebalance', wholeShares: false, account: 'a1' } }
writeReviewCache(storage, 'inputs', inputs)
assert.deepEqual(readReviewCache(storage, 'inputs', {}), inputs, 'restored planning inputs match the saved review')
values.set('broken', '{bad json')
assert.deepEqual(readReviewCache(storage, 'broken', {}), {})
values.set('wrong-version', JSON.stringify({ version: 99, value: original }))
assert.deepEqual(readReviewCache(storage, 'wrong-version', {}), {})
const failed: ReviewStorage = { getItem: () => { throw new Error('unavailable') }, setItem: () => { throw new Error('quota') } }
assert.deepEqual(readReviewCache(failed, 'reviews', {}), {})
assert.equal(writeReviewCache(failed, 'reviews', original), false, 'storage failures are reported rather than silently treated as saved')
console.log('Review cache navigation/refresh restoration, account scopes, unchanged expiry, dismissal, corruption and quota checks passed')
