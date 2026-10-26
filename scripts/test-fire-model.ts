import { strict as assert } from 'node:assert'
import { projectFire, cleanFireSettings, mergeFireModels, type FireSettings } from '../src/lib/fire-model'

const base: FireSettings = { mode: 'margin', annualSalary: 12000, monthlyExpenses: 500, inflationPct: 0, interestPct: 12, growthPct: 0, months: 12, cutPct: 0, minEquityPct: 25, dripKeys: [], milestones: [] }
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
