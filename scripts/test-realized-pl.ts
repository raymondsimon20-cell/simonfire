import { strict as assert } from 'node:assert'
import { populateRealizedProfitLoss } from '../src/lib/realized-pl'
import type { Position, Transaction } from '../src/lib/types'

const base = { accountId: 'a1', tags: [] as string[], description: 'trade', fee: undefined }
const tx = (row: Partial<Transaction> & Pick<Transaction, 'id' | 'date' | 'type' | 'amount' | 'units'>): Transaction => ({ ...base, ...row });

{
  const transactions = [
    tx({ id: 'buy', date: '2026-01-01', type: 'Buy', symbol: 'ABC', amount: -1_000, units: 10 }),
    tx({ id: 'sell', date: '2026-02-01', type: 'Sell', symbol: 'ABC', amount: 600, units: -5 }),
  ]
  populateRealizedProfitLoss([], transactions)
  assert.equal(transactions[1].pl, 100)
  assert.equal(transactions[1].plEstimated, true)
}

{
  const position: Position = { id: 'p1', accountId: 'a1', symbol: 'OLD', name: 'Old holding', shares: 5, avgCost: 80, lastPrice: 90, prevClose: 90, dividendsReceived: 0 }
  const transactions = [tx({ id: 'sell', date: '2026-02-01', type: 'Sell', symbol: 'OLD', amount: 450, units: -5 })]
  populateRealizedProfitLoss([position], transactions)
  assert.equal(transactions[0].pl, 50)
}

{
  const transactions = [tx({ id: 'reported', date: '2026-02-01', type: 'Sell', symbol: 'ABC', amount: 600, units: -5, pl: 73 })]
  populateRealizedProfitLoss([], transactions)
  assert.equal(transactions[0].pl, 73)
  assert.equal(transactions[0].plEstimated, undefined)
}

console.log('realized P/L tests passed')
