import { strict as assert } from 'node:assert'
import { classifySchwabTransaction as classify } from '../src/lib/transaction-classification'

assert.equal(classify({ rawType: 'JOURNAL', description: 'Foreign Tax Paid ACME LTD', amount: -12.34 }), 'Tax Withholding')
assert.equal(classify({ rawType: 'JOURNAL', description: 'Federal Tax Withheld', amount: -45 }), 'Tax Withholding')
assert.equal(classify({ rawType: 'JOURNAL', description: 'NRA WITHHOLDING', amount: -30 }), 'Tax Withholding')
assert.equal(classify({ rawType: 'JOURNAL', description: 'Margin interest charged', amount: -18 }), 'Interest')
assert.equal(classify({ rawType: 'JOURNAL', description: 'TRF FUNDS FROM TYPE 1 TO TYPE 2', amount: 500 }), 'Transfer')
assert.equal(classify({ rawType: 'JOURNAL', description: 'CORPORATE ACTION ADJUSTMENT', amount: 0 }), 'Other')
assert.equal(classify({ rawType: 'DIVIDEND_OR_INTEREST', description: 'QUALIFIED DIVIDEND', amount: 22 }), 'Dividend')
assert.equal(classify({ rawType: 'ACH_RECEIPT', description: 'ACH receipt', amount: 1000 }), 'Contribution')
assert.equal(classify({ rawType: 'ACH_DISBURSEMENT', description: 'ACH to Best Egg loan payment', amount: -250 }), 'Bill Payment')
assert.equal(classify({ rawType: 'TRADE', description: 'SELL TRADE', amount: 500, units: -5 }), 'Sell')

console.log('transaction classification tests passed')
