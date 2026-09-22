import assert from 'node:assert/strict'
import { fetchTransactionHistory } from '../netlify/functions/lib/transaction-history'
import { fetchPortfolio } from '../netlify/functions/lib/schwab'
import { applyPositionBuckets } from '../src/lib/position-buckets'
import { mergeLiveAccounts } from '../src/lib/live-accounts'
import type { Account, Position, Transaction } from '../src/lib/types'

async function main() {
  const position = (accountId: string): Position => ({ id: accountId, accountId, symbol: 'ABC', name: 'ABC', shares: 1, avgCost: 1, lastPrice: 1, prevClose: 1, dividendsReceived: 0 })
  const positions = [position('one'), position('two'), position('three')]
  applyPositionBuckets(positions, { 'one|ABC': 'High Yield' })
  assert.ok(positions.every((row) => row.allocationBucket === 'High Yield'))
  assert.equal(positions[1].allocationBucketSource, 'shared')
  applyPositionBuckets(positions, { 'one|ABC': 'High Yield', 'two|ABC': 'Growth' })
  assert.equal(positions[0].allocationBucket, 'High Yield')
  assert.equal(positions[1].allocationBucket, 'Growth')
  assert.equal(positions[2].allocationBucket, undefined, 'conflicting account choices do not leak')
  const account = (id: string): Account => ({ id, mask: id, name: id, fullName: id, broker: 'Schwab', type: 'Individual', isMargin: false, cash: 0, marginBalance: 0 })
  const txn = (id: string, accountId: string, date = '2026-08-01'): Transaction => ({ id, brokerTransactionId: id, accountId, date, type: 'Dividend', description: 'ABC', symbol: 'ABC', amount: 1, units: 0, tags: [] })
  const current = { accounts: [account('one'), account('absent')], positions: [position('one'), position('absent')], transactions: [txn('older1', 'one', '2024-08-01'), txn('older2', 'one', '2024-08-01'), txn('current', 'one'), txn('absent', 'absent')] }
  const incoming = { accounts: [account('one'), account('two')], positions: [position('two')], transactions: [txn('current', 'one'), txn('new', 'two')], accountSyncCoverage: [{ accountId: 'one', from: '2025-09-22', to: '2026-09-22', transactionCount: 1, positionCount: 0, method: 'single request' as const, syncedAt: '2026-09-22T12:00:00Z' }] }
  const merged = mergeLiveAccounts(current, incoming)
  assert.deepEqual(merged.accounts.map((row) => row.id), ['one', 'two', 'absent'])
  assert.deepEqual(merged.positions.map((row) => row.accountId), ['two', 'absent'], 'closed positions in refreshed accounts are removed')
  assert.equal(merged.transactions.length, 5, 'old history and absent accounts survive')
  assert.deepEqual(mergeLiveAccounts(merged, incoming), merged, 'repeat sync never duplicates old payments')
  const imported = { ...current, accounts: [{ ...account('csv-id'), mask: 'one' }], positions: [position('csv-id')], transactions: [txn('legacy', 'csv-id', '2024-01-01')] }
  const reunited = mergeLiveAccounts(imported, incoming)
  assert.equal(reunited.accounts.length, 2, 'same brokerage and mask reunite a CSV account with live identity')
  assert.equal(reunited.accountAliases['csv-id'], 'one')
  assert.equal(reunited.transactions.find((row) => row.id === 'legacy')?.accountId, 'one')

  let calls = 0
  const start = new Date('2025-09-22T00:00:00Z'), end = new Date('2026-09-22T00:00:00Z')
  const windows: [string, string][] = []
  const fetched = await fetchTransactionHistory(async (from, to) => {
    if (++calls === 1) throw new Error('range too large')
    windows.push([from, to]); return [{ activityId: 'same' }, { activityId: from }, { amount: 1 }, { amount: 1 }]
  }, start, end)
  assert.equal(fetched.method, 'smaller date windows')
  assert.equal(windows.length, 13)
  assert.equal(windows[0][0], start.toISOString().replace('.000', ''))
  assert.equal(windows.at(-1)![1], end.toISOString().replace('.000', ''))
  for (let i = 1; i < windows.length; i++) assert.equal(Date.parse(windows[i][0]) - Date.parse(windows[i - 1][1]), 1000)
  assert.equal(fetched.rows.length, 1 + 13 * 3, 'only repeated broker IDs are collapsed; identical cash rows remain')
  await assert.rejects(() => fetchTransactionHistory(async () => { throw new Error('failed') }, start, end), /failed/)
  await assert.rejects(() => fetchTransactionHistory(async () => ({}), start, end), /INVALID_TRANSACTION_RESPONSE/)

  const realFetch = globalThis.fetch
  let fail = false, missingHash = false
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/accounts/accountNumbers')) return Response.json(['1111', '2222', '3333'].filter((id) => !missingHash || id !== '2222').map((id) => ({ accountNumber: id, hashValue: id })))
    if (url.pathname.endsWith('/accounts')) return Response.json(['1111', '2222', '3333'].map((id) => ({ securitiesAccount: { accountNumber: id, type: 'CASH', currentBalances: { liquidationValue: 100, cashBalance: 100 }, positions: [] } })))
    if (url.pathname.endsWith('/transactions')) {
      if (fail && url.pathname.includes('2222')) return Response.json({}, { status: 500 })
      const account = url.pathname.split('/').at(-2)
      return Response.json([{ activityId: account, type: 'DIVIDEND_OR_INTEREST', netAmount: 10, tradeDate: new Date().toISOString(), description: 'Dividend', transferItems: [{ amount: 0, instrument: { assetType: 'EQUITY', cusip: '123456789', ...(account === '1111' ? { symbol: 'ABC' } : {}) } }, { amount: 10, instrument: { assetType: 'CURRENCY', symbol: 'CURRENCY_USD' } }] }])
    }
    return Response.json({ candles: [] })
  }
  try {
    const portfolio = await fetchPortfolio('test-token')
    assert.equal(portfolio.accountSyncCoverage.length, 3)
    assert.equal(portfolio.transactions.length, 3)
    assert.ok(portfolio.transactions.every((row) => row.symbol === 'ABC' && row.units === 0), 'CUSIP-only dividends resolve across all accounts without counting cash as units')
    fail = true
    await assert.rejects(() => fetchPortfolio('test-token'), /history failed.*2222/)
    fail = false; missingHash = true
    await assert.rejects(() => fetchPortfolio('test-token'), /access is missing.*2222/)
  } finally { globalThis.fetch = realFetch }
  console.log('account sync tests passed: 3-account dividend identities, history retries, failure preservation, categories, old history and legitimate repeated payments')
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
