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
  const scenarioRows = [5,10,15,20,30,40].map(declinePct => ({declinePct,equity:10000,equityPct:50,floorGap:500,maintenanceGap:250,premium:0,closeCredit:0,fees:0,financing:50}))
  const dailySummary = {minimumExcess:-5000,maximumDeficiency:5000,firstDeficiency:'2026-12-01',scenarioCount:23,policy:'EMERGENCY'}
  const dailyReview = {survival:dailySummary,targetEquityPct:57,horizonDays:365,ratePct:8,evidenceComplete:false,missingCount:1,quoteFetchedAt:'',candidate:null,hold:scenarioRows}
  const beforeLegacy = calls
  const legacyResponse = await createAiAllocationHandler(deps)(req('https://app.example',{...evidence,protectionReview:{...dailyReview,hold:scenarioRows.filter(s=>[5,10,20,30].includes(s.declinePct))}}))
  assert.equal(legacyResponse.status,400,'old cached four-shock evidence requires a refresh')
  assert.match((await legacyResponse.json()).error,/Refresh/)
  assert.equal(calls,beforeLegacy,'invalid cached evidence must not reach the provider')
  const dailyFetch: typeof fetch = async (_url,init) => {
    const body = JSON.parse(String(init?.body))
    const supplied = JSON.parse(body.input)
    assert.deepEqual(supplied.protectionReview.hold.map((s:{declinePct:number})=>s.declinePct),[5,10,15,20,30,40])
    assert.equal(supplied.protectionReview.targetEquityPct,57)
    assert.equal(supplied.protectionReview.horizonDays,365)
    assert.deepEqual(supplied.protectionReview.survival,dailySummary)
    assert.match(body.instructions,/prioritize protectionReview\.survival/)
    assert.match(body.instructions,/ALL modeled paths/)
    assert.match(body.instructions,/configured equity floor/)
    assert.doesNotMatch(body.instructions,/the 50% equity floor/)
    assert.match(body.instructions,/daily/i)
    assert.match(body.instructions,/worst.*(?:point|checkpoint)|(?:point|checkpoint).*worst/i)
    assert.match(body.instructions,/risk reduction/i)
    assert.match(body.instructions,/imperfect/i)
    assert.doesNotMatch(body.instructions,/four 5\/10\/20\/30|Intrinsic-only horizon/)
    return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(review)}]}]})
  }
  assert.equal((await createAiAllocationHandler({...deps,fetch:dailyFetch})(req('https://app.example',{...evidence,protectionReview:dailyReview}))).status,200)
  console.log('Allocation API validation, shared quota, provider failures, existing insurance and expiration alignment passed')
}
void endpointTests().catch((error) => { console.error(error); process.exitCode = 1 })

const protectionReview = {targetEquityPct:50,horizonDays:30,ratePct:8,evidenceComplete:false,missingCount:1,quoteFetchedAt:'',candidate:null,hold:[5,10,15,20,30,40].map(declinePct=>({declinePct,equity:10000,equityPct:50,floorGap:0,maintenanceGap:null,premium:0,closeCredit:0,fees:0,financing:50}))}
assert.deepEqual(validateAllocationEvidence({...evidence,protectionReview}).protectionReview,protectionReview,'AI receives the portfolio stress comparison')
assert.throws(()=>validateAllocationEvidence({...evidence,protectionReview:{...protectionReview,hold:protectionReview.hold.map((s,i)=>i===2?{...s,financing:NaN}:s)}}))
assert.ok(!JSON.stringify(validateAllocationEvidence({...evidence,protectionReview:{...protectionReview,accountId:'private-account'}})).includes('private-account'))
const manualReview=validateAllocationEvidence({...evidence,protectionReview:{...protectionReview,userDirected:true,quoteCurrent:true,quoteFetchedAt:new Date().toISOString()}}).protectionReview!
assert.equal(manualReview.userDirected,true)
assert.equal(manualReview.quoteCurrent,true,'fresh protection quotes do not depend on a separate legacy hedge quote')
assert.equal(manualReview.evidenceComplete,false,'fresh quotes do not imply complete model evidence')
assert.equal(validateAllocationEvidence({...evidence,protectionReview:{...protectionReview,userDirected:true,quoteCurrent:true,quoteFetchedAt:'2020-01-01T00:00:00Z'}}).protectionReview!.quoteCurrent,false)

