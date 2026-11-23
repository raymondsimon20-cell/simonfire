import { strict as assert } from 'node:assert'
import { buildProtectionOrderDraft, priceRisk, protectionAiEvidence, protectionChoice, protectionStress, rankPortfolioProtection, riskKey } from '../src/lib/portfolio-protection'
import { simulateSurvival } from '../src/lib/margin-survival'
import type { ProtectionInput } from '../src/lib/portfolio-protection'
import type { Position } from '../src/lib/types'

const shocks = [5, 10, 15, 20, 30, 40]
const stock = { id: 'stock', accountId: 'a', symbol: 'TEST', shares: 1000, lastPrice: 100 } as Position
const put = { id: 'put', accountId: 'a', symbol: 'QQQ 261218P00500000', underlying: 'QQQ', shares: 1, lastPrice: 1000, avgCost: 800, isOption: true, optionType: 'Put', strike: 500, expiration: '2026-12-18' } as Position
const input: ProtectionInput = {
  positions: [stock, put],
  risks: { [riskKey(stock)]: { beta: 1.5, correlation: .8, source: 'Aligned daily return history', leverage: 2, maintenancePct: 50, maintenanceSource: 'Broker lookup' } },
  gross: 101000, debt: 40000, qqqPrice: 500, today: '2026-10-30', horizonDays: 30, ratePct: 12, feePerContract: 1, budget: 20000,
  quotes: [{ symbol: put.symbol, expiration: put.expiration!, strike: 500, ask: 11, bid: 10, multiplier: 100, quoteTime: Date.parse('2026-10-30T12:00:00Z') }, { symbol: 'QQQ 270319P00500000', expiration: '2027-03-19', strike: 500, ask: 15, bid: 14.9, multiplier: 100, quoteTime: Date.parse('2026-10-30T12:00:00Z') }],
  quoteFetchedAt: '2026-10-30T12:00:00Z', now: Date.parse('2026-10-30T12:00:01Z'), delayed: false,
  broker: { optionMaintenanceVerified: true },
  survivalSettings: { optionMaintenance: 'zero', maintenanceCushion: 0, floorPct: 50, closeGapDays: 1 },
}
const near = (actual: number, expected: number, message: string) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} vs ${expected}`)
const dayOf = (date: string) => Math.round((Date.parse(date) - Date.parse(input.today)) / 86400000)
// Independent ledger: interest is charged on each day's opening debit; positive
// settlement pays debt first. Fixtures below have enough debt to absorb proceeds.
function ledger(debt: number, days: number, payments: Record<number, number>) {
  let interest = 0
  for (let day = 1; day <= days; day++) {
    const daily = debt * input.ratePct / 100 / 365
    debt += daily
    interest += daily
    debt -= payments[day] ?? 0
  }
  return { debt, interest }
}

const hold = protectionStress(input)
assert.deepEqual(hold.map(s => s.declinePct), shocks)
const held20 = hold.find(s => s.declinePct === 20)!
assert.equal(held20.portfolioLoss, 30000, 'observed beta already includes leverage')
const holdPath = simulateSurvival(input, { id: 'hold', label: 'Hold' }, { id: 'crash-20', label: 'Crash', kind: 'crash', declinePct: 20 }, input.survivalSettings, input.broker)
const comparisonDays = dayOf(input.quotes[1].expiration)
assert.equal(holdPath.points.at(-1)!.day, comparisonDays, 'hold and replacement use a shared daily horizon through the later expiration')
const expiryDay = dayOf(put.expiration!)
const payoff = (500 - 500 * .8) * 100
const holdLedger = ledger(input.debt, comparisonDays, { [expiryDay]: payoff - input.feePerContract })
near(held20.debt, holdLedger.debt, 'expiry proceeds repay debt and reduce subsequent daily interest')
near(held20.financing, holdLedger.interest, 'daily financing reconciles with independent cash ledger')
assert.equal(held20.gross, 70000, 'settled put is removed from assets, not retained as phantom protection')
near(held20.equity, 70000 - holdLedger.debt, 'settlement preserves economic payoff in net equity')
assert.equal(held20.putChange, -1000, 'terminal option mark is distinct from realized settlement cash')
const beforeExpiry = holdPath.points.find(p => p.day === expiryDay - 1)!
const atExpiry = holdPath.points.find(p => p.day === expiryDay)!
assert.ok(beforeExpiry.hedgeValue >= payoff)
assert.equal(atExpiry.hedgeValue, 0)
assert.equal(atExpiry.coverage, 0)
near(atExpiry.debt, beforeExpiry.debt * (1 + .12 / 365) - payoff + 1, 'expiration settles payoff once after daily financing')
near(held20.maintenanceGap!, Math.max(0, ...holdPath.points.map(p => -(p.maintenanceExcess ?? 0))), 'reported maintenance gap is worst daily deficiency')
near(held20.floorGap, Math.max(0, ...holdPath.points.map(p => p.gross * .5 - p.equity)), 'floor gap is worst daily checkpoint, not endpoint alone')

const fullValueSettings = { ...input.survivalSettings, optionMaintenance: 'full-value' as const }
const fullValueInput = { ...input, survivalSettings: fullValueSettings }
const fullValue40 = protectionStress(fullValueInput).find(s => s.declinePct === 40)!
const fullValuePath = simulateSurvival(fullValueInput, { id: 'hold', label: 'Hold' }, { id: 'crash-40', label: 'Crash', kind: 'crash', declinePct: 40 }, fullValueSettings, input.broker)
const terminalGap = Math.max(0, -fullValuePath.points.at(-1)!.maintenanceExcess!)
assert.ok(fullValue40.maintenanceGap! > terminalGap, 'settlement recovery must not erase an earlier deficiency')
near(fullValue40.maintenanceGap!, Math.max(...fullValuePath.points.map(p => Math.max(0, -p.maintenanceExcess!))), 'maximum maintenance shortfall includes pre-expiry checkpoints')

const rollInput: ProtectionInput = { ...input, closePositionId: put.id }
const rolled20 = protectionStress(rollInput, { quote: input.quotes[1], contracts: 2 }).find(s => s.declinePct === 20)!
assert.equal(rolled20.premium, 3000)
assert.equal(rolled20.closeCredit, 1000)
assert.equal(rolled20.fees, 3)
assert.equal(rolled20.netDebit, 2003)
const replacementExpiry = dayOf(input.quotes[1].expiration)
const rollLedger = ledger(40000 - 1000 + 1, replacementExpiry, { 1: -(3000 + 2), [replacementExpiry]: 2 * payoff - 2 })
near(rolled20.debt, rollLedger.debt, 'sequential close, replacement and expiration reconcile')
near(rolled20.financing, rollLedger.interest, 'roll financing reflects daily debit changes')
assert.equal(rolled20.newPayoff, 0, 'replacement has settled by final checkpoint; zero terminal mark is not zero economic payoff')
assert.equal(rolled20.putChange, 0, 'closed put is excluded from existing hedge accounting')
assert.equal(rolled20.gross, 70000)

const ranked = rankPortfolioProtection(input)
assert.equal(ranked.ready, true, 'explicit option treatment and verified evidence complete the gate')
assert.ok(ranked.candidates.length > 0)
assert.equal(rankPortfolioProtection({ ...input, risks: {} }).recommendation, null)
for (const incomplete of [
  { ...input, risks: {} },
  { ...input, delayed: true },
  { ...input, broker: {} },
  { ...input, survivalSettings: undefined },
  { ...input, accountCount: 2 },
  { ...input, now: Date.parse(input.quoteFetchedAt!) + 300001 },
  { ...input, risks: { [riskKey(stock)]: { ...input.risks[riskKey(stock)], source: undefined } } },
  { ...input, risks: { [riskKey(stock)]: { ...input.risks[riskKey(stock)], maintenancePct: undefined } } },
]) {
  assert.equal(rankPortfolioProtection(incomplete).ready, false)
  assert.equal(buildProtectionOrderDraft(incomplete, { symbol: input.quotes[1].symbol, contracts: 1 }, 'a', true), null)
  assert.equal(buildProtectionOrderDraft({ ...incomplete, riskAcknowledged: true, limitOverride: true }, { symbol: input.quotes[1].symbol, contracts: 1 }, 'a', true, 'on-demand'), null, 'manual drafts cannot bypass missing survival evidence')
}
assert.equal(rankPortfolioProtection({ ...input, risks: { [riskKey(stock)]: { ...input.risks[riskKey(stock)], leverage: undefined } } }).ready, true)
assert.equal(rankPortfolioProtection({ ...input, quotes: input.quotes.map(q => ({ ...q, multiplier: 10 })) }).candidates.length, 0)
assert.equal(rankPortfolioProtection({ ...rollInput, quotes: input.quotes.map((q, i) => i === 0 ? { ...q, multiplier: 10 } : q) }).ready, false)
assert.equal(protectionStress({ ...rollInput, quotes: input.quotes.map((q, i) => i === 0 ? { ...q, multiplier: 10 } : q) }, { quote: input.quotes[1], contracts: 2 })[0].closeCredit, 0)

const tradeInput: ProtectionInput = { ...input, positions: [stock], gross: 100000, debt: 30000, ratePct: 0, feePerContract: 0, maxContracts: 3, budget: 5000, risks: { [riskKey(stock)]: { beta: 1, correlation: 1, maintenancePct: 0, source: 'Synthetic history', maintenanceSource: 'Synthetic broker requirement' } }, quotes: [input.quotes[1]] }
const qualifying = rankPortfolioProtection(tradeInput)
assert.equal(qualifying.ready, true)
assert.equal(qualifying.holdMeetsFloor, false)
assert.ok(qualifying.recommendation, 'fixture requires protection under full scenario set')
const candidate = qualifying.recommendation!
assert.ok(candidate.survival.scenarios.every(s => s.survives && s.points.every(p => p.equityPct >= 50 && p.maintenanceExcess! >= 0)), 'qualified strategy survives every daily checkpoint, including correlation and house stress')
assert.ok(candidate.withinBudget)
const unverifiedReplacement = rankPortfolioProtection({ ...tradeInput, broker: {} })
assert.equal(unverifiedReplacement.recommendation, null, 'a replacement requires verified option maintenance even without existing puts')
assert.ok(unverifiedReplacement.candidates.every(c => !c.meetsFloor))
const immediateBreach = rankPortfolioProtection({ ...tradeInput, debt: 49999 })
assert.ok(immediateBreach.candidates.every(c => c.entry.floorGap > 0 && !c.meetsFloor), 'later payoff cannot excuse an immediate floor breach')
const selection = { symbol: candidate.quote.symbol, contracts: candidate.contracts }
const draft = buildProtectionOrderDraft(tradeInput, selection, 'a', true)!
assert.ok(draft)
assert.equal(draft.accountId, 'a')
assert.equal(draft.contracts, selection.contracts)
assert.equal(draft.premiumPerShare, candidate.quote.ask)
assert.equal(draft.grossPremium, candidate.quote.ask! * 100 * selection.contracts)
assert.equal(draft.previewState, 'not_previewed')
assert.equal(draft.orderId, undefined)
assert.equal(buildProtectionOrderDraft(tradeInput, selection, 'other-account', true), null)
assert.equal(buildProtectionOrderDraft(tradeInput, selection, 'a', false), null)
const safe = rankPortfolioProtection({ ...tradeInput, debt: 0 })
assert.equal(safe.holdMeetsFloor, true)
assert.equal(safe.recommendation, null)
assert.equal(buildProtectionOrderDraft({ ...tradeInput, debt: 0 }, selection, 'a', true), null, 'do not prepare model-directed protection when holding already qualifies')
const unsafe = rankPortfolioProtection({ ...tradeInput, debt: 49000, budget: 0 })
assert.equal(unsafe.recommendation, null, 'no qualifying hedge must not force a trade')
assert.ok(unsafe.candidates.every(c => !c.meetsFloor))
assert.equal(buildProtectionOrderDraft({ ...tradeInput, debt: 49000, budget: 0 }, selection, 'a', true), null)
const gapRanking = rankPortfolioProtection({ ...tradeInput, positions: [stock, put], gross: 101000, debt: 40000, closePositionId: put.id, quotes: input.quotes })
assert.equal(gapRanking.recommendation, null, 'eventual payoff cannot excuse an unsafe close-before-replacement gap')
assert.ok(gapRanking.candidates.every(c => c.survival.failures.length > 0))

// Explicit user intent can override model preferences, never missing evidence,
// account identity, contract validation, fresh quotes or confirmation of balances.
const manual = buildProtectionOrderDraft({ ...tradeInput, debt: 0 }, selection, 'a', true, 'on-demand')!
assert.ok(manual)
assert.equal(manual.source, 'manual')
assert.equal(manual.previewState, 'not_previewed')
const manualRisk = { ...tradeInput, budget: 0, debt: 80000 }
assert.equal(buildProtectionOrderDraft(manualRisk, selection, 'a', true, 'on-demand'), null)
assert.equal(buildProtectionOrderDraft({ ...manualRisk, riskAcknowledged: true }, selection, 'a', true, 'on-demand'), null, 'risk acknowledgment does not override budget')
assert.equal(buildProtectionOrderDraft({ ...manualRisk, limitOverride: true }, selection, 'a', true, 'on-demand'), null, 'budget override does not acknowledge risk')
assert.ok(buildProtectionOrderDraft({ ...manualRisk, riskAcknowledged: true, limitOverride: true }, selection, 'a', true, 'on-demand'))
for (const contracts of [0, 1.5, 101]) assert.equal(buildProtectionOrderDraft(tradeInput, { ...selection, contracts }, 'a', true, 'on-demand'), null)
assert.equal(buildProtectionOrderDraft(tradeInput, selection, 'other-account', true, 'on-demand'), null)
assert.equal(buildProtectionOrderDraft(tradeInput, selection, 'a', false, 'on-demand'), null)
assert.equal(buildProtectionOrderDraft({ ...tradeInput, quotes: tradeInput.quotes.map(q => ({ ...q, multiplier: 10 })) }, selection, 'a', true, 'on-demand'), null)
assert.equal(buildProtectionOrderDraft({ ...tradeInput, closePositionId: 'missing-put' }, selection, 'a', true, 'on-demand'), null)
const rollDraft = buildProtectionOrderDraft({ ...tradeInput, riskAcknowledged: true, positions: [stock, put], gross: 101000, closePositionId: put.id, quotes: input.quotes }, selection, 'a', true, 'on-demand')!
assert.ok(rollDraft)
assert.equal(rollDraft.closeOptionSymbol, put.symbol)
assert.equal(rollDraft.closeContracts, 1)
assert.equal(rollDraft.contracts, selection.contracts)
assert.equal(rollDraft.closeLimitCredit, 10)
assert.equal(rollDraft.closePreviewState, 'not_previewed')
assert.equal(rollDraft.closeOrderId, undefined)
const early = { symbol: 'QQQ 261120P00500000', expiration: '2026-11-20', strike: 500, ask: 5, bid: 4.9, multiplier: 100, quoteTime: Date.parse('2026-10-30T12:00:00Z') }
const earlyInput = { ...tradeInput, riskAcknowledged: true, quotes: [early] }
assert.ok(buildProtectionOrderDraft(earlyInput, { symbol: early.symbol, contracts: 1 }, 'a', true, 'on-demand'))
const earlyChoice = protectionChoice(earlyInput, { symbol: early.symbol, contracts: 1 })!
const early20 = earlyChoice.stress.find(s => s.declinePct === 20)!
assert.equal(early20.newPayoff, 0)
assert.equal(early20.debt, tradeInput.debt + 500 - payoff, 'short-lived option payoff settles into debt rather than disappearing')
assert.equal(protectionChoice({ ...tradeInput, risks: {} }, selection)?.meetsFloor, false)
// Six crash summaries alone can look safe while correlation stress fails.
const proxyMismatch = { ...tradeInput, debt: 35000 }
const proxyChoice = protectionChoice(proxyMismatch, { symbol: selection.symbol, contracts: 1 })!
assert.equal(proxyChoice.survival.qualifies, false)
assert.ok(proxyChoice.survival.scenarios.some(path => path.id === 'correlation' && path.points.some(point => point.equityPct < 50)), 'correlation path explains the failed qualification')
assert.ok(proxyChoice.stress.every(s => s.floorGap === 0 && s.maintenanceGap === 0), 'fixture is safe under each of the six crash summaries')
assert.equal(proxyChoice.meetsFloor, false, 'manual comparison must include correlation and other full-path constraints')
assert.equal(protectionAiEvidence(proxyMismatch, true, { symbol: selection.symbol, contracts: 1 }).candidate?.meetsTargets, false, 'AI must not endorse a custom choice based on six crashes alone')
assert.equal(buildProtectionOrderDraft(proxyMismatch, { symbol: selection.symbol, contracts: 1 }, 'a', true, 'on-demand'), null, 'broader scenario failure requires risk acknowledgment')
assert.ok(buildProtectionOrderDraft({ ...proxyMismatch, riskAcknowledged: true }, { symbol: selection.symbol, contracts: 1 }, 'a', true, 'on-demand'))


// A fresh chain download does not make an old individual contract current.
for (const quoteTime of [undefined, NaN, tradeInput.now! - 300001, tradeInput.now! + 1]) {
  const staleContract = { ...tradeInput, riskAcknowledged: true, limitOverride: true, quotes: tradeInput.quotes.map(q => ({ ...q, quoteTime })) }
  for (const mode of ['model', 'on-demand'] as const) {
    assert.equal(buildProtectionOrderDraft(staleContract, selection, 'a', true, mode), null, `${mode} rejects missing, invalid, stale or future contract timestamps even with overrides`)
  }
}
const boundaryQuote = { ...tradeInput, quotes: tradeInput.quotes.map(q => ({ ...q, quoteTime: tradeInput.now! - 300000 })) }
assert.ok(buildProtectionOrderDraft(boundaryQuote, selection, 'a', true), 'exactly five-minute-old contract quote remains eligible')
assert.ok(buildProtectionOrderDraft(boundaryQuote, selection, 'a', true, 'on-demand'))

const stricterPolicy = { ...tradeInput, survivalSettings: { ...tradeInput.survivalSettings, floorPct: 59, cautionPct: 60, normalPct: 65 } }
const strictChoice = protectionChoice(stricterPolicy, selection)!
assert.equal(strictChoice.meetsFloor, false, 'custom policy floor applies to every daily path')
assert.ok(strictChoice.survival.failures.some(f => /59%/.test(f)))
assert.equal(buildProtectionOrderDraft(stricterPolicy, selection, 'a', true, 'on-demand'), null)
assert.ok(buildProtectionOrderDraft({ ...stricterPolicy, riskAcknowledged: true }, selection, 'a', true, 'on-demand'))

const cushionPolicy = { ...tradeInput, survivalSettings: { ...tradeInput.survivalSettings, maintenanceCushion: 100000 } }
const cushionChoice = protectionChoice(cushionPolicy, selection)!
assert.ok(cushionChoice.survival.scenarios.every(path => path.survives), 'positive maintenance excess is distinct from the configured safety cushion')
assert.equal(cushionChoice.meetsFloor, false)
assert.ok(cushionChoice.survival.failures.some(f => /cushion/.test(f)))
assert.equal(buildProtectionOrderDraft(cushionPolicy, selection, 'a', true, 'on-demand'), null)
assert.ok(buildProtectionOrderDraft({ ...cushionPolicy, riskAcknowledged: true }, selection, 'a', true, 'on-demand'))

const quantityLimit = { ...tradeInput, maxContracts: 1 }
const overLimitSelection = { ...selection, contracts: 2 }
const overLimitChoice = protectionChoice(quantityLimit, overLimitSelection)!
assert.equal(overLimitChoice.withinBudget, false, 'contract count limit applies even when premium is within budget')
assert.equal(overLimitChoice.survival.qualifies, false)
assert.equal(buildProtectionOrderDraft(quantityLimit, overLimitSelection, 'a', true, 'on-demand'), null)
assert.equal(buildProtectionOrderDraft({ ...quantityLimit, riskAcknowledged: true }, overLimitSelection, 'a', true, 'on-demand'), null, 'quantity limit still requires a separate override')
assert.ok(buildProtectionOrderDraft({ ...quantityLimit, riskAcknowledged: true, limitOverride: true }, overLimitSelection, 'a', true, 'on-demand'))

const ai = protectionAiEvidence(input, true)
assert.deepEqual(ai.hold.map(s => s.declinePct), shocks)
assert.equal(ai.hold.find(s => s.declinePct === 20)!.financing, held20.financing)
assert.equal(ai.evidenceComplete, true)
const holdSurvival = ranked.survival.strategies[0]
assert.deepEqual(ai.survival, {minimumExcess:holdSurvival.minExcess,maximumDeficiency:holdSurvival.maxDeficiency,firstDeficiency:holdSurvival.firstDeficiency,scenarioCount:holdSurvival.scenarios.length,policy:ranked.survival.policy})
assert.ok(ai.survival!.scenarioCount > shocks.length, 'AI HOLD summary covers more than the six crash paths')
assert.equal(ai.horizonDays, comparisonDays)
const configuredAi = protectionAiEvidence(stricterPolicy, true, selection)
assert.equal(configuredAi.targetEquityPct,59, 'AI evidence preserves configured policy floor')
assert.equal(configuredAi.horizonDays,comparisonDays)
assert.equal(protectionAiEvidence(input, false).evidenceComplete, false)
assert.ok(!JSON.stringify(ai).includes('accountId'))
assert.ok(!JSON.stringify(ai).includes(put.symbol))
const manualAi = protectionAiEvidence(tradeInput, true, { ...selection, contracts: 2 })
const chosenForAi = protectionChoice(tradeInput, { ...selection, contracts: 2 })!
assert.deepEqual(protectionAiEvidence(tradeInput, true, { ...selection, contracts: 2 }, qualifying, chosenForAi), manualAi, 'reusing evaluated ranking and choice changes performance only, not evidence')
assert.equal(manualAi.userDirected, true)
assert.equal(manualAi.candidate?.contracts, 2)
assert.deepEqual(manualAi.candidate?.stress.map(s => s.declinePct), shocks)
assert.equal(manualAi.quoteCurrent, true)
assert.equal(protectionAiEvidence({ ...tradeInput, risks: {} }, true, selection).quoteCurrent, true)
assert.equal(protectionAiEvidence({ ...tradeInput, risks: {} }, true, selection).evidenceComplete, false)
assert.equal(protectionAiEvidence({ ...tradeInput, delayed: true }, true, selection).quoteCurrent, false)

const x: Record<string, number> = {}, y: Record<string, number> = {}
let a = 100, b = 100
for (let i = 0; i < 100; i++) {
  const r = i % 2 ? .01 : -.007
  a *= 1 + r; b *= 1 + 2 * r
  const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
  x[date] = a; y[date] = b
}
const risk = priceRisk(y, x)!
near(risk.beta, 2, 'aligned daily observed beta')
near(risk.correlation, 1, 'aligned daily observed correlation')
assert.equal(priceRisk({}, x), null)
console.log('Six-shock daily accounting, expiry settlement, full-path qualification, missing-evidence gates, model/manual drafts and AI privacy checks passed')

// Available cash funds the purchase before borrowing; displayed entry/costs must
// come from the very same strategy that determines qualification.
const cashFunded: ProtectionInput = {...tradeInput,gross:110000,debt:45000,ratePct:0,feePerContract:0,survivalSettings:{...tradeInput.survivalSettings,slippagePct:10},quotes:[{...tradeInput.quotes[0],ask:20,bid:19}]}
const cashChoice=protectionChoice(cashFunded,{symbol:cashFunded.quotes[0].symbol,contracts:1})!
near(cashChoice.stress[0].premium,2200,'displayed premium includes configured slippage')
near(cashChoice.stress[0].netDebit,cashChoice.survival.netDebit,'displayed trade debit matches simulated debit')
assert.equal(cashChoice.entry.debt,45000,'available cash prevents invented borrowing')
near(cashChoice.entry.debt,cashChoice.survival.postDebt,'adapter entry uses evaluated strategy')
near(cashChoice.entry.equityPct,cashChoice.survival.postEquityPct,'entry equity uses evaluated strategy')
