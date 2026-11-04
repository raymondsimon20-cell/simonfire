import { strict as assert } from 'node:assert'
import { averageMonthlyContributions, averagePortfolioSpending, spendingExclusionKey } from '../src/lib/spending'
import type { Transaction, TxnType } from '../src/lib/types'

const txn = (id: string, date: string, type: TxnType, amount: number): Transaction => ({ id, date, type, amount, accountId: 'a1', description: type, units: 0, tags: [] })
const result = averagePortfolioSpending([
  txn('partial', '2025-09-12', 'Withdrawal', -9_999),
  txn('oct-bill', '2025-10-02', 'Bill Payment', -1_000),
  txn('nov-withdrawal', '2025-11-15', 'Withdrawal', -2_000),
  txn('buy', '2025-12-01', 'Buy', -100_000),
  txn('tax', '2026-01-01', 'Tax Withholding', -5_000),
  txn('transfer', '2026-02-01', 'Transfer', -10_000),
  txn('margin-interest', '2026-03-01', 'Interest', -550),
  txn('fee', '2026-04-01', 'Fee', -55),
  txn('positive-interest', '2026-05-01', 'Interest', 100),
], '2026-09-12')

assert.ok(result)
assert.equal(result.months, 11)
assert.equal(result.total, 3_605)
assert.equal(result.monthlyAverage, 327.73)
assert.equal(result.transactionCount, 4)
assert.equal(result.livingSpending, 3_000)
assert.equal(result.marginInterest, 550)
assert.equal(result.fees, 55)
assert.equal(result.taxWithholding, 5_000)
assert.equal(result.from, '2025-10')
assert.equal(result.to, '2026-08')
const excludedWithdrawal = txn('excluded', '2026-02-03', 'Withdrawal', -1_100)
const excluded = averagePortfolioSpending([
  txn('start', '2025-10-01', 'Other', 1),
  excludedWithdrawal,
], '2026-09-12', [spendingExclusionKey(excludedWithdrawal)])
assert.ok(excluded)
assert.equal(excluded.total, 0)
assert.equal(averagePortfolioSpending([], '2026-09-12'), null)
// Contributions: partial first month and the current month are skipped,
// internal transfers and non-deposit types are ignored.
const deposits = averageMonthlyContributions([
  txn('dep-partial', '2025-09-12', 'Contribution', 9_999),
  txn('dep-oct', '2025-10-01', 'Contribution', 3_000),
  txn('dep-nov', '2025-11-01', 'Contribution', 3_000),
  txn('dep-internal', '2025-11-20', 'Contribution', 5_000),
  txn('dep-div', '2025-12-01', 'Dividend', 800),
  txn('dep-neg', '2026-01-01', 'Contribution', -50),
  txn('dep-aug', '2026-08-15', 'Contribution', 5_000),
  txn('dep-current', '2026-09-05', 'Contribution', 7_000),
], '2026-09-12', new Set(['dep-internal']))
assert.ok(deposits)
assert.equal(deposits.months, 11)
assert.equal(deposits.total, 11_000)
assert.equal(deposits.monthlyAverage, +(11_000 / 11).toFixed(2))
assert.equal(deposits.transactionCount, 3)
assert.equal(averageMonthlyContributions([txn('only', '2026-09-02', 'Contribution', 100)], '2026-09-12'), null)
console.log('portfolio spending tests passed')
