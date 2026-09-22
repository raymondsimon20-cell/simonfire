import assert from 'node:assert/strict'
import './test-statement-transactions'
import { parseHistoricalBalanceCsv, parseSchwabStatementText } from '../src/lib/historical-balances'
import { availableMonths, monthClose, portfolioSummary } from '../src/lib/calc'
import { accountOpenMonths, coverageGap, flowContext, loanAssumption, statementTwr, mergeHistoricalBalances, statementHistory, statementProfit } from '../src/lib/statement-history'
import type { Account, Transaction } from '../src/lib/types'

const parsed = parseHistoricalBalanceCsv([
  'month,opening_equity,deposits,withdrawals,dividends_interest,market_change,expenses,closing_equity,net_loan_balance',
  '2026-08,87662.50,4667.58,-17203.18,1784.24,-1260.06,-126.19,75524.89,-61393.71',
].join('\n'))
assert.equal(parsed.length, 1)
assert.equal(parsed[0].closingEquity, 75524.89)
assert.equal(parsed[0].marginLoanBalance, 61393.71)
assert.equal(parsed[0].source, 'CSV')
console.log('historical balance tests passed')

const csv = 'month,opening_equity,deposits,withdrawals,dividends_interest,market_change,expenses,closing_equity,net_loan_balance\n2026-01,"$1,000.00",200,50,20,100,10,"$1,260.00",(400.00)'
const imported = parseHistoricalBalanceCsv(csv, 'balance.csv', '123')[0]
assert.equal(imported.withdrawals, -50)
assert.equal(imported.expenses, -10)
assert.equal(imported.accountMask, '123')
assert.equal(statementProfit(imported), 110)
assert.throws(() => parseHistoricalBalanceCsv('month,deposits\n2026-01,20'), /Missing/)
assert.throws(() => parseHistoricalBalanceCsv(csv.replace('2026-01', '2026-13')), /Missing/)
assert.throws(() => parseHistoricalBalanceCsv(csv.replace('200,50', 'bad,50')), /Invalid/)
assert.throws(() => parseHistoricalBalanceCsv(csv.replace('200,50', '500,50')), /reconcile/)

const text = 'Statement Period January 1-31, 2026 Account Number 0000-9123 Beginning Account Value $1,000.00 $0.00 Deposits 200.00 900.00 Withdrawals (50.00) (90.00) Dividends and Interest 20.00 80.00 Market Appreciation/(Depreciation) 100.00 500.00 Expenses (10.00) (80.00) Ending Account Value $1,260.00 $2,000.00 Net Loan Balance (400.00)'
const pdf = parseSchwabStatementText(text, 'statement.pdf')
assert.equal(pdf.month, '2026-01')
assert.equal(pdf.accountMask, '9123')
assert.equal(pdf.closingEquity, imported.closingEquity)
assert.equal(pdf.marginLoanBalance, 400)
assert.equal(parseSchwabStatementText(text.replace('Net Loan Balance (400.00)', ''), 'statement.pdf').marginLoanBalance, undefined)
assert.throws(() => parseSchwabStatementText('not a statement', 'bad.pdf'), /Could not find/)

