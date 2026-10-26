import { strict as assert } from 'node:assert'
import { projectFire, cleanFireSettings, mergeFireModels, type FireSettings } from '../src/lib/fire-model'

const base: FireSettings = { mode: 'margin', annualSalary: 12000, monthlyExpenses: 500, inflationPct: 0, interestPct: 12, growthPct: 0, months: 12, cutPct: 0, minEquityPct: 25, enforceEquityLimit: true, pauseInvestmentsOverLimit: false, dripKeys: [], milestones: [] }
const starting = { dripValue: 0, cashValue: 10000, cash: 0, debt: 1000, dripYieldPct: 0, cashYieldPct: 12 }
const one = projectFire(starting, { ...base, months: 1 })
assert.equal(one.rows[0].salary, 1000, 'entire salary goes into assets')
assert.equal(one.rows[0].cashDividend, 100, 'dividends use opening holdings, not future salary')
assert.equal(one.rows[0].interest, 15, 'opening debt plus expenses incur monthly interest')
assert.equal(one.rows[0].debt, 1415, 'expenses and interest increase debt; cash dividends reduce it')
assert.equal(one.rows[0].gross, 11000, 'cash dividends used for debt are not added to portfolio too')
assert.equal(one.rows[0].net, 9585)
assert.equal(one.rows[0].net, 9000 + 1000 + 100 - 500 - 15, 'net-equity conservation')

const drip = projectFire({ ...starting, dripValue: 10000, cashValue: 0, dripYieldPct: 12 }, { ...base, months: 1 })
assert.equal(drip.rows[0].dripDividend, 100)
assert.equal(drip.rows[0].cashDividend, 0)
assert.equal(drip.rows[0].gross, 11100, 'DRIP compounds into assets')
assert.equal(drip.rows[0].debt, 1515, 'DRIP is not also spent to repay debt')

const debtFree = projectFire({ ...starting, debt: 0, cashYieldPct: 120 }, { ...base, interestPct: 0, months: 1 })
assert.equal(debtFree.rows[0].debt, 0)
assert.ok(Math.abs(debtFree.rows[0].surplusInvested - 500) < 0.000001)
assert.equal(debtFree.rows[0].gross, 11500, 'dividend surplus is invested once after debt reaches zero')

const cashOnly = projectFire(starting, { ...base, mode: 'cash', months: 1 })
assert.equal(cashOnly.rows[0].debt, 1000, 'cash-only comparison retains existing debt without new borrowing')
assert.equal(cashOnly.rows[0].assetSales, 410)
assert.equal(cashOnly.rows[0].gross, 10590)
assert.equal(cashOnly.rows[0].net, 9590)

const limit = projectFire({ ...starting, debt: 7400 }, { ...base, annualSalary: 0, months: 60, minEquityPct: 25 })
assert.equal(limit.stoppedMonth, 1, 'stop when modeled borrowing limit is exceeded')
assert.equal(limit.rows.length, 1)
assert.ok(limit.rows[0].unfunded > 0)
assert.equal(limit.crossoverMonth, null)

const milestones = projectFire(starting, { ...base, months: 2, interestPct: 0, milestones: [{ id: 'change', month: 2, annualSalary: 24000, monthlyExpenses: 100, contribution: 1000 }] })
assert.equal(milestones.rows[1].salary, 2000)
assert.equal(milestones.rows[1].expenses, 100)
assert.equal(milestones.rows[1].lumpSum, 1000)
const stress = projectFire(starting, { ...base, cutPct: 50, months: 1 })
assert.equal(stress.rows[0].cashDividend, 50)
assert.equal(projectFire(starting, { ...base, monthlyExpenses: 0 }).crossoverMonth, null, 'zero expenses do not imply a retirement date')
const covers = projectFire({ ...starting, debt: 0, cashYieldPct: 120 }, { ...base, interestPct: 0, months: 12 })
assert.equal(covers.crossoverMonth, 1)
assert.ok(covers.rows.every((r) => r.cashDividend >= r.expenses + r.interest))
const cleaned = cleanFireSettings({ ...base, months: 9999, growthPct: -999, annualSalary: NaN, dripKeys: ['a', 'a', null] })
assert.equal(cleaned.months, 360)
assert.equal(cleaned.growthPct, -95)
assert.equal(cleaned.annualSalary, 0)
assert.deepEqual(cleaned.dripKeys, ['a'])
assert.ok(projectFire(starting, cleaned).rows.every((r) => Number.isFinite(r.net)))
console.log('FIRE model cash routing, DRIP, conservation, limits, milestones, stress and input validation passed')

