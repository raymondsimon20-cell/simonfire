import assert from 'node:assert/strict'
import { bridgeTransactions, monthClose, portfolioSummary } from '../src/lib/calc'
import type { Transaction, TxnType } from '../src/lib/types'
const txn = (id: string, type: TxnType, amount: number, extra: Partial<Transaction> = {}): Transaction => ({ id, type, amount, accountId: 'a', date: '2026-06-15', description: '', units: 0, tags: [], ...extra })
const transactions = [
  txn('deposit', 'Contribution', 1000), txn('dividend', 'Dividend', 100), txn('interest', 'Interest', 5),
  txn('margin', 'Interest', -10), txn('fee', 'Fee', -2), txn('bill', 'Bill Payment', -40),
  txn('withdrawal', 'Withdrawal', -30), txn('tax', 'Tax Withholding', -3), txn('other', 'Other', 4),
  txn('gain', 'Sell', 500, { pl: 50 }), txn('loss', 'Sell', 100, { pl: -20 }),
  txn('missing', 'Sell', 200), txn('opening', 'Sell', 300, { positionEffect: 'Opening' }),
  txn('buy', 'Buy', -500), txn('transfer', 'Transfer', 200),
  txn('prior', 'Dividend', 999, { date: '2026-05-31' }), txn('next', 'Dividend', 999, { date: '2026-07-01' }),
]
const close = monthClose([], transactions, 'all', '2026-06', portfolioSummary([], [], 'all', transactions))
for (const step of [1, 2, 3]) {
  const rows = bridgeTransactions(transactions, close.ym, step)
  assert.equal(rows.reduce((sum, row) => sum + row.value, 0), close.bridge[step].value)
  assert.ok(rows.every((row) => row.transaction.date.startsWith('2026-06')))
}
assert.equal(close.bridge[2].value, 24)
assert.equal(close.bridge[3].value, 30)
assert.deepEqual(bridgeTransactions(transactions, close.ym, 3).map((r) => r.transaction.id), ['gain', 'loss', 'missing'])
assert.deepEqual(bridgeTransactions(transactions, close.ym, 5), [])
assert.deepEqual(bridgeTransactions([], close.ym, 2), [])
console.log('equity bridge tests passed')
