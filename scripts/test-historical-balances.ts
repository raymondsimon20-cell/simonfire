import assert from 'node:assert/strict'
import { parseHistoricalBalanceCsv } from '../src/lib/historical-balances'

const parsed = parseHistoricalBalanceCsv([
  'month,opening_equity,deposits,withdrawals,dividends_interest,market_change,expenses,closing_equity,net_loan_balance',
  '2026-08,87662.50,4667.58,-17203.18,1784.24,-1260.06,-126.19,75524.89,-61393.71',
].join('\n'))
assert.equal(parsed.length, 1)
assert.equal(parsed[0].closingEquity, 75524.89)
assert.equal(parsed[0].marginLoanBalance, 61393.71)
assert.equal(parsed[0].source, 'CSV')
console.log('historical balance tests passed')