const openingBreach = projectFire({ ...starting, debt: 6000 }, { ...base, annualSalary: 24000, minEquityPct: 50 })
assert.equal(openingBreach.stoppedMonth, 0, 'future salary cannot conceal an opening equity breach')
assert.equal(openingBreach.final.gross, 10000)
assert.equal(openingBreach.final.salary, 0)
const collateralSale = projectFire({ ...starting, debt: 5000, cashYieldPct: 0 }, { ...base, mode: 'cash', annualSalary: 0, monthlyExpenses: 1000, interestPct: 0, minEquityPct: 50 })
assert.equal(collateralSale.stoppedMonth, 1, 'cash-only sales can breach collateral equity too')
assert.ok(collateralSale.final.equityPct < 50)
// Across both modes, every dollar must reconcile to net equity, including
// scenarios that stop with an unfunded expense rather than invented borrowing.
for (const mode of ['margin', 'cash'] as const) {
  for (const growthPct of [-20, 0, 7]) {
    const start = { dripValue: 30000, cashValue: 70000, cash: 500, debt: 20000, dripYieldPct: 8, cashYieldPct: 15 }
    const projection = projectFire(start, { ...base, mode, months: 60, growthPct, monthlyExpenses: 2000, inflationPct: 4, cutPct: 20 })
    let net = 80500
    for (const r of projection.rows) {
      net += r.salary + r.lumpSum + r.dripDividend + r.cashDividend + r.appreciation - r.expenses - r.interest + r.unfunded
      assert.ok(Math.abs(net - r.net) < 0.00001, `${mode} month ${r.month} net equity must conserve cash`)
      assert.ok(r.debt >= 0 && r.gross >= 0)
    }
  }
}

const fundingFailure = projectFire({ ...starting, cashValue: 50, debt: 0, cashYieldPct: 0 }, { ...base, mode: 'cash', annualSalary: 0, monthlyExpenses: 100, interestPct: 0 })
assert.equal(fundingFailure.stopReason, 'funding')
assert.equal(fundingFailure.final.unfunded, 50)
const storedModels = { 'account-391': base }
assert.deepEqual(mergeFireModels(storedModels, undefined)['account-391'], cleanFireSettings(base), 'old client omission preserves saved scenarios')
assert.equal(Object.keys(mergeFireModels(storedModels, { taxable: base })).length, 2, 'one scope save retains other scopes')
assert.equal(mergeFireModels(storedModels, { 'account-391': { ...base, annualSalary: 999 } })['account-391'].annualSalary, 999)

