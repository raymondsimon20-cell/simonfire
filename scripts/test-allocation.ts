import assert from 'node:assert/strict'
import { allocationOrders, allocationProjection, type AllocationHolding } from '../src/lib/allocation-engine'
import type { Bucket } from '../src/lib/buckets'
import { contributionBudget } from '../src/lib/contribution-budget'
import { spendingExclusionKey } from '../src/lib/spending'
import type { Account, Transaction } from '../src/lib/types'

const budgets = { Growth: 300, CEFs: 0, 'High Yield': 0, Leveraged: 0 }
const row = (symbol: string, value: number, price = 10, trendScore?: number): AllocationHolding => ({ symbol, name: symbol, value, price, annualIncome: value * .04, trendScore })
const holdings: Record<Bucket, AllocationHolding[]> = { Growth: [row('LARGE', 2000, 10, 100), row('STRONG', 500, 10, 100), row('WEAK', 500, 10, -100)], CEFs: [], 'High Yield': [], Leveraged: [] }
const plain = allocationOrders(budgets, holdings, true)
assert.equal(plain.find((r) => r.symbol === 'LARGE'), undefined, 'do not add to an oversized position')
assert.deepEqual(plain.map((r) => r.spend), [150, 150])
const tilted = allocationOrders(budgets, holdings, true, 'trend')
assert.deepEqual(tilted.map((r) => r.spend), [180, 120])
assert.equal(tilted.reduce((sum, r) => sum + r.spend, 0), 300)
const equal = allocationOrders(budgets, holdings, true, 'equal')
assert.deepEqual(equal.map((r) => r.spend), [100, 100, 100])
const capped = allocationOrders(budgets, { ...holdings, Growth: [row('STRONG', 500, 10, 100), row('WEAK', 500, 10, -100)] }, true, 'trend')
assert.deepEqual(capped.map((r) => r.spend), [150, 150], 'trend cannot push a holding above its gap')
const noSignals = { ...holdings, Growth: holdings.Growth.map(({ trendScore: _score, ...r }) => r) }
assert.deepEqual(allocationOrders(budgets, noSignals, true, 'trend').map((r) => r.spend), plain.map((r) => r.spend))
const fractional = allocationOrders({ ...budgets, Growth: 1 }, { ...holdings, Growth: [row('FRACTION', 100, 3)] }, false)
assert.equal(fractional[0].shares, .333)
assert.ok(Math.abs(fractional[0].spend - .999) < 1e-10)
const badQuote = allocationOrders(budgets, { ...holdings, Growth: [row('NOQUOTE', 100, 0)] }, true)
assert.equal(badQuote.length, 0)
assert.equal(allocationOrders({ ...budgets, Growth: NaN }, holdings, true).length, 0)
assert.equal(allocationOrders({ ...budgets, Growth: 0, CEFs: 100 }, holdings, true).length, 0)
const p = allocationProjection(holdings, tilted)
assert.equal(p.spend, 300)
assert.equal(p.valueAfter, 3300)
assert.equal(p.addedIncome, 12)
assert.equal(p.yieldAfter, .04)
assert.equal(allocationProjection(holdings, []).valueAfter, 3000)

// Across different budgets, rounding can leave cash but never invent funding.
for (const whole of [false, true]) for (const sizing of ['gaps', 'equal', 'trend'] as const) {
  for (let budget = 1; budget <= 3000; budget += 37) {
    const orders = allocationOrders({ ...budgets, Growth: budget }, holdings, whole, sizing)
    assert.ok(orders.reduce((sum, r) => sum + r.spend, 0) <= budget + 1e-8)
    assert.ok(orders.every((r) => r.spend === r.shares * r.price))
  }
}
console.log('allocation tests passed: gaps, trend caps, neutral signals, rounding, budgets, and income projections')

const account: Account = { id: 'margin', broker: 'Schwab', name: 'Margin', fullName: 'Margin', mask: '1234', type: 'Margin', isMargin: true, cash: 0, marginBalance: 40000, equity: 60000, buyingPower: 50000 }
const txn = (id: string, date: string, type: Transaction['type'], amount: number): Transaction => ({ id, accountId: account.id, date, type, amount, description: id, units: 0, tags: [] })
const transactions = [
  txn('opening', '2026-06-15', 'Contribution', 5000), // Partial June excluded.
  txn('july-bills', '2026-07-10', 'Bill Payment', -9000),
  txn('july-interest', '2026-07-31', 'Interest', -400),
  txn('august-bills', '2026-08-10', 'Withdrawal', -10000),
  txn('august-fees', '2026-08-31', 'Fee', -600),
  txn('buy', '2026-07-20', 'Buy', -30000),
  txn('transfer', '2026-07-20', 'Transfer', -12000),
  txn('tax', '2026-07-20', 'Tax Withholding', -700),
  txn('current', '2026-09-10', 'Bill Payment', -50000),
  { ...txn('another-account', '2026-07-10', 'Bill Payment', -99999), accountId: 'other' },
]
const budget = contributionBudget(account, 100000, transactions, '2026-09-21')
assert.equal(budget.spending?.monthlyAverage, 10000)
assert.equal(budget.spending?.months, 2)
assert.equal(budget.reviewRows.length, 1)
assert.equal(budget.current?.maxOrderSpend, 20000)
assert.equal(budget.reserved?.maxOrderSpend, 0, 'cash withdrawals use twice the purchase headroom at a 50% equity floor')
assert.equal(budget.reserved?.projectedUsage(0), .5)
const exclusion = contributionBudget(account, 100000, transactions, '2026-09-21', [spendingExclusionKey(transactions[3])])
assert.equal(exclusion.spending?.monthlyAverage, 5000)
assert.equal(exclusion.reserved?.maxOrderSpend, 10000)
assert.equal(contributionBudget(account, 100000, transactions.map((t) => t.id === 'august-bills' ? { ...t, type: 'Transfer' as const } : t), '2026-09-21').spending?.monthlyAverage, 5000)
const cashAccount = { ...account, isMargin: false, cash: 15000, marginBalance: 0, equity: 115000 }
assert.equal(contributionBudget(cashAccount, 100000, transactions, '2026-09-21').reserved?.maxOrderSpend, 5000)
const withCash = { ...account, cash: 5000, equity: 65000 }
const cashBudget = contributionBudget(withCash, 100000, transactions, '2026-09-21')
assert.equal(cashBudget.reserved?.maxOrderSpend, 10000)
assert.equal(cashBudget.reserved?.projectedUsage(10000), .5)
assert.equal(contributionBudget(account, 100000, [], '2026-09-21').reserved, null)
assert.equal(contributionBudget(account, 100000, [transactions[8]], '2026-09-21').reserved, null)
assert.equal(contributionBudget({ ...account, buyingPower: 12000 }, 100000, transactions, '2026-09-21', [spendingExclusionKey(transactions[3])]).reserved?.maxOrderSpend, 7000)
console.log('expense budgeting passed: completed months, account scope, exclusions, reclassification, cash and margin reserves')
