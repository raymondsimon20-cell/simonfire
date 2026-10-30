import { strict as assert } from 'node:assert'
import { priceRisk, protectionStress, rankPortfolioProtection, riskKey } from '../src/lib/portfolio-protection'
import type { ProtectionInput } from '../src/lib/portfolio-protection'
import type { Position } from '../src/lib/types'
const stock = { id: 'stock', accountId: 'a', symbol: 'TEST', shares: 1000, lastPrice: 100 } as Position
const put = { id: 'put', accountId: 'a', symbol: 'QQQ 261218P00500000', underlying: 'QQQ', shares: 1, lastPrice: 1000, isOption: true, optionType: 'Put', strike: 500, expiration: '2026-12-18' } as Position
const input: ProtectionInput = { positions: [stock, put], risks: { [riskKey(stock)]: { beta: 1.5, correlation: .8, source: 'Aligned daily return history', leverage: 2, maintenancePct: 50, maintenanceSource: 'Broker lookup' } }, gross: 101000, debt: 40000, qqqPrice: 500, today: '2026-10-30', horizonDays: 30, ratePct: 12, feePerContract: 1, budget: 20000, quotes: [{ symbol: put.symbol, expiration: put.expiration!, strike: 500, ask: 11, bid: 10, multiplier: 100 }, { symbol: 'QQQ 270319P00500000', expiration: '2027-03-19', strike: 500, ask: 15, bid: 14, multiplier: 100 }], quoteFetchedAt: '2026-10-30T12:00:00Z', now: Date.parse('2026-10-30T12:00:01Z'), delayed: false }
const hold = protectionStress(input)
assert.deepEqual(hold.map((s) => s.declinePct), [5,10,20,30])
assert.equal(hold[2].portfolioLoss, 30000, 'observed beta includes leverage; never multiply by 2 again')
assert.equal(hold[2].putChange, 9000, 'held put offsets use current mark, not original cost')
assert.ok(Math.abs(hold[2].financing - 40000 * .12 * 30 / 365) < 1e-8)
const roll = protectionStress({ ...input, closePositionId: 'put' }, { quote: input.quotes[1], contracts: 2 })[2]
assert.equal(roll.premium, 3000)
assert.equal(roll.closeCredit, 1000)
assert.equal(roll.fees, 3)
assert.equal(roll.netDebit, 2003)
assert.equal(roll.newPayoff, 20000)
assert.equal(roll.putChange, 0, 'closed put must not remain counted as existing protection')
assert.equal(roll.gross, 90000, 'remove the old mark and add the new payoff once')
assert.ok(Math.abs(roll.debt - (42003 * (1 + .12 * 30 / 365))) < 1e-8)
const ranked = rankPortfolioProtection(input)
assert.equal(ranked.ready, true)
assert.ok(ranked.candidates.length > 0)
assert.equal(rankPortfolioProtection({ ...input, risks: {} }).recommendation, null)
assert.equal(rankPortfolioProtection({ ...input, delayed: true }).ready, false)
assert.equal(rankPortfolioProtection({ ...input, quotes: input.quotes.map((q) => ({ ...q, multiplier: 10 })) }).candidates.length, 0)
const x: Record<string,number> = {}, y: Record<string,number> = {}; let a = 100, b = 100
for(let i=0;i<100;i++) { const r = i % 2 ? .01 : -.007; a *= 1+r; b *= 1+2*r; const d = new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10); x[d]=a; y[d]=b }
const risk = priceRisk(y,x)!
assert.ok(Math.abs(risk.beta - 2) < 1e-10)
assert.ok(Math.abs(risk.correlation - 1) < 1e-10)
assert.equal(priceRisk({},x),null)
console.log('Portfolio stress, held-vs-roll cash accounting, leverage, risk evidence checks passed')

assert.equal(rankPortfolioProtection({ ...input, closePositionId: 'put', quotes: input.quotes.map((q,i) => i===0 ? {...q,multiplier:10} : q) }).ready,false,'closing multiplier must be verified too')
assert.equal(protectionStress({ ...input, closePositionId: 'put', quotes: input.quotes.map((q,i) => i===0 ? {...q,multiplier:10} : q) },{quote:input.quotes[1],contracts:2})[0].closeCredit,0,'unsupported closing multiplier never fabricates proceeds')
assert.equal(rankPortfolioProtection({...input,risks:{[riskKey(stock)]:{...input.risks[riskKey(stock)],source:undefined}}}).ready,false)
const safe = rankPortfolioProtection({...input,debt:0,positions:[stock],gross:100000})
assert.equal(safe.holdMeetsFloor,true)
assert.equal(safe.recommendation,null,'do not recommend a purchase if holding already satisfies all target scenarios')
const boundary = rankPortfolioProtection({...input, positions:[stock], gross:100000, debt:48000.02, ratePct:0, feePerContract:0, maxContracts:3, budget:5000, risks:{[riskKey(stock)]:{beta:1,correlation:1,leverage:1,maintenancePct:0,source:'Synthetic test',maintenanceSource:'Synthetic test'}}, quotes:[{symbol:'QQQ 270319P00500000',expiration:'2027-03-19',strike:500,ask:10,bid:9.9,multiplier:100}]})
assert.equal(boundary.recommendation?.contracts,3,'a feasible quantity outranks a cheaper near-miss')

