import { strict as assert } from 'node:assert'
import { classifySchwabTransaction as classify, normalizeTransactionPattern, transactionPatternMatches } from '../src/lib/transaction-classification'
import { duplicateTransactionIds, isClosingSale } from '../src/lib/transaction-review'
import type { Transaction } from '../src/lib/types'
import { applyTransactionOverrides, cleanTransactionOverrides, mergeTransactionOverrides, migrateTransactionOverrides, recordTransactionOverride } from '../src/lib/transaction-overrides'

const duplicateBase = { accountId: 'a', date: '2026-09-01', type: 'Dividend', symbol: 'QQQ', amount: 12.34, units: 0, description: 'Cash  dividend QQQ', tags: [] } as Omit<Transaction, 'id'>
assert.deepEqual([...duplicateTransactionIds([{ ...duplicateBase, id: 'first' }, { ...duplicateBase, id: 'second', description: ' cash DIVIDEND qqq ' }, { ...duplicateBase, id: 'different', amount: 12.35 }])], ['second'])
assert.deepEqual([...duplicateTransactionIds([{ ...duplicateBase, id: 'unassigned-1', symbol: undefined }, { ...duplicateBase, id: 'unassigned-2', symbol: undefined }])], [])
assert.equal(classify({ rawType: 'DIVIDEND', description: 'SELL TO CLOSE SUBSTITUTE DIVIDEND', amount: 25, units: -1 }), 'Sell')
assert.equal(classify({ rawType: 'DIVIDEND', description: 'SUBSTITUTE PAYMENT IN LIEU OF DIVIDENDS', amount: 25, units: -1 }), 'Sell')
assert.equal(classify({ rawType: 'DIVIDEND', description: 'DIVIDEND REINVESTMENT', amount: 25, units: 1 }), 'Dividend')
assert.equal(isClosingSale({ ...duplicateBase, id: 'sto', type: 'Sell', description: 'SELL TO OPEN 2 QQQ PUT' }), false)
assert.equal(isClosingSale({ ...duplicateBase, id: 'stc', type: 'Sell', description: 'SELL TO CLOSE 2 QQQ PUT' }), true)
assert.equal(isClosingSale({ ...duplicateBase, id: 'equity', type: 'Sell', description: 'SELL TRADE QQQ' }), true)
assert.equal(isClosingSale({ ...duplicateBase, id: 'legacy-option', type: 'Sell', symbol: 'TQQQ 260717P00078000', description: 'TRADE' }), false)
assert.equal(isClosingSale({ ...duplicateBase, id: 'broker-closing', type: 'Sell', symbol: 'TQQQ 260717P00078000', description: 'TRADE', positionEffect: 'Closing' }), true)

assert.equal(classify({ rawType: 'JOURNAL', description: 'Foreign Tax Paid ACME LTD', amount: -12.34 }), 'Tax Withholding')
assert.equal(classify({ rawType: 'JOURNAL', description: 'Federal Tax Withheld', amount: -45 }), 'Tax Withholding')
assert.equal(classify({ rawType: 'JOURNAL', description: 'NRA WITHHOLDING', amount: -30 }), 'Tax Withholding')
assert.equal(classify({ rawType: 'JOURNAL', description: 'Margin interest charged', amount: -18 }), 'Interest')
assert.equal(classify({ rawType: 'JOURNAL', description: 'TRF FUNDS FROM TYPE 1 TO TYPE 2', amount: 500 }), 'Transfer')
assert.equal(classify({ rawType: 'JOURNAL', description: '1 FOR 10 REVERSE STOCK SPLIT', amount: 0 }), 'Corporate Action')
assert.equal(classify({ rawType: 'RECEIVE_AND_DELIVER', description: 'MANDATORY REORGANIZATION SHARE ADJUSTMENT', amount: 0 }), 'Corporate Action')
assert.equal(classify({ rawType: 'JOURNAL', description: 'CASH IN LIEU OF FRACTIONAL SHARE', amount: 14.22 }), 'Sell')
assert.equal(classify({ rawType: 'JOURNAL', description: 'CORPORATE ACTION ADJUSTMENT', amount: 0 }), 'Other')
assert.equal(classify({ rawType: 'DIVIDEND_OR_INTEREST', description: 'QUALIFIED DIVIDEND', amount: 22 }), 'Dividend')
assert.equal(classify({ rawType: 'ACH_RECEIPT', description: 'ACH receipt', amount: 1000 }), 'Contribution')
assert.equal(classify({ rawType: 'ACH_DISBURSEMENT', description: 'ACH to Best Egg loan payment', amount: -250 }), 'Bill Payment')
assert.equal(classify({ rawType: 'TRADE', description: 'SELL TRADE', amount: 500, units: -5 }), 'Sell')
assert.equal(normalizeTransactionPattern('OVERDRAFT TO INVESTOR CHECKING 3142'), 'OVERDRAFT TO INVESTOR CHECKING')
assert.equal(transactionPatternMatches('TRANSFER 1234 TO INVESTOR CHECKING 5678', 'TRANSFER TO INVESTOR CHECKING'), true)
assert.equal(transactionPatternMatches('OVERDRAFT TO INVESTOR CHECKING 3142', 'OVERDRAFT TO INVESTOR CHECKING'), true)
assert.equal(transactionPatternMatches('FOREIGN TAX PAID', 'TAX PAID'), true)
assert.equal(transactionPatternMatches('UNRELATED TRANSACTION 1234', 'TRANSFER TO'), false)

