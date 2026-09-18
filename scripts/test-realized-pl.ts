import { strict as assert } from 'node:assert'
import { applyRealizedPlOverrides, populateRealizedProfitLoss, realizedPlOverrideKey } from '../src/lib/realized-pl'
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

{
  const transactions = [tx({ id: 'sto', date: '2026-02-01', type: 'Sell', symbol: 'QQQ260320P00400000', description: 'SELL TO OPEN 2 QQQ PUT', amount: 600, units: -2 })]
  populateRealizedProfitLoss([], transactions)
  assert.equal(transactions[0].pl, undefined)
}

{
  const sale = tx({ id: 'manual', date: '2026-02-01', type: 'Sell', symbol: 'ABC', amount: 600, units: -5 })
  applyRealizedPlOverrides([sale], { [realizedPlOverrideKey(sale)]: -42.5 })
  assert.equal(sale.pl, -42.5)
  assert.equal(sale.plSource, 'manual')
  assert.equal(sale.plEstimated, false)
}

console.log('realized P/L tests passed')

// A CSV transaction match can retain API-estimated P/L. It must still accept
// saved user overrides; only CSV-supplied P/L has accounting authority.
{
  const estimated = tx({ id: 'merged', date: '2026-09-01', type: 'Sell', symbol: 'TEST', amount: 120, units: -1, dataSource: 'csv', pl: 10, plSource: 'estimated', plEstimated: true })
  const reported = { ...estimated, id: 'reported', date: '2026-09-02', plSource: 'csv' as const, plEstimated: false }
  applyRealizedPlOverrides([estimated, reported], { [realizedPlOverrideKey(estimated)]: 20, [realizedPlOverrideKey(reported)]: 30 })
  assert.equal(estimated.pl, 20)
  assert.equal(reported.pl, 10)
}
