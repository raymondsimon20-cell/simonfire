// All dependencies are synthetic: no credentials, environment changes or real broker calls.
import { validateSurvivalPolicy } from '../src/lib/survival-policy'
import { DEFAULT_SURVIVAL } from '../src/lib/margin-survival'
import { strict as assert } from 'node:assert'
import { createSchwabOrderHandler, type OrderDependencies } from '../netlify/functions/schwab-order'

const order = (instruction = 'BUY_TO_OPEN') => ({ session: 'NORMAL', duration: 'DAY', orderStrategyType: 'SINGLE', orderType: 'LIMIT', price: '2.50', orderLegCollection: [{ instruction, quantity: 2, instrument: { symbol: 'QQQ   270115P00600000', assetType: 'OPTION' } }] })
const policy = () => ({ settings: structuredClone(DEFAULT_SURVIVAL), ratePct: 8, horizonDays: 120, budget: 4000, maxContracts: 4, feePerContract: .65 })
const requestId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
function fixture(enabled = true, option = false) {
  const records = new Map<string, unknown>()
  let now = Date.parse('2026-11-23T16:00:00Z')
  let tokenCalls = 0
  let submissions = 0
  let previewStatus = 200
  let placementStatus = 201
  let brokerStatus = { status: 'PARTIALLY_FILLED', quantity: 2, filledQuantity: 1, remainingQuantity: 1 }
  let liveAccount: unknown = { securitiesAccount: { currentBalances: { equity: 60000, maintenanceRequirement: 30000 }, positions: [{ instrument: { symbol: 'QQQ   270115P00600000', assetType: 'OPTION' }, longQuantity: 2 }] } }
  let complete = false
  let historyMissing = false
  let optionTreatment: string | undefined = 'FULLY_FUNDED'
  let multiplier: number | undefined = 100
  let historyAge = 0
  let quoteAge = 0
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
    fetchDailyCloses: async () => historyMissing ? new Map() : new Map(Array.from({ length: 90 }, (_, i) => [new Date(now - (90-i+historyAge)*86400000).toISOString().slice(0,10), 100 + i*.2 + Math.sin(i)*2])),
    fetch: async (url, init) => {
      const path = String(url)
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-token')
      if (path.includes('?fields=positions')) return Response.json(liveAccount)
      if (path.includes('/chains?')) return Response.json({ isDelayed: false, underlyingPrice: 600, underlying: { quoteTime: now }, putExpDateMap: { '2027-01-15:53': { '600': [{ symbol: 'QQQ   270115P00600000', strikePrice: 600, multiplier, bid: 2.4, ask: 2.6, quoteTimeInLong: now }] } } })
      if (path.includes('/quotes?') && complete) return Response.json({
        'QQQ': { realtime: true, quote: { lastPrice: 600, quoteTime: now } },
        'QQQ   270115P00600000': { realtime: true, reference: { multiplier, optionMarginTreatment: optionTreatment }, quote: { bidPrice: 2.4, askPrice: 2.6, quoteTime: now-quoteAge } },
      })
      if (path.includes('/quotes?')) return Response.json({ 'QQQ   270115P00600000': { realtime: true, quote: { bidPrice: 2.4, askPrice: 2.6, quoteTime: now - quoteAge } } })
      if (path.endsWith('/previewOrder')) return new Response('{}', { status: previewStatus })
      if (path.endsWith('/orders/123')) return Response.json(brokerStatus)
      assert.ok(path.endsWith('/orders')); assert.equal(init?.method, 'POST')
      submissions++
      return new Response(null, { status: placementStatus, headers: location ? { location } : {} })
    },
  }
  const handler = createSchwabOrderHandler(deps)
  const call = async (action: string, overrides: Record<string, unknown> = {}, origin = 'https://example.test') => {
    const response = await handler(new Request('https://example.test/.netlify/functions/schwab-order', { method: 'POST', headers: { origin, 'x-simonfire-order-request': '1', 'content-type': 'application/json' }, body: JSON.stringify({ action, accountId: 'synthetic', requestId, survivalPolicy: policy(), order: option ? order() : { ...order(), orderLegCollection: [{ instruction: 'BUY', quantity: 2, instrument: { symbol: 'SYNTH', assetType: 'EQUITY' } }] }, confirm: true, ...overrides }) }))
    return { status: response.status, body: await response.json() }
  }
  return { records, call, verified: () => { complete = true; liveAccount = { securitiesAccount: { optionMarginTreatment: 'FULLY_FUNDED', currentBalances: { equity: 150500, liquidationValue: 150500, cashBalance: 50000, marginBalance: 0, maintenanceRequirement: 30500 }, positions: [
    { instrument: { symbol: 'SYNTH', assetType: 'EQUITY' }, longQuantity: 1000, shortQuantity: 0, marketValue: 100000, maintenanceRequirement: 30000, marginEligible: true },
    { instrument: { symbol: 'QQQ   270115P00600000', assetType: 'OPTION' }, longQuantity: 2, shortQuantity: 0, marketValue: 500, maintenanceRequirement: 500, optionMarginTreatment: 'FULLY_FUNDED' },
  ] } } }, getAccount: () => liveAccount as any, missingMultiplier: () => { multiplier = undefined }, staleHistory: () => { historyAge = 30 }, missingHistory: () => { historyMissing = true }, missingTreatment: () => { optionTreatment = undefined }, staleQuote: () => { quoteAge = 60001 }, setQuoteAge: (age: number) => { quoteAge = age }, setAccount: (account: unknown) => { liveAccount = account }, missingAccount: () => { liveAccount = {} }, setStatus: (status: typeof brokerStatus) => { brokerStatus = status }, get tokenCalls() { return tokenCalls }, get submissions() { return submissions }, advance: (ms: number) => { now += ms }, rejectPreview: () => { previewStatus = 400 }, rejectPlacement: () => { placementStatus = 400 }, omitOrderId: () => { location = '' } }
}