console.log('transaction classification tests passed')

// Brokerage/bank transfers are external; margin/cash journals are internal.
assert.equal(classify({ rawType: 'JOURNAL', description: 'TRANSFER FUNDS FROM SCHWAB BANK - 1234', amount: 43244 }), 'Contribution')
assert.equal(classify({ rawType: 'JOURNAL', description: 'TRANSFER FUNDS TO SCHWAB BANK - ...142', amount: -500 }), 'Withdrawal')
assert.equal(classify({ rawType: 'JOURNAL', description: 'TRF FUNDS FRM TYPE 2', amount: 500 }), 'Transfer')
assert.equal(classify({ rawType: 'JOURNAL', description: 'TRF FUNDS TO TYPE 1', amount: -500 }), 'Transfer')

// Edits survive replacement IDs and JSON round trips, without changing other
// transactions for the same ticker or category.
const editRows: Transaction[] = [
  { ...duplicateBase, id: 'sale', type: 'Dividend', units: -120, amount: 1209.56 },
  { ...duplicateBase, id: 'cash-dividend' },
]
const savedEdits = recordTransactionOverride(editRows, [], {}, 'sale', { type: 'Sell' }, '2026-09-19T10:00:00Z')
const reloadedEdits = cleanTransactionOverrides(JSON.parse(JSON.stringify(savedEdits)))
const syncedRows = editRows.map((row) => ({ ...row, id: `new-${row.id}` }))
applyTransactionOverrides(syncedRows, [], reloadedEdits)
assert.equal(syncedRows[0].type, 'Sell')
assert.equal(syncedRows[0].classificationSource, 'manual')
assert.equal(syncedRows[1].type, 'Dividend')
const secondEdit = recordTransactionOverride(syncedRows, [], reloadedEdits, 'new-sale', { type: 'Other' }, '2026-09-19T11:00:00Z')
applyTransactionOverrides(syncedRows, [], mergeTransactionOverrides(secondEdit, reloadedEdits))
assert.equal(syncedRows[0].type, 'Other', 'older cloud data cannot revert a local correction')
assert.deepEqual(mergeTransactionOverrides(secondEdit, {}), secondEdit, 'an old client payload cannot erase overrides')

const repeated: Transaction[] = ['a', 'b', 'c'].map((id) => ({ ...duplicateBase, id, brokerTransactionId: id }))
const dismissed = recordTransactionOverride(repeated, [], {}, 'b', { duplicateReviewed: true })
const reordered = [repeated[2], repeated[1], repeated[0]].map((row) => ({ ...row, id: `sync-${row.id}` }))
applyTransactionOverrides(reordered, [], cleanTransactionOverrides(JSON.parse(JSON.stringify(dismissed))))
assert.equal(reordered[1].duplicateReviewed, true)
assert.equal(reordered[0].duplicateReviewed, undefined)
assert.deepEqual([...duplicateTransactionIds(reordered)], ['sync-a'], 'dismissal stays on the reviewed broker record')
const csvRepeated = repeated.map(({ brokerTransactionId: _brokerId, ...row }) => row)
const csvEdits = recordTransactionOverride(csvRepeated, [], {}, 'b', { type: 'Sell' })
applyTransactionOverrides(csvRepeated, [], csvEdits)
assert.deepEqual(csvRepeated.map((row) => row.type), ['Dividend', 'Sell', 'Dividend'], 'identical CSV rows retain separate edits')

const legacy = [{ ...duplicateBase, id: 'legacy', classificationSource: 'manual' as const, duplicateReviewed: true }]
const migrated = migrateTransactionOverrides(legacy, [])
const freshLegacy = [{ ...duplicateBase, id: 'fresh', type: 'Other' as const }]
applyTransactionOverrides(freshLegacy, [], migrated)
assert.equal(freshLegacy[0].type, 'Dividend')
assert.equal((freshLegacy[0] as Transaction).duplicateReviewed, true)
assert.deepEqual(cleanTransactionOverrides({ invalid: { type: 'Fake', updatedAt: 'yesterday' } }), {})
console.log('manual transaction persistence tests passed')

// Schwab sometimes prints "SCHW AB BANK"; those are still bank transfers.
assert.equal(classify({ rawType: 'JOURNAL', description: 'Deposit Journaled Funds TRANSFER FUNDS FROM SCHW AB BANK - 440054553142', amount: 1062.63 }), 'Contribution')
assert.equal(classify({ rawType: 'JOURNAL', description: 'TRANSFER FUNDS TO SCHW AB BANK - 440054553142', amount: -500 }), 'Withdrawal')
console.log('split Schwab Bank name tests passed')
