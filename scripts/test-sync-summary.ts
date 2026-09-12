import assert from 'node:assert/strict'
import { summarizeSync } from '../src/lib/sync-summary'
import type { Position, Transaction } from '../src/lib/types'

const positions = [{ id: 'p', accountId: 'a', symbol: 'QQQ', name: 'QQQ', shares: 2, lastPrice: 500, avgCost: 450, prevClose: 495, dividendsReceived: 0 }] as Position[]
const transactions = [{ id: 'd1', accountId: 'a', date: '2026-09-10', type: 'Dividend', description: 'QQQ DIVIDEND', amount: 12, units: 0, symbol: 'QQQ', tags: [] }] as Transaction[]
const result = summarizeSync([], [], positions, transactions, '2026-09-12T12:00:00Z')
assert.deepEqual(result.addedPositions, ['QQQ'])
assert.equal(result.newTransactions, 1)
assert.equal(result.newDividends, 1)
assert.equal(result.valueChange, 1000)
assert.equal(result.latestTransactionDate, '2026-09-10')
console.log('sync summary tests passed')