void (async () => {
  for (const invalid of [NaN,Infinity,-Infinity]) assert.throws(()=>validateSurvivalPolicy({...policy(),ratePct:invalid}),/INVALID_SURVIVAL_POLICY/)
  const reordered = fixture(true,true); reordered.verified(); await reordered.call('preview')
  const reversedPolicy: Record<string,unknown> = Object.fromEntries(Object.entries(policy()).reverse())
  reversedPolicy.settings = Object.fromEntries(Object.entries(policy().settings).reverse())
  assert.equal((await reordered.call('place',{survivalPolicy:reversedPolicy})).status,201,'Policy key ordering must not invalidate identical reviewed values')
  const custom = fixture(true,true); custom.verified()
  const customPolicy = policy(); customPolicy.budget = 9000; customPolicy.maxContracts = 12
  customPolicy.settings.maintenanceCushion = 1234
  customPolicy.settings.floorPct = 45; customPolicy.settings.cautionPct = 52; customPolicy.settings.normalPct = 62
  const customOrder = order(); customOrder.orderLegCollection[0].quantity = 11
  const customReview = (await custom.call('preview', { survivalPolicy: customPolicy, order: customOrder })).body.preflight
  assert.equal(customReview.executable,true,JSON.stringify(customReview.issues))
  assert.equal(customReview.modeledRisk.policy.budget,9000)
  assert.equal(customReview.modeledRisk.policy.maxContracts,12)
  assert.equal(customReview.modeledRisk.policy.settings.maintenanceCushion,1234)
  assert.equal(customReview.modeledRisk.policy.settings.floorPct,45)
  assert.equal(customReview.modeledRisk.policy.settings.normalPct,62)
  const lowBudget = fixture(true,true); lowBudget.verified()
  assert.match((await lowBudget.call('preview', {survivalPolicy:{...policy(),budget:100}})).body.preflight.issues.join(' '),/budget/)
  const lowQuantity = fixture(true,true); lowQuantity.verified()
  assert.match((await lowQuantity.call('preview', {survivalPolicy:{...policy(),maxContracts:1}})).body.preflight.issues.join(' '),/contract limit/)
  const legacy = fixture(true, true); legacy.verified()
  assert.equal((await legacy.call('preview', { survivalPolicy: undefined })).body.error, 'survival_policy_required')
  assert.equal(legacy.tokenCalls, 0)
  const binding = fixture(true, true); binding.verified(); await binding.call('preview')
  assert.equal((await binding.call('place', { survivalPolicy: {...policy(), horizonDays: 180} })).body.error, 'preview_required')
  assert.equal(binding.submissions, 0)
  const expensiveFlow = fixture(true, true); expensiveFlow.verified()
  const expensePolicy = policy(); expensePolicy.settings.monthlyExpense = 100000
  const expenseReview = (await expensiveFlow.call('preview', { survivalPolicy: expensePolicy })).body.preflight
  assert.equal(expenseReview.executable, false, 'User cash outflows must affect authorization')
  assert.ok(expenseReview.modeledRisk.maximumDeficiency > 0)
  const scheduled = fixture(true,true); scheduled.verified()
  const scheduledPolicy = policy(); scheduledPolicy.settings.flows = [{day:120,amount:250000,kind:'expense'}]
  const scheduledRisk = (await scheduled.call('preview',{survivalPolicy:scheduledPolicy})).body.preflight
  assert.equal(scheduledRisk.executable,false)
  assert.ok(scheduledRisk.modeledRisk.maximumDeficiency>0)
  assert.ok(scheduledRisk.modeledRisk.scenarios.some((s:any)=>s.id.startsWith('late-crash-120-')))
  const policyBinding = fixture(true,true); policyBinding.verified(); await policyBinding.call('preview')
  for (const survivalPolicy of [{...policy(),ratePct:9},{...policy(),budget:4500},{...policy(),maxContracts:5},{...policy(),settings:{...policy().settings,monthlyExpense:100}},{...policy(),settings:{...policy().settings,flows:[{day:1,amount:10,kind:'expense'}]}}]) {
    assert.equal((await policyBinding.call('place',{survivalPolicy})).body.error,'preview_required')
  }
  const malformed = [null, {...policy(), ratePct: '8'}, {...policy(), horizonDays: 731}, {...policy(), budget: -1}, {...policy(), maxContracts: 1.5}, {...policy(), settings: {...policy().settings, monthlyExpense: '0'}}, {...policy(), settings: {...policy().settings, flows: [{day:1,amount:-50,kind:'expense'}]}}, {...policy(), settings: {...policy().settings, flows: [{day:1,amount:10,kind:'unknown'}]}}, {...policy(), settings: {...policy().settings, historicalReturns: [null]}}, {...policy(), settings: {...policy().settings, optionMaintenanceVerified: true}}, {...policy(), settings: {...policy().settings, monteCarloPaths:21}}, {...policy(), settings:{...policy().settings, optionMaintenance:{toString:'unknown'}}}, {...policy(), settings:{...policy().settings,normalPct:40}}]
  for (const survivalPolicy of malformed) {
    const invalid = fixture(true,true); invalid.verified()
    assert.equal((await invalid.call('preview', {survivalPolicy})).body.error, 'invalid_survival_policy', JSON.stringify(survivalPolicy))
    assert.equal(invalid.tokenCalls, 0)
  }
  const verified = fixture(true, true); verified.verified()
  const review = await verified.call('preview')
  assert.equal(review.body.preflight.executable, true, JSON.stringify(review.body.preflight.issues))
  assert.ok(review.body.preflight.modeledRisk.scenarios.length >= 23)
  assert.equal(review.body.preflight.modeledRisk.contracts, 2)
  assert.equal(review.body.preflight.modeledRisk.policy.horizonDays, 120)
  assert.equal(review.body.preflight.modeledRisk.assumptions.annualInterestPct, 8)
  assert.equal((await verified.call('place')).status, 201, 'Verified safe option order must be permitted')
  assert.equal(verified.submissions, 1)
  const changed = fixture(true, true); changed.verified(); await changed.call('preview'); changed.missingHistory()
  assert.equal((await changed.call('place')).body.preflight.executable, false, 'Immediately rerun fresh simulation evidence')
  assert.equal(changed.submissions, 0)
  const unknownTreatment = fixture(true, true); unknownTreatment.verified(); unknownTreatment.missingTreatment()
  assert.equal((await unknownTreatment.call('preview')).body.preflight.executable, false, 'New option funding treatment cannot be inferred')
  const sell = fixture(true, true); sell.verified()
  const saleReview = await sell.call('preview', { order: order('SELL_TO_CLOSE') })
  assert.equal(saleReview.body.preflight.executable, true, JSON.stringify(saleReview.body.preflight.issues))
  assert.equal(saleReview.body.preflight.modeledRisk.closeContracts, 2)
  const missingMultiplier = fixture(true, true); missingMultiplier.verified(); missingMultiplier.missingMultiplier()
  assert.match((await missingMultiplier.call('preview')).body.preflight.issues.join(' '), /multiplier/)
  const staleHistory = fixture(true, true); staleHistory.verified(); staleHistory.staleHistory()
  assert.match((await staleHistory.call('preview')).body.preflight.issues.join(' '), /historical/)
  const missingRequirement = fixture(true, true); missingRequirement.verified()
  delete missingRequirement.getAccount().securitiesAccount.positions[0].maintenanceRequirement
  assert.equal((await missingRequirement.call('preview')).body.preflight.executable, false)
  const missingHeldTreatment = fixture(true, true); missingHeldTreatment.verified()
  delete missingHeldTreatment.getAccount().securitiesAccount.positions[1].optionMarginTreatment
  assert.match((await missingHeldTreatment.call('preview')).body.preflight.issues.join(' '), /optionMarginTreatment/)
  const drift = fixture(true, true); drift.verified()
  drift.getAccount().securitiesAccount.currentBalances.liquidationValue += 2
  assert.match((await drift.call('preview')).body.preflight.issues.join(' '), /reconcile/)
  const riskyClose = fixture(true, true); riskyClose.verified()
  Object.assign(riskyClose.getAccount().securitiesAccount.currentBalances, {cashBalance: 0, marginBalance: -40000, equity: 60500, liquidationValue: 60500})
  const closeRisk = (await riskyClose.call('preview', { order: order('SELL_TO_CLOSE') })).body.preflight
  assert.equal(closeRisk.executable, false)
  assert.ok(closeRisk.modeledRisk, JSON.stringify(closeRisk.issues))
  assert.match(closeRisk.issues.join(' '), /cushion|floor|deficiency/)
  assert.ok(closeRisk.modeledRisk.scenarios.some((s: any)=>s.minExcess<5000))
  const overpriced = fixture(true, true); overpriced.verified()
  assert.match((await overpriced.call('preview', {order:{...order(),price:'100.00'}})).body.preflight.issues.join(' '), /budget/)
  const freshThenStale = fixture(true, true); freshThenStale.verified(); await freshThenStale.call('preview'); freshThenStale.staleQuote()
  assert.equal((await freshThenStale.call('place')).body.preflight.executable, false)
  assert.equal(freshThenStale.submissions, 0)
  const reReview = fixture(true, true); await reReview.call('preview'); reReview.verified()
  assert.equal((await reReview.call('place')).body.error, 'preview_required', 'A previously blocked review must not authorize a newly verified trade')
  const duplicate = fixture(true, true); duplicate.verified(); await duplicate.call('preview')
  const placements = await Promise.all([duplicate.call('place'),duplicate.call('place')])
  assert.deepEqual(placements.map(p=>p.status).sort(), [201,409])
  assert.equal(duplicate.submissions, 1)
  const disabled = fixture(false)
  assert.equal((await disabled.call('place')).body.error, 'placement_disabled')
  assert.equal(disabled.tokenCalls, 0, 'Disabled placement must not access tokens')
  const unconfirmed = fixture()
  assert.equal((await unconfirmed.call('place', { confirm: false })).body.error, 'confirmation_required')
  assert.equal(unconfirmed.tokenCalls, 0, 'Unconfirmed placement must not access tokens')
  const safety = fixture(true, true)
  const safetyPreview = await safety.call('preview')
  assert.equal(safetyPreview.body.preflight?.executable, false, 'Missing broker risk verification must block options')
  safety.setQuoteAge(60001)
  const blocked = await safety.call('place', { protectionVerified: true })
  assert.equal(blocked.body.error, 'option_preflight_unverified')
  assert.match(blocked.body.preflight.issues.join(' '), /stale/, 'Placement must refresh quotes after preview')
  assert.equal(safety.submissions, 0)
  assert.equal(safetyPreview.body.preflight.maintenanceExcess, 30000)
  assert.equal(safetyPreview.body.preflight.heldQuantity, 2)
  const changedQuantity = order(); changedQuantity.orderLegCollection[0].quantity = 1
  assert.equal((await safety.call('place', { order: changedQuantity })).body.error, 'preview_required', 'Exact quantity must remain bound to the reviewed order')
  safety.staleQuote()
  assert.match((await safety.call('preview')).body.preflight.issues.join(' '), /stale/)
  safety.setQuoteAge(-1)
  assert.match((await safety.call('preview')).body.preflight.issues.join(' '), /stale/)
  safety.setAccount({ securitiesAccount: { currentBalances: { equity: 60000, maintenanceRequirement: 70000 }, positions: [] } })
  const deficit = (await safety.call('preview')).body.preflight
  assert.equal(deficit.maintenanceExcess, -10000)
  assert.match(deficit.issues.join(' '), /deficiency/)
  safety.missingAccount()
  assert.match((await safety.call('preview')).body.preflight.issues.join(' '), /unavailable/)
  const tooMany = order('SELL_TO_CLOSE'); tooMany.orderLegCollection[0].quantity = 3
  const quantity = fixture(true, true)
  assert.match((await quantity.call('preview', { order: tooMany })).body.preflight.issues.join(' '), /Insufficient/)
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
  const accepted = await f.call('place')
  assert.equal(accepted.status, 201)
  assert.equal(accepted.body.status, 'ACCEPTED', 'Broker acceptance is never a fill')
  assert.equal((await f.call('place')).body.error, 'duplicate_request')
  assert.equal(f.submissions, 1)
  const partial = (await f.call('status', { orderId: '123' })).body
  assert.equal(partial.status, 'PARTIALLY_FILLED')
  assert.equal(partial.filledQuantity, 1)
  assert.equal(partial.remainingQuantity, 1)
  f.setStatus({ status: 'REJECTED', quantity: 2, filledQuantity: 0, remainingQuantity: 2 })
  assert.equal((await f.call('status', { orderId: '123' })).body.filledQuantity, 0)
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
  const close = fixture(true, true)
  await close.call('preview', { order: order('SELL_TO_CLOSE') })
  assert.equal((await close.call('place', { order: order('SELL_TO_CLOSE') })).body.error, 'option_preflight_unverified')
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
  console.log('Mocked order tests passed: exact policy binding, strict bounded validation, legacy policy gate, preserved user limits, recurring/scheduled expenses, late-crash scenarios, verified option buy/close allowed, exact-strategy survival simulation and placement rerun, unsupported broker treatment blocked, budget/cushion/floor checks; fail-closed option preflight, fresh broker data, stale/future quotes, exact close quantities, deficiency, partial/rejected status; equity confirmation, preview expiry and idempotency; no real broker calls.')
})()
