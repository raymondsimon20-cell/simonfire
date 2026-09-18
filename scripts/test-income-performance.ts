import { strict as assert } from 'node:assert'
import { incomePerformance, incomeAndRealizedGains } from '../src/lib/income-performance'
import type { Transaction, TxnType } from '../src/lib/types'

const txn = (type: TxnType, amount: number, date = '2026-06-01', symbol?: string): Transaction => ({ id: `${type}-${amount}`, accountId: 'a', date, type, amount, symbol, description: '', units: 0, tags: [] })
const points = [{ date: '2026-04-08', value: 334 }, { date: '2026-09-16', value: 72140.60 }]
const transactions = [txn('Contribution', 132762.69), txn('Withdrawal', -60006.34), txn('Dividend', 6037.42), txn('Fee', -575.84)]
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)
// Arithmetic fixture based on the supplied statement; not a claim of data parity.
const r = incomePerformance(points, transactions)!
close(r.investmentChange, -949.75)
close(r.priceChange, -6411.33)
close(r.netIncome, 5461.58)
close(r.retained, -60956.09)
close(r.end.value, r.start.value + r.contributions - r.withdrawals + r.investmentChange + r.optionCash)
// A new deposit cannot improve investment performance or retained results.
const deposit = incomePerformance([points[0], { ...points[1], value: points[1].value + 10000 }], [...transactions, txn('Contribution', 10000)])!
close(deposit.investmentChange, r.investmentChange)
close(deposit.retained, r.retained)
// High cash coverage can coexist with capital depletion.
const erosion = incomePerformance([{ date: '2026-01-01', value: 10000 }, { date: '2026-07-01', value: 9000 }], [txn('Dividend', 1000), txn('Bill Payment', -800)])!
close(erosion.incomeAfterWithdrawals, 200)
close(erosion.investmentChange, -200)
close(erosion.priceChange, -1200)
close(erosion.retained, -1000)
// Option cash is explicitly separated, never mislabeled as a contribution or gain.
const option = incomePerformance([points[0], { ...points[1], value: points[1].value + 200 }], [...transactions, txn('Sell', 200, '2026-06-01', 'SPY 260619C00600000')])!
close(option.optionCash, 200)
close(option.investmentChange, r.investmentChange)
// Start is an existing end-of-day balance; include only later transactions.
const boundary = incomePerformance(points, [...transactions, txn('Dividend', 100, '2026-04-08'), txn('Dividend', 200, '2026-09-17'), txn('Interest', 25, '2026-09-16'), txn('Interest', -10), txn('Tax Withholding', -5), txn('Fee', 2), txn('Other', 0)])!
close(boundary.dividends, 6037.42)
close(boundary.interest, 25)
close(boundary.costs, 583.84)
close(boundary.taxes, 5)
assert.equal(boundary.needsReview, 1)
assert.deepEqual(incomePerformance([...points].reverse(), transactions), r)
assert.equal(incomePerformance([], transactions), null)
assert.equal(incomePerformance([points[0]], transactions), null)
assert.equal(incomePerformance([points[0], points[0]], transactions), null)
assert.equal(incomePerformance([points[0], { ...points[1], value: NaN }], transactions), null)
console.log('income performance tests passed')

// Earnings use inclusive selected dates, independent of available value history.
const earnings = incomeAndRealizedGains([
  txn('Dividend', 100, '2026-06-01'), txn('Interest', 5, '2026-06-30'),
  { ...txn('Sell', 1000), pl: 40 }, { ...txn('Sell', 500), pl: -15, plEstimated: true },
  txn('Interest', -10), txn('Fee', -3), txn('Fee', 1), txn('Tax Withholding', -8),
  txn('Contribution', 20000), txn('Withdrawal', -5000), txn('Buy', -2000),
  txn('Dividend', 999, '2026-05-31'), txn('Dividend', 999, '2026-07-01'),
  txn('Sell', 100), { ...txn('Sell', 200), positionEffect: 'Opening' },
], '2026-06-01', '2026-06-30')
close(earnings.realized, 25)
close(earnings.gross, 130)
close(earnings.marginInterest, 10)
close(earnings.fees, 2)
close(earnings.net, 118)
assert.equal(earnings.missingPl, 1)
assert.equal(earnings.estimated, true)
close(incomeAndRealizedGains([], '', '2026-06-30').gross, 0)
close(incomeAndRealizedGains([txn('Dividend', 12, '2020-01-01')], '', '2026-06-30').gross, 12)
