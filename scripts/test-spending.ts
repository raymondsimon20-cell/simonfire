import { strict as assert } from 'node:assert'
import { averagePortfolioSpending } from '../src/lib/spending'
import type { Transaction, TxnType } from '../src/lib/types'

const txn = (id: string, date: string, type: TxnType, amount: number): Transaction => ({ id, date, type, amount, accountId: 'a1', description: type, units: 0, tags: [] })
const result = averagePortfolioSpending([
  txn('partial', '2025-09-12', 'Withdrawal', -9_999),
  txn('oct-bill', '2025-10-02', 'Bill Payment', -1_000),
  txn('nov-withdrawal', '2025-11-15', 'Withdrawal', -2_000),
  txn('buy', '2025-12-01', 'Buy', -100_000),
  txn('tax', '2026-01-01', 'Tax Withholding', -5_000),
  txn('transfer', '2026-02-01', 'Transfer', -10_000),
], '2026-09-12')

assert.ok(result)
assert.equal(result.months, 11)
assert.equal(result.total, 3_000)
assert.equal(result.monthlyAverage, 272.73)
assert.equal(result.transactionCount, 2)
assert.equal(result.from, '2025-10')
assert.equal(result.to, '2026-08')
assert.equal(averagePortfolioSpending([], '2026-09-12'), null)
console.log('portfolio spending tests passed')
