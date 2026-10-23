import { strict as assert } from 'node:assert'
import { priceRiskEvidence, proxyRelationship, buildAllocationEvidence, validateAllocationEvidence, validateAllocationReview, filterAllocationShortlist, allocationShortlistIsCurrent, isCurrentHedgeQuote } from '../src/lib/ai-allocation'
import type { Position, Insights } from '../src/lib/types'
const prices = Array.from({ length: 370 }, (_, i) => ({ date: new Date(Date.parse('2026-10-23') - (369 - i) * 86400000).toISOString().slice(0, 10), value: 100 + i }))
const metrics = priceRiskEvidence(prices)
assert.ok(metrics.return12m! > 0)
assert.equal(metrics.maxDrawdown, 0)
assert.ok(metrics.annualizedVolatility! >= 0)
assert.equal(priceRiskEvidence([{ date: '2026-01-01', value: 100 }, { date: '2026-01-02', value: 250 }]).largeMoveWarning, true)
assert.equal(priceRiskEvidence(prices.slice(0, 20)).return3m, null)
assert.equal(priceRiskEvidence([{ date: '2026-01-01', value: 100 }, { date: '2026-01-02', value: 50 }]).maxDrawdown, -.5)
assert.ok(Math.abs(proxyRelationship(prices, prices).beta! - 1) < 1e-8)
assert.equal(proxyRelationship(prices.slice(0, 10), prices).beta, null)
const position: Position = { id: 'private-id', accountId: 'private-account', symbol: 'ABC', name: 'Private label', shares: 100, avgCost: 80, lastPrice: 100, prevClose: 99, dividendsReceived: 20 }
const insights: Insights = { generatedAt: '2026-10-23T12:00:00Z', bySymbol: { ABC: { symbol: 'ABC', price: 100, sma50: 95, sma100: 90, sma200: 85, history: 370, risk: metrics, proxies: { QQQ: { beta: 1, correlation: 1, observations: 253 }, SPY: { beta: .8, correlation: .9, observations: 253 } } } } }
const evidence = buildAllocationEvidence([position], insights, { Growth: 100, CEFs: 0, 'High Yield': 0, Leveraged: 0 }, 1000, '2026-10-23')
assert.equal(evidence.horizonMonths, 12)
assert.deepEqual(evidence.monitorMonths, [3, 6])
assert.equal(evidence.candidates[0].eligible, true)
assert.equal(evidence.proxies[0].beta, 1)
assert.ok(!JSON.stringify(evidence).includes('private-account'))
assert.ok(!JSON.stringify(evidence).includes('Private label'))
assert.equal(buildAllocationEvidence([position], insights, {}, 0, '2026-11-23').candidates[0].eligible, false)
assert.equal(buildAllocationEvidence([], insights, {}, 0, '2026-10-23').candidates.length, 0)
assert.deepEqual(validateAllocationEvidence(evidence), evidence)
assert.throws(() => validateAllocationEvidence({ ...evidence, budget: -1 }))
const review = { summary: 'Review ABC.', candidates: [{ symbol: 'ABC', reason: 'Positive price trend.', risk: 'Total-return history is missing.' }], protection: 'Load a current option chain.', checks3m: ['Refresh trend evidence.'], checks6m: ['Compare results with the benchmark.'], limitations: ['No return probabilities are available.'] }
assert.deepEqual(validateAllocationReview(review, evidence), review)
assert.throws(() => validateAllocationReview({ ...review, candidates: [{ symbol: 'FAKE', reason: 'Buy', risk: 'None' }] }, evidence))
assert.throws(() => validateAllocationReview({ ...review, candidates: [review.candidates[0], review.candidates[0]] }, evidence))
assert.throws(() => validateAllocationReview(review, { ...evidence, candidates: evidence.candidates.map((c) => ({ ...c, eligible: false })) }))
const orders = [{ symbol: 'ABC', shares: 2, spend: 200 }, { symbol: 'XYZ', shares: 3, spend: 300 }]
assert.deepEqual(filterAllocationShortlist(orders, ['ABC']), [orders[0]])
assert.deepEqual(filterAllocationShortlist(orders, null), orders)
assert.equal(allocationShortlistIsCurrent({ key: 'evidence-v1', expiresAt: 5000 }, 'evidence-v1', 4000), true)
assert.equal(allocationShortlistIsCurrent({ key: 'evidence-v1', expiresAt: 5000 }, 'evidence-v2', 4000), false)
assert.equal(allocationShortlistIsCurrent({ key: 'evidence-v1', expiresAt: 5000 }, 'evidence-v1', 5000), false)
console.log('Allocation price evidence, proxy estimates, freshness, privacy, review validation and shortlist sizing passed')

