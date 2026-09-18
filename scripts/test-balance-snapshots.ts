import assert from 'node:assert/strict'
import { automaticBalances, brokerageDate, createBalanceSnapshot, hydrateSnapshotFlows, mergeSnapshotMonths, snapshotMonth } from '../src/lib/balance-snapshots'
import { statementHistory, statementProfit } from '../src/lib/statement-history'
import { monthClose, portfolioSummary } from '../src/lib/calc'
import { loadBalanceSnapshots, saveBalanceSnapshots, snapshotFailureState, type SnapshotStore } from '../netlify/functions/lib/snapshot-store'
import { fetchBalanceSnapshots } from '../netlify/functions/lib/schwab'
import type { Account, HistoricalBalance, Transaction } from '../src/lib/types'

const account: Account = { id: 'acc_1234', mask: '1234', name: 'Test', fullName: 'Test', broker: 'Schwab', type: 'Margin', isMargin: true, cash: 0, equity: 1000, marginBalance: 400 }
const transaction = (type: Transaction['type'], amount: number, extra: Partial<Transaction> = {}): Transaction => ({ id: type, accountId: account.id, date: '2026-09-10', type, amount, description: type, units: 0, tags: [], ...extra })
const txns = [transaction('Contribution', 100), transaction('Withdrawal', -40), transaction('Bill Payment', -10), transaction('Dividend', 20), transaction('Interest', -5), transaction('Buy', -100), transaction('Sell', 200, { pl: 90 }), transaction('Contribution', 999, { accountId: 'other' }), transaction('Contribution', 999, { date: '2026-08-10' }), transaction('Contribution', 999, { date: '2026-09-30' })]
const capture = (at: string, equity = 1000, available = true) => createBalanceSnapshot({ ...account, equity }, txns, at, 'scheduled', available)!
const august = capture('2026-08-31T23:50:00Z')
const september = capture('2026-09-18T23:50:00Z', 1100)
const snapshots = [snapshotMonth(august), snapshotMonth(september)]