const account: Account = { id: 'a', mask: '9123', broker: 'Schwab', name: 'A', fullName: 'A', type: 'Margin', isMargin: true, cash: 0, marginBalance: 9000, equity: 20000 }
const other: Account = { ...account, id: 'b', mask: '4567' }
const accounts = [account, other]
const merged = mergeHistoricalBalances([imported], [pdf], accounts)
assert.equal(merged.length, 1, 'CSV/PDF re-import and 3/4 digit masks must not double-count')
assert.equal(mergeHistoricalBalances([{ ...imported, accountMask: '' }], [pdf], [account]).length, 1, 'legacy single-account imports are recovered')
assert.equal(statementHistory(merged, accounts, 'b').length, 0, 'do not leak balances into another account')
assert.equal(statementHistory(merged, accounts, 'a')[0].complete, true)
assert.equal(statementHistory(merged, accounts, 'all')[0].complete, false)
assert.equal(statementHistory([{ ...pdf, accountMask: '' }], accounts, 'a').length, 0, 'ambiguous blank masks stay unassigned')
const combined = statementHistory([...merged, { ...pdf, accountMask: '4567' }], accounts, 'all')[0]
assert.equal(combined.closingEquity, 2520)
assert.equal(combined.marginLoanBalance, 800)
assert.equal(combined.complete, true)
// A cash/IRA statement never prints a Net Loan Balance line: that is $0 debt, not unknown.
const ira: Account = { ...other, id: 'c', mask: '7777', isMargin: false, type: 'Individual', marginBalance: 0 }
const withIra = statementHistory([pdf, { ...pdf, accountMask: '7777', marginLoanBalance: undefined }], [account, ira], 'all')[0]
assert.equal(withIra.marginLoanBalance, 400, 'non-margin statements contribute zero debt instead of blanking the month')
assert.equal(withIra.complete, true)
assert.equal(coverageGap(withIra), '')
// Margin-enabled account with no loan line: $0 unless a neighboring month shows a loan.
const idle = statementHistory([pdf, { ...pdf, accountMask: '4567', marginLoanBalance: undefined }], accounts, 'all')[0]
assert.equal(idle.marginLoanBalance, 400, 'margin-enabled but not borrowing counts as $0')
assert.match(loanAssumption(idle), /no loan line.*\$0/)
// A later import of the same month without a loan line keeps the known loan.
const kept = mergeHistoricalBalances([pdf], [{ ...pdf, marginLoanBalance: undefined, fileName: 'later.pdf' }], accounts)[0]
assert.equal(kept.marginLoanBalance, 400)
assert.equal(kept.fileName, 'later.pdf')
// Loan starting next month (Oct 2025) or paid off this month (Apr 2026): $0.
const startsNext = statementHistory([{ ...pdf, marginLoanBalance: undefined }, { ...pdf, month: '2026-02', marginLoanBalance: 900 }], [account], 'a').find((row) => row.month === '2026-01')!
assert.equal(startsNext.marginLoanBalance, 0, 'borrowing that starts next month')
const paidOff = statementHistory([{ ...pdf, month: '2025-12', marginLoanBalance: 900 }, { ...pdf, marginLoanBalance: undefined }], [account], 'a').find((row) => row.month === '2026-01')!
assert.equal(paidOff.marginLoanBalance, 0, 'loan paid off this month')
// Loan before AND after with no line in between: a parse miss, stays unknown.
const gap = statementHistory([{ ...pdf, month: '2025-12', marginLoanBalance: 900 }, { ...pdf, marginLoanBalance: undefined }, { ...pdf, month: '2026-02', marginLoanBalance: 950 }], [account], 'a').find((row) => row.month === '2026-01')!
assert.equal(gap.marginLoanBalance, undefined)
assert.match(coverageGap(gap), /Margin debt unknown: the A statement/)
// Missing statements are named so the user knows what to import.
const partial = statementHistory([pdf], [account, ira], 'all')[0]
assert.equal(partial.complete, false)
assert.deepEqual(partial.missingAccounts.map((row) => row.id), ['c'])
assert.match(coverageGap(partial), /No statement for A/)
const blankMask = statementHistory([{ ...pdf, accountMask: '' }], accounts, 'all')[0]
assert.equal(blankMask.complete, false)
assert.match(coverageGap(blankMask), /no account number.*re-import it with the account chosen/)
// Accounts that opened later are not expected before they opened.
const opensLater = [{ ...pdf, month: '2026-01' }, { ...pdf, accountMask: '7777', month: '2026-03', openingEquity: 0, closingEquity: 500 }, { ...pdf, month: '2026-03' }]
const later = statementHistory(opensLater, [account, ira], 'all')
assert.equal(later.find((row) => row.month === '2026-01')!.complete, true, 'a $0 first opening marks when the account started')
assert.equal(later.find((row) => row.month === '2026-03')!.complete, true)
assert.equal(accountOpenMonths(opensLater, [account, ira]).get('c')?.source, 'first statement')
// No $0 evidence: nothing is assumed until the user sets it.
const unknownStart = [{ ...pdf, month: '2026-01' }, { ...pdf, accountMask: '7777', month: '2026-03', openingEquity: 250 }]
assert.equal(statementHistory(unknownStart, [account, ira], 'all')[0].complete, false)
assert.equal(statementHistory(unknownStart, [account, ira], 'all', [], { '7777': '2026-02' })[0].complete, true, 'manual open month clears earlier gaps')
assert.equal(statementHistory(unknownStart, [account, ira], 'all', [], { '7777': 'bad' })[0].complete, false, 'invalid manual months are ignored')
const noOpening = statementHistory([{ ...pdf, openingEquity: undefined }], [account], 'all')[0]
assert.equal(noOpening.openingEquity, undefined)
assert.match(coverageGap(noOpening), /No opening balance for A: import the December 2025 statement/)
assert.deepEqual(availableMonths([], merged), ['2026-01'], 'statement-only months must be selectable')

