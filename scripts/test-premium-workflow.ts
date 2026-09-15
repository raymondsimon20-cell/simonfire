import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { captureCsvAuthority, reconcileCsvAuthority } from '../src/lib/csv-authority'
import type { Account, Position, Transaction } from '../src/lib/types'

const csvAccount = { id: 'csv', broker: 'Schwab', name: 'Margin', fullName: 'Margin ····9391', mask: '9391', type: 'Margin', isMargin: true, cash: 0, marginBalance: 0 } as Account
const apiAccount = { ...csvAccount, id: 'api' }
const csvPosition = { id: 'csv-p', accountId: 'csv', symbol: 'QQQ', name: 'QQQ', shares: 10, avgCost: 400, lastPrice: 500, prevClose: 495, dividendsReceived: 20 } as Position
const apiPosition = { ...csvPosition, id: 'api-p', accountId: 'api', shares: 12, avgCost: 420, lastPrice: 510 }
const csvSale = { id: 'csv-t', accountId: 'csv', date: '2026-09-01', type: 'Sell', symbol: 'QQQ', description: 'SELL QQQ', amount: 510, units: -1, pl: 110, tags: [] } as Transaction
const apiSale = { ...csvSale, id: 'api-t', accountId: 'api', description: 'TRADE', pl: undefined }
const captured = captureCsvAuthority([csvAccount], [csvPosition], [csvSale], '2026-09-14T12:00:00Z', 'batch-1')
const synced = reconcileCsvAuthority([apiAccount], [apiPosition], [apiSale], captured.positions, captured.transactions)
assert.equal(synced.positions[0].shares, 12, 'API owns current inventory')
assert.equal(synced.positions[0].avgCost, 400, 'CSV owns cost basis')
assert.equal(synced.transactions[0].pl, 110, 'CSV owns realized P/L')
assert.deepEqual(synced.conflictDetails.map((row) => row.field), ['Average cost', 'Description', 'Realized P/L'])
const afterRollback = reconcileCsvAuthority([apiAccount], [apiPosition], [apiSale], captured.positions.filter((row) => row.importBatchId !== 'batch-1'), captured.transactions.filter((row) => row.importBatchId !== 'batch-1'))
assert.equal(afterRollback.positions[0].avgCost, 420)
assert.equal(afterRollback.transactions[0].pl, undefined)

const modal = readFileSync('src/components/Modal.tsx', 'utf8')
const palette = readFileSync('src/components/PremiumTools.tsx', 'utf8')
const quality = readFileSync('src/pages/DataQuality.tsx', 'utf8')
assert.match(modal, /aria-modal="true"/)
assert.match(palette, /role="combobox"/)
assert.match(palette, /Snooze 1 day/)
assert.match(quality, /CSV authority by account/)
console.log('premium reconciliation workflow and UI contracts passed')