async function main() {
  assert.equal(brokerageDate('2026-09-01T00:30:00Z'), '2026-08-31', 'UTC midnight must not shift the brokerage month')
  assert.equal(capture('2026-09-01T00:30:00Z').monthEnd, true)
  assert.equal(capture('2026-08-31T16:00:00Z').monthEnd, false, 'intraday capture is not a month close')
  assert.equal(capture('2028-02-29T23:50:00Z').monthEnd, true, 'leap-year close')
  assert.equal(capture('2026-05-31T23:50:00Z').monthEnd, true, 'calendar month can end on a weekend')
  assert.equal(createBalanceSnapshot({ ...account, equity: undefined }, [], september.capturedAt, 'sync', true), null)
  assert.equal(createBalanceSnapshot({ ...account, marginBalance: NaN }, [], september.capturedAt, 'sync', true), null)
  assert.equal(capture(september.capturedAt, 0).equity, 0, 'zero is an observed balance, not missing data')
  assert.equal(september.flows.deposits, 100)
  assert.equal(september.flows.withdrawals, -50)
  assert.equal(september.flows.dividendsInterest, 20)
  assert.equal(september.flows.expenses, -5)
  const withoutFlows = snapshotMonth({ ...september, flows: { deposits: 0, withdrawals: 0, dividendsInterest: 0, expenses: 0, available: false, reviewRequired: false } })
  const hydrated = hydrateSnapshotFlows([withoutFlows], [account], txns)
  assert.equal(hydrated[0].latest.flows.available, true)
  assert.equal(hydrated[0].latest.flows.deposits, 100)
  assert.equal(hydrated[0].latest.flows.withdrawals, -50)
  assert.equal(hydrated[0].latest.flows.dividendsInterest, 20)
  assert.equal(hydrateSnapshotFlows([withoutFlows], [account], []).length, 1)
  const generated = automaticBalances(snapshots, [])
  assert.equal(generated[1].openingEquity, 1000)
  assert.equal(generated[1].marketChange, 35, 'realized gains are already in the balance change')
  assert.equal(statementProfit(generated[1]), 50)
  assert.equal(generated[1].monthEnd, false)
  assert.equal(generated[0].openingEquity, undefined, 'do not invent a baseline for the first observed month')
  const summary = portfolioSummary([], [account], 'all', [])
  const close = monthClose([account], txns, 'all', '2026-09', summary, [], snapshots)
  assert.equal(close.closing, 1100)
  assert.equal(close.reconciliationAvailable, true)
  assert.equal(close.bridge.slice(0, -1).reduce((sum, row) => sum + row.value, 0), close.closing)
  assert.equal(close.liabilities, 400)

  const midAugust = snapshotMonth(capture('2026-08-25T23:50:00Z'))
  assert.equal(automaticBalances([midAugust, snapshotMonth(september)], [])[1].openingEquity, undefined, 'a missing month end stays missing')
  assert.equal(automaticBalances([snapshotMonth(capture('2026-10-01T13:00:00Z'))], [])[0].openingEquity, undefined, 'a later capture cannot backfill a missing close')
  const missingFlows = snapshotMonth(capture(september.capturedAt, 1100, false))
  const partial = monthClose([account], [], 'all', '2026-09', summary, [], [snapshotMonth(august), missingFlows])
  assert.equal(partial.balanceAvailable, true)
  assert.equal(partial.historyAvailable, true)
  assert.equal(partial.reconciliationAvailable, false)
  assert.equal(statementProfit(partial.statement!), undefined)
  for (const unknown of [transaction('Other', 30), transaction('Transfer', 100)]) {
    const snapshot = createBalanceSnapshot(account, [unknown], september.capturedAt, 'sync', true)!
    assert.equal(snapshot.flows.reviewRequired, true)
    assert.equal(statementProfit(automaticBalances([snapshotMonth(august), snapshotMonth(snapshot)], [])[1]), undefined)
  }
  const journal = createBalanceSnapshot(account, [transaction('Transfer', 100, { description: 'TRF FUNDS TYPE 1 TO TYPE 2' })], september.capturedAt, 'sync', true)!
  assert.equal(journal.flows.reviewRequired, false, 'internal cash/margin journal is not external funding')

  const statement: HistoricalBalance = { id: 's', accountMask: '234', month: '2026-08', openingEquity: 950, closingEquity: 990, deposits: 0, withdrawals: 0, dividendsInterest: 0, expenses: 0, marketChange: 40, marginLoanBalance: 300, source: 'CSV', fileName: 'statement.csv', importedAt: '2026-09-20T00:00:00Z' }
  const history = statementHistory([statement], [account], 'all', snapshots)
  assert.equal(history[0].closingEquity, 990, 'imported statement overrides the same month snapshot')
  assert.equal(history[1].openingEquity, 990, 'statement verification also updates the following opening')
  assert.equal(statementProfit(history[1]), 60)
  assert.equal(statementHistory([statement], [account, { ...account, id: 'other', mask: '5678' }], 'other', snapshots).length, 0)
  assert.equal(statementHistory([], [account, { ...account, id: 'other', mask: '5678' }], 'all', snapshots)[0].complete, false)

  const earlier = capture('2026-09-01T23:50:00Z', 1010)
  const later = capture('2026-09-30T23:50:00Z', 1200)
  const merged = mergeSnapshotMonths([snapshotMonth(september)], [snapshotMonth(earlier), snapshotMonth(later), snapshotMonth(september)])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].first.equity, 1010)
  assert.equal(merged[0].latest.equity, 1200, 'stale/out-of-order sync cannot overwrite a close')
  assert.equal(merged[0].latest.monthEnd, true)
  assert.deepEqual(mergeSnapshotMonths(merged, merged), merged, 'idempotent hydration and repeated sync')

  const values = new Map<string, { data: any; etag: string }>()
  let conflict = true
  let revision = 0
  const storage: SnapshotStore = {
    async getWithMetadata(key) { return structuredClone(values.get(key) ?? null) },
    async get(key) { return structuredClone(values.get(key)?.data ?? null) },
    async list({ prefix }) { return { blobs: [...values.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) } },
    async setJSON(key, data, options) {
      if (conflict) { conflict = false; values.set(key, { data: snapshotMonth(later), etag: String(++revision) }); return { modified: false } }
      const existing = values.get(key)
      if ((options?.onlyIfNew && existing) || (options?.onlyIfMatch && options.onlyIfMatch !== existing?.etag)) return { modified: false }
      values.set(key, { data: structuredClone(data), etag: String(++revision) }); return { modified: true }
    },
  }
  await saveBalanceSnapshots([september], storage)
  await saveBalanceSnapshots([earlier, august], storage)
  const persisted = await loadBalanceSnapshots(storage)
  assert.equal(persisted.length, 2)
  assert.equal(persisted[1].first.equity, 1010)
  assert.equal(persisted[1].latest.equity, 1200, 'conditional write retries preserve a concurrent newer capture')
  await assert.rejects(() => saveBalanceSnapshots([september], { ...storage, setJSON: async () => ({ modified: false }) }), /SNAPSHOT_WRITE_CONFLICT/)
  assert.equal(snapshotFailureState(new Error('REFRESH_EXPIRED')), 'reconnect')
  assert.equal(snapshotFailureState(new Error('storage failure')), 'error')

  // Exercise the actual nightly fetch path without contacting Schwab or Blobs.
  const realFetch = globalThis.fetch
  let failTransactions = false
  let invalidBalance = false
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('/transactions?')) {
      if (failTransactions) return new Response('{}', { status: 503 })
      return Response.json([])
    }
    if (url.endsWith('/accountNumbers')) return Response.json([{ accountNumber: '0000-1234', hashValue: 'test-hash' }])
    assert.ok(url.endsWith('/accounts'))
    return Response.json([{ securitiesAccount: { accountNumber: '00001234', type: 'MARGIN', currentBalances: { liquidationValue: invalidBalance ? null : 1000, marginBalance: -400, cashBalance: 0 } } }])
  }
  try {
    const fetched = await fetchBalanceSnapshots('test-token', 'scheduled')
    assert.equal(fetched[0].equity, 1000)
    assert.equal(fetched[0].marginDebt, 400)
    assert.equal(fetched[0].flows.available, true)
    assert.equal(fetched[0].source, 'scheduled')
    failTransactions = true
    assert.equal((await fetchBalanceSnapshots('test-token', 'sync'))[0].flows.available, false)
    invalidBalance = true
    await assert.rejects(() => fetchBalanceSnapshots('test-token', 'scheduled'), /INCOMPLETE_SNAPSHOT_BALANCES/)
  } finally { globalThis.fetch = realFetch }
  console.log('balance snapshot tests passed: rollover, coverage, statement priority, scopes, durable writes, races, and broker failures')
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