import { firePortfolio } from '../src/lib/fire-portfolio'
import type { Account, Position } from '../src/lib/types'
const liveAccounts = [{ id: 'live', mask: '391', name: 'Brokerage', type: 'Margin', isMargin: true, cash: 100, marginBalance: 1000, equity: 9250 }, { id: 'ira', mask: '870', type: 'Roth IRA', cash: 50000, marginBalance: 0, equity: 50000 }] as Account[]
const livePositions = [
  { id: 'stock', accountId: 'live', symbol: 'ABC', name: 'ABC', shares: 100, lastPrice: 100, avgCost: 80, prevClose: 99, annualDividend: 4, dividendsReceived: 0 },
  { id: 'put', accountId: 'live', symbol: 'ABC', name: 'Protective put', shares: 1, lastPrice: 120, avgCost: 100, prevClose: 110, dividendsReceived: 0, isOption: true },
] as Position[]
const live = firePortfolio(liveAccounts, livePositions, [], 'all', [], '2026-10-26')
assert.equal(live.accounts.length, 1)
assert.equal(live.holdings.length, 2, 'actual option holding is shown too')
assert.equal(live.actualGross, 10250, 'broker equity plus debt is the authoritative gross')
assert.equal(live.balanceAdjustment, 30, 'unallocated broker balance difference is explicit')
assert.equal(live.start.otherValue, 150)
assert.equal(live.start.cashYieldPct, 4)
assert.equal(projectFire(live.start, { ...base, months: 1 }).startingGross, 10250)
const updated = firePortfolio(liveAccounts, livePositions.map((p) => p.id === 'stock' ? { ...p, shares: 120, lastPrice: 110 } : p), [], 'all', ['391|ABC'], '2026-10-26')
assert.equal(updated.start.dripValue, 13200, 'current holdings and price changes immediately feed the model')
assert.equal(updated.actualGross, 10250, 'broker balance remains authoritative until a newer balance arrives')
assert.equal(updated.start.cashYieldPct, 0, 'reinvested holding is not also paid as cash')
for (const otherValue of [-200, 200]) {
  const staticProjection = projectFire({ ...starting, otherValue }, { ...base, months: 2, growthPct: 0, interestPct: 0 })
  assert.equal(staticProjection.startingGross, 10000 + otherValue)
  assert.equal(staticProjection.rows[0].cashDividend, 100, 'fixed marked assets earn no invented dividend')
  let net = 9000 + otherValue
  for (const r of staticProjection.rows) {
    net += r.salary + r.lumpSum + r.dripDividend + r.cashDividend + r.appreciation - r.expenses - r.interest + r.unfunded
    assert.ok(Math.abs(net - r.net) < 0.00001, 'signed broker reconciliation preserves net-equity accounting')
  }
}

const twoAccounts = firePortfolio([liveAccounts[0], { ...liveAccounts[0], id: 'joint', mask: '414' }], [livePositions[0], { ...livePositions[0], id: 'joint-stock', accountId: 'joint', annualDividend: undefined }], [], 'all', [], '2026-10-26')
assert.equal(twoAccounts.holdings.reduce((sum, h) => sum + h.income, 0), 800, 'shared security fundamentals scale to each account without partial double counting')

const fullTimeline = projectFire({ ...starting, debt: 7400 }, { ...base, annualSalary: 0, months: 60, minEquityPct: 50, enforceEquityLimit: false })
assert.equal(fullTimeline.rows.length, 60, 'full-timeline mode continues beyond an opening equity breach')
assert.equal(fullTimeline.final.month, 60)
assert.equal(fullTimeline.stoppedMonth, null)
assert.equal(fullTimeline.equityBreachMonth, 0)
assert.ok(fullTimeline.final.debt > 7400, 'hypothetical debt is not silently capped')
const firstMonthBreach = projectFire({ ...starting, debt: 4900 }, { ...base, annualSalary: 0, months: 60, minEquityPct: 50, enforceEquityLimit: false })
assert.equal(firstMonthBreach.equityBreachMonth, 1)
assert.equal(firstMonthBreach.rows.length, 60)
assert.equal(cleanFireSettings({ ...base, enforceEquityLimit: undefined }).enforceEquityLimit, false, 'existing saved scenarios default to a complete projection')
const cashCannotInventFunds = projectFire({ ...starting, cashValue: 50, debt: 0, cashYieldPct: 0 }, { ...base, mode: 'cash', annualSalary: 0, monthlyExpenses: 100, interestPct: 0, enforceEquityLimit: false })
assert.equal(cashCannotInventFunds.stopReason, 'funding', 'full timeline never invents cash-only borrowing')

