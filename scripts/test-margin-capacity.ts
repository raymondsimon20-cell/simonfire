import assert from 'node:assert/strict'
import { marginCapacity } from '../src/lib/margin'
import type { Account } from '../src/lib/types'

const account = (overrides: Partial<Account>): Account => ({
  id: 'acc_1', broker: 'Schwab', name: 'Test', fullName: 'Test', mask: '0001',
  type: 'Margin', isMargin: true, cash: 10, marginBalance: 30, ...overrides,
})

const standard = marginCapacity(account({ equity: 70 }), 90)
assert.ok(standard)
assert.equal(standard.currentUsage, 0.3)
assert.equal(standard.maxOrderSpend, 50)
assert.equal(standard.projectedUsage(10), 0.3) // cash converted to securities
assert.equal(standard.projectedUsage(50), 0.5) // $40 borrowed reaches the ceiling

const brokerCapped = marginCapacity(account({ equity: 70, buyingPower: 25 }), 90)
assert.equal(brokerCapped?.maxOrderSpend, 25)
assert.equal(brokerCapped?.basis, 'buying power and 50% ceiling')

const alreadyOver = marginCapacity(account({ equity: 40, marginBalance: 60 }), 90)
assert.equal(alreadyOver?.currentUsage, 0.6)
assert.equal(alreadyOver?.alreadyOverLimit, true)
assert.equal(alreadyOver?.maxOrderSpend, 0)

const cashOnly = marginCapacity(account({
  type: 'Individual', isMargin: false, cash: 500, marginBalance: 0, buyingPower: 400,
}), 1000)
assert.equal(cashOnly?.maxOrderSpend, 400)
assert.equal(cashOnly?.projectedUsage(400), 0)

const fallback = marginCapacity(account({ equity: undefined }), 90)
assert.equal(fallback?.maxOrderSpend, 50) // gross $100, debt $30, cash $10
assert.equal(fallback?.projectedUsage(50), 0.5)

console.log('marginCapacity tests passed')
