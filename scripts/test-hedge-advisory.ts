// All dependencies are synthetic: no credentials, environment changes or real broker calls.
import { strict as assert } from 'node:assert'
import { createSchwabOrderHandler, type OrderDependencies } from '../netlify/functions/schwab-order'

const order = (instruction = 'BUY_TO_OPEN') => ({ session: 'NORMAL', duration: 'DAY', orderStrategyType: 'SINGLE', orderType: 'LIMIT', price: '2.50', orderLegCollection: [{ instruction, quantity: 2, instrument: { symbol: 'QQQ   270115P00600000', assetType: 'OPTION' } }] })
const requestId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
function fixture(enabled = true) {
  const records = new Map<string, unknown>()
  let now = 1_800_000_000_000
  let tokenCalls = 0
  let submissions = 0
  let previewStatus = 200
  let placementStatus = 201
  let location = 'https://synthetic.test/orders/123'
  const deps: OrderDependencies = {
    appUrl: 'https://example.test', placementEnabled: enabled,
    accessToken: async () => { tokenCalls++; return 'synthetic-token' },
    accountHash: async () => 'synthetic-account',
    store: () => ({
      get: async (key: string) => records.get(key) ?? null,
      setJSON: async (key: string, value: unknown, options?: { onlyIfNew?: boolean }) => {
        if (options?.onlyIfNew && records.has(key)) return { modified: false }
        records.set(key, value); return { modified: true }
      },
    }) as ReturnType<OrderDependencies['store']>,
    now: () => now,
    fetch: async (url, init) => {
      const path = String(url)
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-token')
      if (path.endsWith('/previewOrder')) return new Response('{}', { status: previewStatus })
      if (path.endsWith('/orders/123')) return Response.json({ status: 'FILLED' })
      assert.ok(path.endsWith('/orders')); assert.equal(init?.method, 'POST')
      submissions++
      return new Response(null, { status: placementStatus, headers: location ? { location } : {} })
    },
  }
  const handler = createSchwabOrderHandler(deps)
  const call = async (action: string, overrides: Record<string, unknown> = {}, origin = 'https://example.test') => {
    const response = await handler(new Request('https://example.test/.netlify/functions/schwab-order', { method: 'POST', headers: { origin, 'x-simonfire-order-request': '1', 'content-type': 'application/json' }, body: JSON.stringify({ action, accountId: 'synthetic', requestId, order: order(), confirm: true, ...overrides }) }))
    return { status: response.status, body: await response.json() }
  }
  return { records, call, get tokenCalls() { return tokenCalls }, get submissions() { return submissions }, advance: (ms: number) => { now += ms }, rejectPreview: () => { previewStatus = 400 }, rejectPlacement: () => { placementStatus = 400 }, omitOrderId: () => { location = '' } }
}

void (async () => {
  const disabled = fixture(false)
  assert.equal((await disabled.call('place')).body.error, 'placement_disabled')
  assert.equal(disabled.tokenCalls, 0, 'Disabled placement must not access tokens')
  const unconfirmed = fixture()
  assert.equal((await unconfirmed.call('place', { confirm: false })).body.error, 'confirmation_required')
  assert.equal(unconfirmed.tokenCalls, 0, 'Unconfirmed placement must not access tokens')
  const f = fixture()
  assert.equal((await f.call('preview', {}, 'https://attacker.test')).status, 403)
  assert.equal(f.tokenCalls, 0)
  assert.equal((await f.call('place')).body.error, 'preview_required')
  const market = { ...order(), orderType: 'MARKET' }
  assert.equal((await f.call('preview', { order: market })).body.error, 'option_limit_orders_only')
  const oversized = order(); oversized.orderLegCollection[0].quantity = 101
  assert.equal((await f.call('preview', { order: oversized })).body.error, 'invalid_quantity')
  assert.equal((await f.call('preview')).status, 200)
  assert.equal(f.submissions, 0, 'Preview must never place an order')
  assert.equal((await f.call('place', { order: { ...order(), price: '2.60' } })).body.error, 'preview_required')
  assert.equal((await f.call('place', { accountId: 'different-synthetic' })).body.error, 'preview_required')
  assert.equal((await f.call('place')).status, 201)
  assert.equal((await f.call('place')).body.error, 'duplicate_request')
  assert.equal(f.submissions, 1)
  assert.equal((await f.call('status', { orderId: '123' })).body.status, 'FILLED')
  for (const age of [600_001, -1]) {
    const stale = fixture(); await stale.call('preview'); stale.advance(age)
    assert.equal((await stale.call('place')).body.error, 'preview_required')
    assert.equal(stale.submissions, 0)
  }
  const corrupt = fixture(); await corrupt.call('preview')
  const saved = corrupt.records.get(`previews/${requestId}`) as Record<string, unknown>
  corrupt.records.set(`previews/${requestId}`, { ...saved, previewedAt: 'invalid' })
  assert.equal((await corrupt.call('place')).body.error, 'preview_required')
  const concurrent = fixture(); await concurrent.call('preview')
  const attempts = await Promise.all([concurrent.call('place'), concurrent.call('place')])
  assert.deepEqual(attempts.map((result) => result.status).sort(), [201, 409])
  assert.equal(concurrent.submissions, 1, 'Concurrent confirmations must claim once')
  const equity = fixture()
  const stockOrder = { ...order(), orderType: 'MARKET', orderLegCollection: [{ instruction: 'BUY', quantity: 10, instrument: { symbol: 'SYNTH', assetType: 'EQUITY' } }] }
  assert.equal((await equity.call('preview', { order: stockOrder })).status, 200)
  assert.equal((await equity.call('place', { order: stockOrder })).status, 201)
  const close = fixture()
  await close.call('preview', { order: order('SELL_TO_CLOSE') })
  assert.equal((await close.call('place', { order: order('SELL_TO_CLOSE') })).status, 201)
  const failed = fixture(); failed.rejectPreview()
  assert.equal((await failed.call('preview')).status, 400)
  assert.equal((await failed.call('place')).body.error, 'preview_required')
  for (const outcome of ['rejected', 'missing-id']) {
    const uncertain = fixture(); await uncertain.call('preview')
    if (outcome === 'rejected') uncertain.rejectPlacement(); else uncertain.omitOrderId()
    assert.equal((await uncertain.call('place')).status, outcome === 'rejected' ? 400 : 502)
    assert.equal((await uncertain.call('place')).body.error, 'duplicate_request')
    assert.equal(uncertain.submissions, 1, 'Never resubmit an already claimed request')
  }
  console.log('Mocked option order tests passed: confirmation, environment gate, preview binding/expiry, close orders, status and idempotency; no real broker calls.')
})()
