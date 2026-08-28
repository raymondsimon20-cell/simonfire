import assert from 'node:assert/strict'
import { dividendStats } from '../src/lib/calc'
import type { Position, Transaction } from '../src/lib/types'

const positions: Position[] = [
  {
    id: 'xyz', accountId: 'acc_1', symbol: 'XYZ', name: 'XYZ Fund', shares: 100,
    avgCost: 8, lastPrice: 10, prevClose: 10, dividendsReceived: 0,
  },
  {
    id: 'xyz-option', accountId: 'acc_1', symbol: 'XYZ', name: 'XYZ Call', shares: 2,
    avgCost: 500, lastPrice: 300, prevClose: 300, dividendsReceived: 0, isOption: true,
  },
]

const txn = (value: Partial<Transaction> & Pick<Transaction, 'id' | 'date' | 'type' | 'amount'>): Transaction => ({
  accountId: 'acc_1', description: value.type, units: 0, tags: [], ...value,
})

const transactions: Transaction[] = [
  // 80 shares were held for this $80 payment; the later 20-share buy means the
  // historical $1/share distribution scales to $100 on today's 100 shares.
  txn({ id: 'd1', date: '2025-09-15', type: 'Dividend', symbol: 'xyz', amount: 80 }),
  txn({ id: 'buy', date: '2026-01-10', type: 'Buy', symbol: 'XYZ', amount: -200, units: 20 }),
  txn({ id: 'd2', date: '2026-06-15', type: 'Dividend', symbol: 'XYZ', amount: 50 }),
  txn({ id: 'unknown', date: '2026-07-01', type: 'Dividend', amount: 10 }),
  txn({ id: 'old', date: '2025-01-10', type: 'Dividend', symbol: 'XYZ', amount: 20 }),
  txn({ id: 'future', date: '2026-09-01', type: 'Dividend', symbol: 'XYZ', amount: 999 }),
  txn({ id: 'sold', date: '2026-02-01', type: 'Dividend', symbol: 'SOLD', amount: 75 }),
  txn({ id: 'sold-trade', date: '2026-03-01', type: 'Sell', symbol: 'SOLD', amount: 500, units: -50 }),
]

const stats = dividendStats(positions, transactions, '2026-08-27')
const xyz = stats.bySymbol.find((row) => row.symbol === 'XYZ')
const sold = stats.bySymbol.find((row) => row.symbol === 'SOLD')

assert.ok(xyz)
assert.equal(stats.trailing12m, 215) // includes received income from the sold holding + unassigned cash
assert.equal(stats.availableIncome, 235) // future transaction excluded
assert.equal(stats.unassignedTrailing12m, 10)
assert.equal(stats.unassignedAvailable, 10)
assert.equal(stats.availableHistoryStart, '2025-01-10')
assert.equal(stats.dividendSymbols, 2)
assert.equal(xyz.ttm, 130)
assert.equal(xyz.availableIncome, 150)
assert.equal(xyz.projAnnual, 150)
assert.equal(xyz.yoc, 150 / 800) // option cost basis excluded
assert.equal(xyz.distributionYield, 150 / 1000) // option market value excluded
assert.equal(sold?.projAnnual, 0)
assert.equal(stats.estAnnual, 150)
assert.equal(stats.yieldOnCost, 150 / 800)
assert.equal(stats.distributionYield, 150 / 1000)
assert.equal(stats.future.length, 12)
assert.equal(stats.future[0].month, '2026-09')
assert.equal(stats.future.reduce((sum, month) => sum + month.amount, 0), 150)

const quarterlyTransactions = ['2025-09-01', '2025-12-01', '2026-03-01', '2026-06-01'].map((date, i) =>
  txn({ id: `q${i}`, date, type: 'Dividend', symbol: 'XYZ', amount: 10 }),
)
const quarterly = dividendStats(positions.slice(0, 1), quarterlyTransactions, '2026-08-27')
assert.equal(quarterly.bySymbol[0]?.cadence, 'Quarterly')

const forwardPosition: Position = {
  ...positions[0], id: 'new-payer', symbol: 'NEW', shares: 50, avgCost: 20, lastPrice: 25,
  annualDividend: 2,
}
const forward = dividendStats([forwardPosition], [], '2026-08-27')
assert.equal(forward.estAnnual, 100)
assert.equal(forward.schwabForwardIncome, 100)
assert.equal(forward.historicalEstimateIncome, 0)
assert.equal(forward.forwardCoverage, 1)
assert.equal(forward.bySymbol[0]?.estimateSource, 'Schwab forward')
assert.equal(forward.distributionYield, 100 / 1250)

console.log('dividendStats tests passed')