const recovery = projectFire({ ...starting, debt: 6000, cashYieldPct: 0 }, { ...base, annualSalary: 24000, monthlyExpenses: 500, interestPct: 0, months: 3, minEquityPct: 50, enforceEquityLimit: false, pauseInvestmentsOverLimit: true })
assert.equal(recovery.rows[0].investmentPaused, true)
assert.equal(recovery.rows[0].salaryInvested, 0)
assert.equal(recovery.rows[0].salaryToMargin, 2000)
assert.equal(recovery.rows[0].debt, 4500)
assert.equal(recovery.rows[0].gross, 10000)
assert.equal(recovery.rows[1].investmentPaused, false, 'salary investment resumes once debt is under the equity limit')
assert.equal(recovery.rows[1].salaryInvested, 2000)
assert.equal(recovery.rows[1].salaryToMargin, 0)
assert.equal(recovery.rows[1].gross, 12000)
assert.equal(recovery.rows[1].cumulativeSalary, 2000, 'invested salary chart excludes salary paid toward margin')
const dripPause = projectFire({ dripValue: 10000, cashValue: 0, cash: 0, debt: 6000, dripYieldPct: 12, cashYieldPct: 0 }, { ...base, annualSalary: 12000, monthlyExpenses: 500, interestPct: 0, months: 1, minEquityPct: 50, enforceEquityLimit: false, pauseInvestmentsOverLimit: true })
assert.equal(dripPause.rows[0].dripDividend, 0)
assert.equal(dripPause.rows[0].dividendsRedirected, 100)
assert.equal(dripPause.rows[0].cashDividend, 100)
assert.equal(dripPause.rows[0].debt, 5400)
assert.equal(dripPause.rows[0].gross, 10000)
assert.equal(dripPause.rows[0].net, 4000 + 1000 + 100 - 500)
const preemptive = projectFire({ ...starting, debt: 4900, cashYieldPct: 0 }, { ...base, annualSalary: 12000, monthlyExpenses: 2000, interestPct: 0, months: 1, minEquityPct: 50, enforceEquityLimit: false, pauseInvestmentsOverLimit: true })
assert.equal(preemptive.rows[0].investmentPaused, true, 'a projected month-end breach pauses investment before it occurs')
assert.equal(preemptive.rows[0].salaryToMargin, 1000)
assert.equal(cleanFireSettings({}).pauseInvestmentsOverLimit, true)
const pausedMilestone = projectFire({ ...starting, debt: 6000, cashYieldPct: 0 }, { ...base, annualSalary: 12000, monthlyExpenses: 500, interestPct: 0, months: 1, minEquityPct: 50, enforceEquityLimit: false, pauseInvestmentsOverLimit: true, milestones: [{ id: 'bonus', month: 1, contribution: 1000 }] })
assert.equal(pausedMilestone.rows[0].lumpSumToMargin, 1000)
assert.equal(pausedMilestone.rows[0].debt, 4500)
assert.equal(pausedMilestone.rows[0].gross, 10000)
const cashComparison = projectFire(starting, { ...base, mode: 'cash', pauseInvestmentsOverLimit: true, months: 1 })
assert.equal(cashComparison.rows[0].investmentPaused, false, 'adaptive investing applies only to the margin strategy')
for (const growthPct of [-20, 0, 7]) {
  const adaptive = projectFire({ dripValue: 30000, cashValue: 70000, cash: 500, debt: 60000, dripYieldPct: 8, cashYieldPct: 15 }, { ...base, annualSalary: 48000, monthlyExpenses: 2000, months: 60, growthPct, minEquityPct: 50, pauseInvestmentsOverLimit: true, enforceEquityLimit: false })
  let net = 40500
  for (const r of adaptive.rows) {
    net += r.salary + r.lumpSum + r.dripDividend + r.cashDividend + r.appreciation - r.expenses - r.interest
    assert.ok(Math.abs(net - r.net) < 0.00001, `adaptive month ${r.month} conserves salary and dividend cash`)
    assert.ok(Math.abs(r.salaryInvested + r.salaryToMargin - r.salary) < 0.00001)
  }
}