const transactions: Transaction[] = [{ id: 't', accountId: 'a', date: '2026-01-10', type: 'Sell', amount: 10000, pl: 9999, units: 1, description: '', tags: [] }]
const summary = portfolioSummary([], accounts, 'all', transactions)
const close = monthClose(accounts, transactions, 'a', '2026-01', summary, merged)
assert.equal(close.balanceAvailable, true)
assert.equal(close.currentBalance, false)
assert.equal(close.historyAvailable, true)
assert.equal(close.closing, 1260)
assert.equal(close.netChange, 260)
assert.equal(close.liabilities, 400, 'use historical debt, not current debt')
assert.equal(close.assets, 1660)
assert.equal(close.bridge.slice(0, -1).reduce((sum, row) => sum + row.value, 0), close.closing, 'statement bridge reconciles without adding transaction P/L again')
assert.equal(monthClose(accounts, [], 'a', '2026-01', summary, [{ ...pdf, marginLoanBalance: undefined }]).liabilities, 0, 'margin-enabled, not borrowing')
assert.equal(monthClose(accounts, [], 'a', '2026-01', summary, [{ ...pdf, month: '2025-12', marginLoanBalance: 900 }, { ...pdf, marginLoanBalance: undefined }, { ...pdf, month: '2026-02', marginLoanBalance: 950 }]).debtAvailable, false, 'loan on both sides: missing line stays unknown')
assert.equal(monthClose(accounts, [], 'a', '2026-01', summary, [{ ...pdf, openingEquity: undefined }]).historyAvailable, false)
assert.equal(monthClose(accounts, [], 'b', '2026-01', summary, merged).balanceAvailable, false)
const now = new Date(); const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
assert.equal(monthClose(accounts, [], 'a', currentMonth, summary, [{ ...pdf, month: currentMonth }]).netEquity, 1260, 'an imported statement takes precedence over live balances for its month')
console.log('statement scope, import validation, and month-close reconciliation tests passed')

// Statement TWR: Modified Dietz per month, chained; deposits are never return.
{
  const acct: Account = { id: 'm', mask: '9414', broker: 'Schwab', name: 'M', fullName: 'M', type: 'Margin', isMargin: true, cash: 0, marginBalance: 0, equity: 0 }
  const month = (m: string, open: number, close: number, dep: number, wd: number) => ({ id: m, accountMask: '9414', month: m, openingEquity: open, closingEquity: close, deposits: dep, withdrawals: wd, dividendsInterest: 0, expenses: 0, marketChange: close - open - dep - wd, marginLoanBalance: 0, source: 'Schwab statement' as const, fileName: 's', importedAt: '2026-09-01' })
  // Raymond's real May–Sep 2026 figures: +2.66%, not the +37.84% the price series showed.
  const rows = statementHistory([
    month('2026-05', 49164.41, 48750.81, 9018.93, -12519.42), month('2026-06', 48750.81, 48644.57, 9798.88, -9586.69),
    month('2026-07', 48644.57, 89313.57, 52636.10, -9458.38), month('2026-08', 89313.57, 76560.75, 5177.58, -18358.35),
    month('2026-09', 76560.75, 77196.37, 6437.03, -5871.28),
  ], [acct], 'all')
  const twr = statementTwr(rows)
  assert.equal(twr.ok, true)
  assert.equal(twr.startMonth, '2026-05')
  assert.ok(Math.abs(twr.twrPct - 0.0266) < 0.0005, `expected ~2.66%, got ${twr.twrPct}`)
  assert.equal(statementTwr(rows, '2026-08').months, 2, 'window starts at the selected month')
  // A big deposit with no market change is 0% return.
  const depositOnly = statementTwr(statementHistory([month('2026-01', 10000, 60000, 50000, 0)], [acct], 'all'))
  assert.equal(depositOnly.twrPct, 0)
  // An unmeasurable month restarts the chain after it.
  const broken = statementTwr(statementHistory([month('2026-01', 100, 110, 0, 0), { ...month('2026-02', 110, 120, 0, 0), openingEquity: undefined }, month('2026-03', 120, 132, 0, 0)], [acct], 'all'))
  assert.equal(broken.startMonth, '2026-03')
  assert.ok(Math.abs(broken.twrPct - 0.1) < 1e-9)
  console.log('statement TWR tests passed')
}

