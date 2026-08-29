import { strict as assert } from 'node:assert'
import { buildPutPreviewOrder, portfolioPutHedge, protectivePutOutcome, protectivePutPlan, rankProtectivePut } from '../src/lib/hedge'

const optionOrder = buildPutPreviewOrder('QQQ   260918P00425000', 3, 8.126)
assert.deepEqual(optionOrder, {
  session: 'NORMAL', duration: 'DAY', orderType: 'LIMIT', price: '8.13', orderStrategyType: 'SINGLE',
  orderLegCollection: [{ instruction: 'BUY_TO_OPEN', quantity: 3, instrument: { symbol: 'QQQ   260918P00425000', assetType: 'OPTION' } }],
})
assert.equal(buildPutPreviewOrder('QQQ', 3, 8.13), null)
assert.equal(buildPutPreviewOrder('QQQ   260918P00425000', 0, 8.13), null)
assert.equal(buildPutPreviewOrder('QQQ   260918P00425000', 3, 0), null)

const full = protectivePutPlan({ shares: 250, sharePrice: 100, coveragePct: 100, maxDrawdownPct: 15, premiumPerShare: 2 })
assert.equal(full.contracts, 3)
assert.equal(full.coveredShares, 250)
assert.equal(full.strike, 85)
assert.equal(full.premiumCost, 600)
assert.equal(full.protectedNotional, 21250)
assert.equal(full.effectiveFloor, 83)
assert.equal(full.premiumDrag, 0.024)

const partial = protectivePutPlan({ shares: 250, sharePrice: 40, coveragePct: 40, maxDrawdownPct: 20, premiumPerShare: 1 })
assert.equal(partial.contracts, 1)
assert.equal(partial.coveredShares, 100)
assert.equal(partial.actualCoveragePct, 0.4)
assert.equal(partial.strike, 32)

const oddLot = protectivePutPlan({ shares: 250, sharePrice: 100, coveragePct: 100, maxDrawdownPct: 15, premiumPerShare: 2, contractRounding: 'down' })
assert.equal(oddLot.contracts, 2)
assert.equal(oddLot.coveredShares, 200)
assert.equal(oddLot.uncoveredShares, 50)
assert.equal(oddLot.overhedgedShares, 0)
assert.equal(oddLot.breakEvenPrice, 101.6)
assert.equal(oddLot.maxLoss, 8400)
assert.equal(oddLot.maxLossPct, 8400 / 25000)
const crash = protectivePutOutcome(oddLot, 0)
assert.equal(crash.terminalValue, 17000)
assert.equal(crash.pnl, -8400)
const rally = protectivePutOutcome(oddLot, 125)
assert.equal(rally.terminalValue, 31250)
assert.equal(rally.pnl, 5850)

const quoted = protectivePutPlan({ shares: 100, sharePrice: 100, coveragePct: 100, maxDrawdownPct: 15, premiumPerShare: 3, strikePrice: 82.5 })
assert.equal(quoted.suggestedStrike, 85)
assert.equal(quoted.strike, 82.5)
assert.equal(quoted.effectiveFloor, 79.5)

const liquidFit = rankProtectivePut({ strike: 87, ask: 2, mark: 1.9, bid: 1.8, last: 1.9, daysToExpiration: 91, openInterest: 1200, volume: 200 }, 100, 15, 90)
const thinFit = rankProtectivePut({ strike: 87, ask: 4, mark: 2.5, bid: 1, last: 2, daysToExpiration: 180, openInterest: 0, volume: 0 }, 100, 15, 90)
assert.equal(liquidFit.effectiveFloor, 85)
assert.ok(liquidFit.score > thinFit.score)
assert.ok(liquidFit.reasons.includes('tight spread'))

const portfolioHedge = portfolioPutHedge({ longExposure: 500000, qqqPrice: 500, portfolioQqqBeta: .8, targetQqqDeclinePct: 25, lossOffsetPct: 50, strikePrice: 425, premiumPerShare: 8, annualPremiumBudgetPct: 3 })
assert.equal(portfolioHedge.modeledPortfolioLoss, 100000)
assert.equal(portfolioHedge.desiredOffset, 50000)
assert.equal(portfolioHedge.grossPayoffPerContract, 5000)
assert.equal(portfolioHedge.netPayoffPerContract, 4200)
assert.equal(portfolioHedge.contracts, 12)
assert.equal(portfolioHedge.grossPremium, 9600)
assert.equal(portfolioHedge.monthlyGrossDebitBudget, 1250)
assert.equal(portfolioHedge.overMonthlyBudget, true)

console.log('protective put tests passed')
