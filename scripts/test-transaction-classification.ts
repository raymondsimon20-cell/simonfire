import { strict as assert } from 'node:assert'
import { classifySchwabTransaction as classify, normalizeTransactionPattern, transactionPatternMatches } from '../src/lib/transaction-classification'

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
