import { strict as assert } from 'node:assert'
import { incomePerformance, incomeAndRealizedGains, internalTransferIds, recordedIncomePerformance } from '../src/lib/income-performance'
import { statementHistory } from '../src/lib/statement-history'
import type { Account } from '../src/lib/types'
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

// Recorded months: margin borrowing and deposits are never investment gain.
{
  const acct: Account = { id: 'm', mask: '9414', broker: 'Schwab', name: 'M', fullName: 'M', type: 'Margin', isMargin: true, cash: 0, marginBalance: 0, equity: 0 }
  const month = (m: string, open: number, close: number, dep: number, wd: number, income: number, exp: number, loan: number) => ({ id: m, accountMask: '9414', month: m, openingEquity: open, closingEquity: close, deposits: dep, withdrawals: wd, dividendsInterest: income, expenses: exp, marketChange: close - open - dep - wd - income - exp, marginLoanBalance: loan, source: 'Schwab statement' as const, fileName: 's', importedAt: '2026-09-01' })
  // Raymond's May–Sep 2026: the price-series panel said +$44,225; statements say ~+$758.
  const rows = statementHistory([
    month('2026-05', 49164.41, 48750.81, 9018.93, -12519.42, 824.01, -168.95, 25122), month('2026-06', 48750.81, 48644.57, 9798.88, -9586.69, 754.93, -121.33, 14778),
    month('2026-07', 48644.57, 89313.57, 52636.10, -9458.38, 1029.82, -95.54, 16966), month('2026-08', 89313.57, 76560.75, 5177.58, -18358.35, 1784.24, -126.19, 61393),
    month('2026-09', 76560.75, 77196.37, 6437.03, -5871.28, 1727.09, 0, 70179),
  ], [acct], 'all')
  const r = recordedIncomePerformance(rows, [{ id: 'w', accountId: 'm', date: '2026-06-10', type: 'Withdrawal', amount: -3000, units: 0, description: '', tags: [] }])!
  assert.ok(Math.abs(r.investmentChange - 757.56) < 0.05, `got ${r.investmentChange}`)
  assert.equal(r.fromMonth, '2026-05')
  assert.ok(Math.abs(r.netIncome - (824.01 + 754.93 + 1029.82 + 1784.24 + 1727.09 - 168.95 - 121.33 - 95.54 - 126.19)) < 0.01)
  assert.equal(r.withdrawals, 3000, 'only money actually leaving (classified withdrawals), not internal transfers')
  assert.ok(Math.abs(r.beginning + r.deposits - r.statementWithdrawals + r.investmentChange - r.ending) < 0.01, 'reconciles to closing equity')
  console.log('recorded income performance tests passed')
}

// Transfers between your own accounts are not money leaving.
{
  const t = (id: string, accountId: string, date: string, type: TxnType, amount: number): Transaction => ({ id, accountId, date, type, amount, units: 0, description: '', tags: [] })
  const pool = [
    t('w1', 'a', '2026-04-10', 'Withdrawal', -50000), t('d1', 'b', '2026-04-11', 'Contribution', 50000), // internal move
    t('w2', 'a', '2026-04-15', 'Bill Payment', -1200), // real bill
    t('w3', 'a', '2026-04-20', 'Withdrawal', -300), t('d3', 'b', '2026-05-15', 'Contribution', 300), // too far apart
    t('w4', 'a', '2026-04-22', 'Withdrawal', -500), t('d4', 'a', '2026-04-22', 'Contribution', 500), // same account: not a transfer between accounts
  ]
  const ids = internalTransferIds(pool)
  assert.deepEqual([...ids].sort(), ['d1', 'w1'])
  console.log('internal transfer matching tests passed')
}

// Tax withheld is added back to income and shown as its own outflow (Schwab's convention).
{
  const acct: Account = { id: 'm', mask: '9414', broker: 'Schwab', name: 'M', fullName: 'M', type: 'Margin', isMargin: true, cash: 0, marginBalance: 0, equity: 0 }
  // Raymond's Feb 2026: statement income $2,027.71 = $2,551.18 gross - $523.47 withheld.
  const rows = statementHistory([{ id: 'f', accountMask: '9414', month: '2026-02', openingEquity: 60223.50, closingEquity: 56011.39, deposits: 7546.66, withdrawals: -9458.62, dividendsInterest: 2027.71, expenses: -241.03, marketChange: -4086.83, marginLoanBalance: 40247.99, source: 'Schwab statement', fileName: 's', importedAt: '2026-03-01' }], [acct], 'all')
  const tax: Transaction = { id: 't', accountId: 'm', date: '2026-02-27', type: 'Tax Withholding', amount: -523.47, units: 0, description: '', tags: [] }
  const r = recordedIncomePerformance(rows, [tax])!
  assert.ok(Math.abs(r.income - 2551.18) < 0.01)
  assert.equal(r.taxWithheld, 523.47)
  assert.ok(Math.abs(r.investmentChange - (-2300.15 + 523.47)) < 0.01, 'withholding is not an investment loss')
  assert.ok(Math.abs(r.beginning + r.deposits - r.statementWithdrawals - r.taxWithheld + r.investmentChange - r.ending) < 0.01)
  console.log('tax withholding tests passed')
}