// Reject cached endpoint-era evidence instead of silently padding missing shocks.
const legacyHold = protectionReview.hold.filter(s => [5,10,20,30].includes(s.declinePct))
assert.throws(() => validateAllocationEvidence({...evidence,protectionReview:{...protectionReview,hold:legacyHold}}), /invalid_protection_scenarios/)
for (const hold of [protectionReview.hold.slice(1), [...protectionReview.hold].reverse(), protectionReview.hold.map((s,i) => i === 2 ? {...s,declinePct:10} : s)]) {
  assert.throws(() => validateAllocationEvidence({...evidence,protectionReview:{...protectionReview,hold}}), /invalid_protection_scenario/)
}
const candidate = {meetsTargets:false,withinBudget:true,entryEquityPct:52,entryFloorGap:0,action:'ADD',strike:500,expiration:'2027-03-19',contracts:1,stress:protectionReview.hold}
assert.equal(validateAllocationEvidence({...evidence,protectionReview:{...protectionReview,candidate}}).protectionReview!.candidate!.stress.length,6)
assert.throws(() => validateAllocationEvidence({...evidence,protectionReview:{...protectionReview,candidate:{...candidate,stress:legacyHold}}}), /invalid_protection_scenarios/)
assert.throws(() => validateAllocationEvidence({...evidence,protectionReview:{...protectionReview,hold:protectionReview.hold.map((s,i)=>i===5?{...s,maintenanceGap:-1}:s)}}), /invalid_protection_scenario/)

const survival = {minimumExcess:-2500,maximumDeficiency:2500,firstDeficiency:'2026-12-01',scenarioCount:23,policy:'EMERGENCY'}
const allPathReview = {...protectionReview,targetEquityPct:57,horizonDays:365,survival:{...survival,accountId:'private-account'}}
const validatedAllPath = validateAllocationEvidence({...evidence,protectionReview:allPathReview}).protectionReview!
assert.equal(validatedAllPath.targetEquityPct,57)
assert.equal(validatedAllPath.horizonDays,365)
assert.deepEqual(validatedAllPath.survival,survival,'all-path HOLD summary is preserved and unknown fields are stripped')
assert.equal(validateAllocationEvidence({...evidence,protectionReview}).protectionReview!.survival,undefined,'older six-shock evidence without a summary remains supported')
for (const [targetEquityPct,horizonDays] of [[1,30],[99,36500],[55.5,730]]) {
  const accepted = validateAllocationEvidence({...evidence,protectionReview:{...protectionReview,targetEquityPct,horizonDays}}).protectionReview!
  assert.equal(accepted.targetEquityPct,targetEquityPct)
  assert.equal(accepted.horizonDays,horizonDays)
}
for (const targetEquityPct of [0,100,NaN,Infinity,'55']) assert.throws(()=>validateAllocationEvidence({...evidence,protectionReview:{...protectionReview,targetEquityPct}}),/invalid_protection_review/)
for (const horizonDays of [29,36501,NaN,Infinity,'365']) assert.throws(()=>validateAllocationEvidence({...evidence,protectionReview:{...protectionReview,horizonDays}}),/invalid_protection_review/)
assert.deepEqual(validateAllocationEvidence({...evidence,protectionReview:{...protectionReview,survival:{...survival,minimumExcess:null,firstDeficiency:null}}}).protectionReview!.survival,{...survival,minimumExcess:null,firstDeficiency:null})
for (const invalid of [null,{}, {...survival,minimumExcess:NaN}, {...survival,maximumDeficiency:-1}, {...survival,maximumDeficiency:Infinity}, {...survival,scenarioCount:0}, {...survival,scenarioCount:1.5}, {...survival,firstDeficiency:'2026-02-30'}, {...survival,firstDeficiency:'tomorrow'}, {...survival,policy:'IGNORE SAFETY'}]) {
  assert.throws(()=>validateAllocationEvidence({...evidence,protectionReview:{...protectionReview,survival:invalid}}),/invalid_protection_survival/)
}
