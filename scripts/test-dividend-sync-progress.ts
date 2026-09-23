import assert from 'node:assert/strict'
import { resolveDividendSymbolsFromApi, type DividendLookupCache } from '../netlify/functions/lib/dividend-api'
import { applySavedDividendIdentities } from '../netlify/functions/lib/dividend-preferences'
import { mergeDividendLookupCache } from '../netlify/functions/lib/dividend-lookup-store'
import { dividendLookupStatus } from '../src/lib/dividend-lookup-status'
import { recordTransactionOverride } from '../src/lib/transaction-overrides'
import type { Account, Transaction } from '../src/lib/types'

const payment = (id: string, accountId = 'a'): Transaction => ({ id, accountId, brokerTransactionId: id, date: '2026-09-01', type: 'Dividend', description: 'Cash Dividend', units: 0, amount: 10, tags: [] })
const account = (id: string, mask: string): Account => ({ id, mask, broker: 'Schwab', name: id, fullName: id, type: 'Margin', isMargin: true, marginBalance: 0, cash: 0 })
const accounts = [account('a', '9414'), account('b', '9391'), account('c', '8870')]

export async function testDividendSyncProgress() {
  const rows = [payment('manual'), payment('pdf', 'b'), payment('csv', 'c'), { ...payment('position'), securityName: 'Distinctive Sold Fund' }, payment('unmatched')]
  rows[1].amount = 20; rows[2].amount = 30
  const overrides = recordTransactionOverride(rows, accounts, {}, 'manual', { symbol: 'MANUAL' })
  const before = structuredClone(rows)
  applySavedDividendIdentities(accounts, [], rows, {
    transactionOverrides: overrides,
    csvTransactionAuthority: [{ accountMask: '870', importedAt: '2026-09-22', transaction: { ...rows[2], symbol: 'CSV' } }],
    csvPositionAuthority: [{ accountMask: '414', importedAt: '2026-09-22', position: { symbol: 'SOLD', name: 'Distinctive Sold Fund', shares: 1, avgCost: 1, lastPrice: 1, prevClose: 1, dividendsReceived: 0 } }],
    statementTransactions: [{ accountMask: '391', importedAt: '2026-09-22', month: '2026-09', fileName: 'test.pdf', complete: true, issues: [], transactions: [{ ...rows[1], symbol: 'PDF', statement: { key: '391|2026-09|1', fileName: 'test.pdf', date: '2026-09-01', page: 1, row: 1 } }] }],
  })
  assert.deepEqual(rows.map((row) => row.symbol), ['MANUAL', 'PDF', 'CSV', 'SOLD', undefined])
  assert.deepEqual(rows.map(({ id, accountId, date, amount, units }) => ({ id, accountId, date, amount, units })), before.map(({ id, accountId, date, amount, units }) => ({ id, accountId, date, amount, units })), 'saved identity enrichment never appends records or changes accounting values')
  let calls = 0
  await resolveDividendSymbolsFromApi({ token: 'fixture-token', transactions: rows, accountHashes: new Map([['a', 'hash-a']]), mapTransaction: (_accountId, raw) => raw as Transaction, request: async () => { calls++; return Response.json(payment('unmatched')) } })
  assert.equal(calls, 1, 'only the genuinely unresolved payment needs an API lookup')

  let lookupCache: DividendLookupCache = {}
  const paths: string[] = []
  let latest: Transaction[] = []
  for (let sync = 0; sync < 5; sync++) {
    latest = Array.from({ length: 9 }, (_, i) => payment(`bulk-${i}`, accounts[i % 3].id))
    await resolveDividendSymbolsFromApi({ token: 'fixture-token', transactions: latest, accountHashes: new Map(accounts.map((row) => [row.id, 'hash-' + row.id])), mapTransaction: (_accountId, raw) => raw as Transaction, lookupCache, maxRequests: 2, request: async (input) => {
      const url = new URL(String(input)); paths.push(url.pathname)
      // Empty security details are a completed lookup, not an error to repeat.
      return Response.json({ ...payment(url.pathname.split('/').at(-1)!), amount: 999, tags: ['private'], description: 'private description' })
    } })
    lookupCache = JSON.parse(JSON.stringify(lookupCache))
  }
  assert.equal(paths.length, 9)
  assert.equal(new Set(paths).size, 9, 'successive syncs advance through the queue instead of repeating the first batch')
  assert.ok(latest.every((row) => row.dividendLookupState === 'unmatched'))
  const serialized = JSON.stringify(lookupCache)
  assert.ok(!serialized.includes('fixture-token') && !serialized.includes('hash-a') && !serialized.includes('private'), 'cache stores hashed request identities and only security metadata')

  // Persisting negative instrument responses is necessary too: otherwise
  // instrument searches consume the whole budget before details on every sync.
  const phasedCache: DividendLookupCache = {}
  const phaseCalls: string[] = []
  for (let sync = 0; sync < 4; sync++) {
    latest = Array.from({ length: 4 }, (_, i) => ({ ...payment(`phase-${i}`), securityId: `12345678${i}` }))
    await resolveDividendSymbolsFromApi({ token: 'fixture-token', transactions: latest, accountHashes: new Map([['a', 'hash-a']]), mapTransaction: (_accountId, raw) => raw as Transaction, lookupCache: phasedCache, maxRequests: 2, request: async (input) => {
      const url = new URL(String(input)); phaseCalls.push(url.pathname)
      return url.pathname.includes('/instruments/') ? Response.json({ instruments: [] }) : Response.json({ ...payment(url.pathname.split('/').at(-1)!), symbol: 'FOUND' })
    } })
  }
  assert.equal(phaseCalls.length, 8)
  assert.equal(new Set(phaseCalls).size, 8)
  assert.ok(latest.every((row) => row.symbol === 'FOUND'))
  const failedCache: DividendLookupCache = {}
  for (let i = 0; i < 2; i++) await resolveDividendSymbolsFromApi({ token: 'fixture-token', transactions: [payment('failed')], accountHashes: new Map([['a', 'hash-a']]), mapTransaction: (_accountId, raw) => raw as Transaction, lookupCache: failedCache, request: async () => Response.json({}, { status: 500 }) })
  assert.equal(Object.keys(failedCache).length, 0, 'failed requests remain retryable')
  const key = Object.keys(lookupCache)[0], entry = lookupCache[key]
  assert.deepEqual(mergeDividendLookupCache({ [key]: entry }, { [key]: { ...entry, expiresAt: entry.expiresAt - 1000 } })[key], entry, 'stale concurrent saves retain newer cache entries')
  assert.equal(Object.keys(mergeDividendLookupCache(lookupCache, {}, entry.expiresAt + 1)).length, 0, 'expired cache entries are pruned')

  const displayed = Array.from({ length: 490 }, (_, i) => ({ ...payment(`visible-${i}`, 'b'), symbol: 'REPAIRED', dividendLookupState: 'deferred' as const }))
  displayed.push({ ...payment('only-missing', 'a'), symbol: '', dividendLookupState: 'deferred' })
  assert.deepEqual(dividendLookupStatus(displayed, 'b'), { missing: 0, deferred: 0, unavailable: 0, unmatched: 0 })
  assert.deepEqual(dividendLookupStatus(displayed, 'a'), { missing: 1, deferred: 1, unavailable: 0, unmatched: 0 })
  console.log('dividend progress tests passed: saved identities, three-account queue progress, safe durable caching, stale saves, and reconciled status counts')
}
