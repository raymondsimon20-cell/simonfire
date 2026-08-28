import { strict as assert } from 'node:assert'
import { protectivePutPlan } from '../src/lib/hedge'

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

console.log('protective put tests passed')