{
  const acct: Account = { id: 'm', mask: '9414', broker: 'Schwab', name: 'M', fullName: 'M', type: 'Margin', isMargin: true, cash: 0, marginBalance: 0, equity: 0 }
  const rows = statementHistory([{ id: 'f', accountMask: '9414', month: '2026-02', openingEquity: 1000, closingEquity: 1000, deposits: 0, withdrawals: 0, dividendsInterest: 76, expenses: 0, marketChange: -76, marginLoanBalance: 0, source: 'Schwab statement', fileName: 's', importedAt: '2026-03-01' }], [acct], 'all')
  assert.equal(statementTwr(rows).twrPct, 0)
  assert.ok(Math.abs(statementTwr(rows, '', { withheld: new Map([['2026-02', 24]]), daily: new Map() }).twrPct - 24 / 988) < 1e-9, 'withheld tax counts as money leaving, not loss')
  console.log('statement TWR withholding tests passed')
}

// Flows are weighted by the day they happened.
{
  const acct: Account = { id: 'm', mask: '9414', broker: 'Schwab', name: 'M', fullName: 'M', type: 'Margin', isMargin: true, cash: 0, marginBalance: 0, equity: 0 }
  // Nov 2025 shape: small opening balance, big deposit early in the month.
  const rows = statementHistory([{ id: 'n', accountMask: '9414', month: '2025-11', openingEquity: 14509.04, closingEquity: 60125.96, deposits: 55620.55, withdrawals: -10037.61, dividendsInterest: 371.95, expenses: -8.86, marketChange: -329.11, marginLoanBalance: 0, source: 'Schwab statement', fileName: 's', importedAt: '2025-12-01' }], [acct], 'all')
  const t = (id: string, date: string, type: Transaction['type'], amount: number): Transaction => ({ id, accountId: 'm', date, type, amount, units: 0, description: '', tags: [] })
  const early = statementTwr(rows, '', flowContext([t('d', '2025-11-03', 'Contribution', 55620.55), t('w', '2025-11-25', 'Withdrawal', -10037.61)]))
  const late = statementTwr(rows, '', flowContext([t('d', '2025-11-27', 'Contribution', 55620.55), t('w', '2025-11-25', 'Withdrawal', -10037.61)]))
  const unknown = statementTwr(rows)
  assert.ok(Math.abs(early.twrPct) < Math.abs(unknown.twrPct), 'an early deposit enlarges the base, shrinking the % move')
  assert.ok(Math.abs(late.twrPct) > Math.abs(early.twrPct))
  assert.equal(early.gainUsd, unknown.gainUsd, 'timing changes the %, never the dollar result')
  // Internal transfer pairs don't count as flows.
  const ctx = flowContext([t('w1', '2025-11-05', 'Withdrawal', -500), { ...t('d1', '2025-11-06', 'Contribution', 500), accountId: 'other' }])
  assert.equal(ctx.daily.size ? [...ctx.daily.values()].reduce((a, b) => a + b, 0) : 0, 0)
  console.log('dated-flow TWR tests passed')
}
