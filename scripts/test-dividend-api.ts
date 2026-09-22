import assert from 'node:assert/strict'
import { resolveDividendSymbolsFromApi } from '../netlify/functions/lib/dividend-api'
import type { Transaction } from '../src/lib/types'

const payment = (id: string, extra: Partial<Transaction> = {}): Transaction => ({ id, brokerTransactionId: id, accountId: 'one', date: '2026-09-01', type: 'Dividend', description: 'Cash Dividend', amount: 10, units: 0, tags: [], ...extra })
const instrument = (symbol = 'TOPW', cusip = '123456789', description = 'ROUNDHILL TOP WEEKLYPAY ETF') => ({ symbol, cusip, description, assetType: 'ETF' })
const mapTransaction = (_account: string, raw: unknown) => raw as Transaction
const options = { token: 'fixture-token', accountHashes: new Map<string, string>(), mapTransaction }

export async function testDividendApi() {
  const rows = [payment('1', { securityId: '123456789' }), payment('2', { accountId: 'two', securityId: '123456789' }), payment('3', { accountId: 'three', securityId: '123456789' }), payment('4', { symbol: 'MANUAL', symbolSource: 'manual', securityId: '123456789' }), payment('5', { type: 'Sell', securityId: '123456789', units: -100 })]
  let calls = 0
  const summary = await resolveDividendSymbolsFromApi({ ...options, transactions: rows, request: async (input, init) => {
    calls++
    assert.equal(String(input), 'https://api.schwabapi.com/marketdata/v1/instruments/123456789')
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-token')
    assert.ok(init?.signal)
    return Response.json({ instruments: [instrument(), instrument()] })
  } })
  assert.equal(calls, 1, 'same CUSIP shares a request across accounts and payments')
  assert.deepEqual(rows.map((row) => row.symbol), ['TOPW', 'TOPW', 'TOPW', 'MANUAL', undefined])
  assert.equal(rows[0].symbolSource, 'broker')
  assert.equal(summary.get('three')?.resolved, 1)

  for (const candidates of [[instrument('WRONG', '987654321')], [instrument(), instrument('OTHER')], [{ ...instrument(), assetType: 'OPTION' }], [{ ...instrument(), symbol: 'CURRENCY_USD' }]]) {
    const row = payment('reject', { securityId: '123456789' })
    await resolveDividendSymbolsFromApi({ ...options, transactions: [row], request: async () => Response.json({ instruments: candidates }) })
    assert.equal(row.symbol, undefined, 'wrong CUSIP, ambiguous symbols, options and cash cannot match')
  }

  const names = [payment('name', { description: 'CASH DIVIDEND: ROUNDHILL TOP WEEKLYPAY ETF' }), payment('numeric', { securityName: 'ACME NASDAQ 100 INCOME ETF' }), payment('partial', { securityName: 'ROUNDHILL TOP' }), payment('generic', { description: 'SUBSTITUTE INCOME PAYMENT' }), payment('class', { securityName: 'ACME FUND CLASS A' }), payment('ambiguous', { securityName: 'AMBIGUOUS ETF' })]
  const searches: string[] = []
  await resolveDividendSymbolsFromApi({ ...options, transactions: names, request: async (input) => {
    const url = new URL(String(input)); searches.push(url.searchParams.get('symbol')!)
    assert.equal(url.searchParams.get('projection'), 'desc-search')
    return Response.json({ instruments: [instrument(), instrument('ACME', '987654321', 'ACME NASDAQ 200 INCOME ETF'), instrument('CLASSB', '987654321', 'ACME FUND CLASS B'), instrument('AMB1', '987654321', 'AMBIGUOUS ETF'), instrument('AMB2', '987654321', 'AMBIGUOUS ETF')] })
  } })
  assert.deepEqual(names.map((row) => row.symbol), ['TOPW', undefined, undefined, undefined, undefined, undefined], 'name matching is exact and keeps numbers and share classes')
  assert.ok(!searches.includes('SUBSTITUTE INCOME PAYMENT'), 'generic payment descriptions are never searched')

  const detailRows = [payment('detail'), payment('cusip-detail', { accountId: 'two' }), payment('mismatched'), payment('sale'), payment('broken')]
  const originalRows = structuredClone(detailRows)
  const paths: string[] = []
  const detailed = await resolveDividendSymbolsFromApi({ ...options, transactions: detailRows, accountHashes: new Map([['one', 'hash-one'], ['two', 'hash-two']]), mapTransaction: (id, raw) => {
    if ((raw as { broken?: boolean }).broken) throw new Error('bad payload')
    return mapTransaction(id, raw)
  }, request: async (input) => {
    const url = new URL(String(input)); paths.push(url.pathname)
    if (url.pathname.includes('/instruments/')) return Response.json({ instruments: [instrument()] })
    const id = url.pathname.split('/').at(-1)!
    if (id === 'detail') return Response.json(payment(id, { symbol: 'TOPW', amount: 999, tags: ['not copied'] }))
    if (id === 'cusip-detail') return Response.json(payment(id, { securityId: '123456789' }))
    if (id === 'mismatched') return Response.json(payment('wrong-id', { symbol: 'BAD' }))
    if (id === 'sale') return Response.json(payment(id, { symbol: 'BAD', type: 'Sell', units: -100 }))
    return Response.json({ broken: true })
  } })
  assert.deepEqual(detailRows.map((row) => row.symbol), ['TOPW', 'TOPW', undefined, undefined, undefined])
  assert.ok(paths.includes('/trader/v1/accounts/hash-two/transactions/cusip-detail'))
  assert.equal(detailed.get('one')?.failed, 1)
  for (let i = 0; i < detailRows.length; i++) {
    assert.equal(detailRows[i].amount, originalRows[i].amount)
    assert.equal(detailRows[i].type, originalRows[i].type)
    assert.deepEqual(detailRows[i].tags, originalRows[i].tags)
  }

  for (const status of [401, 403, 429, 500]) {
    const row = payment('failure', { securityId: '123456789' })
    const result = await resolveDividendSymbolsFromApi({ ...options, transactions: [row], request: async () => Response.json({}, { status }) })
    assert.equal(row.symbol, undefined)
    assert.equal(result.get('one')?.failed, 1, `HTTP ${status} is visible but nonfatal`)
  }
  const malformed = await resolveDividendSymbolsFromApi({ ...options, transactions: [payment('malformed', { securityId: '123456789' })], request: async () => Response.json({ unexpected: true }) })
  assert.equal(malformed.get('one')?.failed, 1)
  const cappedRows = Array.from({ length: 8 }, (_, i) => payment(`cap${i}`, { securityId: `12345678${i}` }))
  calls = 0
  const capped = await resolveDividendSymbolsFromApi({ ...options, transactions: cappedRows, maxRequests: 2, request: async () => { calls++; return Response.json({ instruments: [] }) } })
  assert.equal(calls, 2)
  assert.equal(capped.get('one')?.limited, 6)
  // A pending fetch honors the shared deadline; no background mutation survives it.
  const keepAlive = setTimeout(() => {}, 100)
  try {
    const timed = await resolveDividendSymbolsFromApi({ ...options, transactions: [payment('timeout', { securityId: '123456789' })], timeoutMs: 5, request: async (_input, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }) })
    assert.equal(timed.get('one')?.limited, 1)
  } finally { clearTimeout(keepAlive) }
  console.log('dividend API tests passed: cross-account CUSIPs, exact names, transaction details, manual precedence, failures and request limits')
}