import { createAiAllocationHandler } from '../netlify/functions/lib/ai-allocation-handler'
import '../netlify/functions/ai-allocation'
import { existingProxyPutOffset, portfolioPutHedge } from '../src/lib/hedge'
import type { AiHedgeContext } from '../src/lib/ai-allocation'
async function endpointTests() {
  const put: Position = { ...position, symbol: 'QQQ261218P00425000', underlying: 'QQQ', isOption: true, optionType: 'Put', shares: 2, strike: 425, expiration: '2026-12-18', lastPrice: 800 }
  assert.equal(existingProxyPutOffset([put], 'QQQ', 375, '2026-12-18'), 8400)
  assert.equal(existingProxyPutOffset([put], 'SPY', 375, '2026-12-18'), 0)
  assert.equal(existingProxyPutOffset([put], 'QQQ', 375, '2027-01-01'), 0, 'expired insurance cannot reduce new sizing')
  assert.equal(portfolioPutHedge({ longExposure: 500000, qqqPrice: 500, portfolioQqqBeta: .8, targetQqqDeclinePct: 25, lossOffsetPct: 50, strikePrice: 425, premiumPerShare: 8, annualPremiumBudgetPct: 3, existingOffset: 8400 }).contracts, 10)
  const now = Date.parse('2026-10-23T12:00:00Z')
  assert.equal(isCurrentHedgeQuote('2026-10-23T11:59:00Z', '2026-12-18', '2026-10-23', false, now), true)
  assert.equal(isCurrentHedgeQuote('2026-10-23T11:59:00Z', '2026-12-18', '2026-10-23', true, now), false)
  assert.equal(isCurrentHedgeQuote('2026-10-23T11:50:00Z', '2026-12-18', '2026-10-23', false, now), false)
  const hedge: AiHedgeContext = { proxy: 'QQQ', price: 500, beta: .8, declinePct: 25, offsetPct: 50, annualBudgetPct: 3, strike: 425, premium: 8, expiration: '2026-12-18', quoteFetchedAt: '', quoteDelayed: false, alternatives: [{ strike: 420, premium: 7, expiration: '2026-12-18' }] }
  const hedged = buildAllocationEvidence([{ ...position, shares: 5000 }, put], insights, { Growth: 100 }, 1000, '2026-10-23', 'live', hedge)
  assert.equal(hedged.hedge!.contracts, 10)
  assert.equal(hedged.hedge!.existingOffset, 8400)
  const sanitized = validateAllocationEvidence({ ...hedged, privateAccount: 'secret', hedge: { ...hedged.hedge!, contracts: 999, existingOffset: 999999 } })
  assert.equal(sanitized.hedge!.contracts, 10, 'server recomputes hedge math')
  assert.equal(sanitized.hedge!.existingOffset, 8400)
  assert.equal(sanitized.hedgeAlternatives.length, 1)
  assert.ok(!JSON.stringify(sanitized).includes('secret'))
  let calls = 0
  const fakeFetch: typeof fetch = async (_url, init) => {
    calls++
    const body = JSON.parse(String(init?.body))
    assert.equal(body.store, false)
    assert.ok(!String(init?.body).includes('private-account'))
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(review) }] }] })
  }
  const deps = { apiKey: 'test-only', model: 'test-model', fetch: fakeFetch, reserveRequest: async () => true }
  const req = (origin = 'https://app.example', input: unknown = evidence) => new Request('https://app.example/api', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Simonfire-Ai-Request': '1' }, body: JSON.stringify(input) })
  const success = await createAiAllocationHandler(deps)(req())
  assert.equal(success.status, 200)
  assert.deepEqual((await success.json()).review, review)
  assert.equal((await createAiAllocationHandler(deps)(req('https://attacker.example'))).status, 403)
  assert.equal((await createAiAllocationHandler({ ...deps, apiKey: undefined })(req())).status, 503)
  assert.equal((await createAiAllocationHandler({ ...deps, reserveRequest: async () => false })(req())).status, 429)
  assert.equal((await createAiAllocationHandler(deps)(req('https://app.example', { ...evidence, candidates: 'invalid' }))).status, 400)
  assert.equal(calls, 1)
  const incomplete: typeof fetch = async () => Response.json({ status: 'incomplete' })
  assert.equal((await createAiAllocationHandler({ ...deps, fetch: incomplete })(req())).status, 502)
  const invented: typeof fetch = async () => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ...review, candidates: [{ symbol: 'FAKE', reason: 'Buy', risk: 'None' }] }) }] }] })
  assert.equal((await createAiAllocationHandler({ ...deps, fetch: invented })(req())).status, 502)
  console.log('Allocation API validation, shared quota, provider failures, existing insurance and expiration alignment passed')
}
void endpointTests().catch((error) => { console.error(error); process.exitCode = 1 })