assert.equal(rankPortfolioProtection({...input,accountCount:2}).ready,false,'cash-only accounts contributing balances cannot bypass the single-account gate')
const entryBreach = rankPortfolioProtection({...input, positions:[stock], gross:100000, debt:49000.02, ratePct:0, feePerContract:0, maxContracts:10, budget:20000, risks:{[riskKey(stock)]:{beta:1.6,correlation:1,leverage:1,maintenancePct:0,source:'Synthetic test',maintenanceSource:'Synthetic test'}},quotes:[{symbol:'QQQ 270319P00500000',expiration:'2027-03-19',strike:500,ask:5,bid:4.9,multiplier:100}]})
assert.equal(entryBreach.recommendation,null,'future protection cannot justify an immediate equity-floor breach')

assert.equal(rankPortfolioProtection({...input,risks:{[riskKey(stock)]:{...input.risks[riskKey(stock)],leverage:undefined}}}).ready,true,'observed beta already includes leverage; separate leverage metadata is optional')
assert.equal(rankPortfolioProtection({...input,risks:{[riskKey(stock)]:{...input.risks[riskKey(stock)],maintenancePct:undefined}}}).ready,false,'missing broker maintenance must still block final advice')

import { protectionAiEvidence } from '../src/lib/portfolio-protection'
const aiStress = protectionAiEvidence(input, true)
assert.deepEqual(aiStress.hold.map(s=>s.declinePct),[5,10,20,30])
assert.equal(aiStress.hold[2].financing,hold[2].financing)
assert.equal(aiStress.evidenceComplete,true)
assert.equal(protectionAiEvidence(input,false).evidenceComplete,false)
assert.ok(!JSON.stringify(aiStress).includes('accountId'))
assert.ok(!JSON.stringify(aiStress).includes(put.symbol),'AI comparison sends numeric contract terms, not raw account positions')

import { buildProtectionOrderDraft } from '../src/lib/portfolio-protection'
const tradeInput: ProtectionInput = {...input, positions:[stock],gross:100000,debt:48000.02,ratePct:0,feePerContract:0,maxContracts:3,budget:5000,risks:{[riskKey(stock)]:{beta:1,correlation:1,maintenancePct:0,source:'Synthetic history',maintenanceSource:'Synthetic broker requirement'}},quotes:[{symbol:'QQQ 270319P00500000',expiration:'2027-03-19',strike:500,ask:10,bid:9.9,multiplier:100}]}
const selection={symbol:tradeInput.quotes[0].symbol,contracts:3}
const draft=buildProtectionOrderDraft(tradeInput,selection,'a',true)!
assert.ok(draft,'eligible portfolio protection can be prepared for user review')
assert.equal(draft.accountId,'a')
assert.equal(draft.contracts,3)
assert.equal(draft.premiumPerShare,10)
assert.equal(draft.grossPremium,3000)
assert.equal(draft.previewState,'not_previewed','a recommendation is never a broker preview or approval')
assert.equal(draft.orderId,undefined)
assert.equal(buildProtectionOrderDraft(tradeInput,selection,'other-account',true),null)
assert.equal(buildProtectionOrderDraft(tradeInput,selection,'a',false),null)
assert.equal(buildProtectionOrderDraft({...tradeInput,risks:{}},selection,'a',true),null)
assert.equal(buildProtectionOrderDraft({...tradeInput,now:Date.parse(input.quoteFetchedAt!)+300001},selection,'a',true),null)
assert.equal(buildProtectionOrderDraft(tradeInput,{...selection,contracts:2},'a',true),null,'infeasible quantity cannot become an order')
assert.equal(buildProtectionOrderDraft({...tradeInput,debt:0},selection,'a',true),null,'keep existing protection when holding already meets targets')
assert.equal(buildProtectionOrderDraft({...tradeInput,closePositionId:'missing-put'},selection,'a',true),null)
console.log('Protection orders require confirmed balances, a matching account, fresh quotes and feasible portfolio protection; previews remain separate')

const rollInput: ProtectionInput = {...tradeInput,positions:[stock,{...put,avgCost:800}],gross:101000,closePositionId:put.id,quotes:[...tradeInput.quotes,input.quotes[0]]}
const rollDraft=buildProtectionOrderDraft(rollInput,{...selection,contracts:2},'a',true)!
assert.ok(rollDraft,'a feasible roll produces a review ticket')
assert.equal(rollDraft.closeOptionSymbol,put.symbol)
assert.equal(rollDraft.closeContracts,1,'close the actual held quantity; replacement quantity is sized independently')
assert.equal(rollDraft.contracts,2)
assert.equal(rollDraft.closeLimitCredit,10)
assert.equal(rollDraft.closePreviewState,'not_previewed')
assert.equal(rollDraft.closeOrderId,undefined)
