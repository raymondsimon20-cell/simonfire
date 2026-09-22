import assert from 'node:assert/strict'
import './test-statement-transactions'
import { parseHistoricalBalanceCsv, parseSchwabStatementText } from '../src/lib/historical-balances'
import { availableMonths, monthClose, portfolioSummary } from '../src/lib/calc'
import { accountOpenMonths, coverageGap, mergeHistoricalBalances, statementHistory, statementProfit } from '../src/lib/statement-history'
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
assert.equal(statementHistory([pdf, { ...pdf, accountMask: '4567', marginLoanBalance: undefined }], accounts, 'all')[0].marginLoanBalance, undefined, 'a margin account statement without a loan line stays unknown')
// A cash/IRA statement never prints a Net Loan Balance line: that is $0 debt, not unknown.
const ira: Account = { ...other, id: 'c', mask: '7777', isMargin: false, type: 'Individual', marginBalance: 0 }
const withIra = statementHistory([pdf, { ...pdf, accountMask: '7777', marginLoanBalance: undefined }], [account, ira], 'all')[0]
assert.equal(withIra.marginLoanBalance, 400, 'non-margin statements contribute zero debt instead of blanking the month')
assert.equal(withIra.complete, true)
assert.equal(coverageGap(withIra), '')
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
assert.equal(monthClose(accounts, [], 'a', '2026-01', summary, [{ ...pdf, marginLoanBalance: undefined }]).debtAvailable, false)
assert.equal(monthClose(accounts, [], 'a', '2026-01', summary, [{ ...pdf, openingEquity: undefined }]).historyAvailable, false)
assert.equal(monthClose(accounts, [], 'b', '2026-01', summary, merged).balanceAvailable, false)
const now = new Date(); const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
assert.equal(monthClose(accounts, [], 'a', currentMonth, summary, [{ ...pdf, month: currentMonth }]).netEquity, 1260, 'an imported statement takes precedence over live balances for its month')
console.log('statement scope, import validation, and month-close reconciliation tests passed')
