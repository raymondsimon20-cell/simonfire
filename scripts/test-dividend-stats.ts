import assert from 'node:assert/strict'
import { dividendStats, positionDividends, positionMetrics } from '../src/lib/calc'
import { resolveDividendSymbols } from '../src/lib/dividend-symbol'
import { previewDividendEnrichment, previewRealizedGainLoss, type ImportResult } from '../src/lib/import'
import { captureCsvAuthority, reconcileCsvAuthority } from '../src/lib/csv-authority'
import type { Position, Transaction } from '../src/lib/types'
import { estimateDividendDate } from '../src/lib/dividend-calendar'

assert.equal(estimateDividendDate(['2026-06-13', '2026-07-15', '2026-08-14'], '2026-09', '2026-09-01', 'Monthly'), '2026-09-14')
assert.equal(estimateDividendDate(['2026-08-07', '2026-08-14', '2026-08-21'], '2026-09', '2026-09-14', 'Weekly'), '2026-09-18')
assert.equal(estimateDividendDate([], '2026-09', '2026-09-14', 'Quarterly'), undefined)

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

// Received income must follow the final ledger, even when the positions CSV
// has a zero or stale dividend cache. Test multiple tickers and account scopes.
const incomeHoldings = ['TOPW', 'OXLC', 'CLM'].map((symbol) => ({ ...positions[0], symbol, dividendsReceived: 0 }))
const incomeLedger = incomeHoldings.flatMap((p, i) => [
  txn({ id: `${p.symbol}-cash`, date: '2026-08-01', type: 'Dividend', symbol: ` ${p.symbol.toLowerCase()} `, amount: 10 + i }),
  txn({ id: `${p.symbol}-sale`, date: '2026-08-02', type: 'Sell', symbol: p.symbol, amount: 1000, units: -20 }),
  txn({ id: `${p.symbol}-other-account`, date: '2026-08-01', type: 'Dividend', symbol: p.symbol, amount: 999, accountId: 'other' }),
  txn({ id: `${p.symbol}-future`, date: '2099-08-01', type: 'Dividend', symbol: p.symbol, amount: 999 }),
])
for (const [i, holding] of incomeHoldings.entries()) {
  assert.equal(positionDividends(holding, incomeLedger), 10 + i)
  assert.equal(positionMetrics(holding, incomeLedger).totalReturn, 200 + 10 + i)
}
const updatedIncome = [...incomeLedger, txn({ id: 'new-payment', date: '2026-08-03', type: 'Dividend', symbol: 'TOPW', amount: 7 })]
assert.equal(positionDividends(incomeHoldings[0], updatedIncome), 17)
assert.equal(positionDividends(incomeHoldings[0], updatedIncome.map((row) => row.id === 'new-payment' ? { ...row, type: 'Sell' as const } : row)), 10)
assert.equal(positionDividends({ ...incomeHoldings[0], dividendsReceived: 999 }, []), 0)
assert.equal(positionDividends({ ...incomeHoldings[0], isOption: true }, updatedIncome), 0)
assert.equal(positionDividends(incomeHoldings[0], [...incomeLedger, txn({ id: 'reversal', date: '2026-08-03', type: 'Dividend', symbol: 'TOPW', amount: -2 })]), 8)

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
assert.equal(forward.future.reduce((sum, month) => sum + month.amount, 0), 100)

const raisedForward = dividendStats([{ ...forwardPosition, annualDividend: 3 }], [], '2026-08-27')
assert.equal(raisedForward.estAnnual, 150)
assert.equal(raisedForward.future.reduce((sum, month) => sum + month.amount, 0), 150)

// A newly synced payment must immediately change both received income and the
// month pattern used by the chart, even when all twelve month labels are stable.
const beforeSync = dividendStats(positions.slice(0, 1), quarterlyTransactions, '2026-08-27')
const syncedPayment = txn({ id: 'new-sync-dividend', date: '2026-08-20', type: 'Dividend', symbol: 'XYZ', amount: 25 })
const afterSync = dividendStats(positions.slice(0, 1), [syncedPayment, ...quarterlyTransactions], '2026-08-27')
assert.equal(afterSync.trailing12m, beforeSync.trailing12m + 25)
assert.equal(
  afterSync.future.find((month) => month.month === '2027-08')!.amount,
  beforeSync.future.find((month) => month.month === '2027-08')!.amount + 25,
)

const resolverPositions: Position[] = [
  { ...positions[0], symbol: 'QQQI', name: 'NEOS Nasdaq 100 High Income ETF', shares: 100, lastDividend: 0.62 },
  { ...positions[0], symbol: 'TSYY', name: 'GraniteShares YieldBOOST TSLA ETF', shares: 50, lastDividend: 0.4 },
]
const resolverTransactions: Transaction[] = [
  txn({ id: 'known', date: '2026-07-15', type: 'Dividend', symbol: 'QQQI', description: 'QUALIFIED DIVIDEND NEOS NASDAQ 100 HIGH INCOME', amount: 60 }),
  txn({ id: 'learned', date: '2026-08-15', type: 'Dividend', description: 'CASH DIVIDEND NEOS NASDAQ 100 HIGH INCOME', amount: 61 }),
  txn({ id: 'ticker', date: '2026-08-20', type: 'Dividend', description: 'DIVIDEND PAYMENT (TSYY)', amount: 19 }),
  txn({ id: 'amount', date: '2026-08-22', type: 'Dividend', description: 'CASH DISTRIBUTION', amount: 62 }),
]
resolveDividendSymbols(resolverPositions, resolverTransactions)
assert.equal(resolverTransactions.find((row) => row.id === 'learned')?.symbol, 'QQQI')
assert.equal(resolverTransactions.find((row) => row.id === 'ticker')?.symbol, 'TSYY')
assert.equal(resolverTransactions.find((row) => row.id === 'amount')?.symbol, undefined, 'amount alone cannot identify a payer')

const acrossAccounts: Transaction[] = [
  txn({ date: '2026-08-01', id: 'known-global', accountId: 'old', type: 'Dividend', symbol: 'QQQI', description: 'QUALIFIED DIVIDEND NEOS NASDAQ 100 HIGH INCOME', amount: 60 }),
  txn({ date: '2026-08-01', id: 'new-account', accountId: 'new', type: 'Dividend', description: 'CASH DIVIDEND NEOS NASDAQ 100 HIGH INCOME', amount: 12 }),
  txn({ date: '2026-08-01', id: 'sold-trade', accountId: 'old', type: 'Sell', symbol: 'SOLD', securityId: '123456789', securityName: 'Distinctive Former Holding', description: 'Sale', amount: 500 }),
  txn({ date: '2026-08-01', id: 'sold-dividend', accountId: 'new', type: 'Dividend', securityId: '123456789', description: 'Dividend', amount: 2 }),
  txn({ date: '2026-08-01', id: 'sold-name', accountId: 'new', type: 'Dividend', description: 'DIVIDEND DISTINCTIVE FORMER HOLDING', amount: 3 }),
  txn({ date: '2026-08-01', id: 'generic', accountId: 'new', type: 'Dividend', description: 'CASH DIVIDEND', amount: 60 }),
  txn({ date: '2026-08-01', id: 'local-rule', accountId: 'new', type: 'Dividend', description: 'QUALIFIED DIVIDEND NEOS NASDAQ 100 HIGH INCOME', amount: 9 }),
]
resolveDividendSymbols([], acrossAccounts, [{ id: 'specific', accountId: 'new', contains: 'NEOS NASDAQ HIGH INCOME', symbol: 'MANUAL' }])
assert.equal(acrossAccounts.find((row) => row.id === 'new-account')?.symbol, 'MANUAL', 'local explicit mapping wins over learned global description')
assert.equal(acrossAccounts.find((row) => row.id === 'sold-dividend')?.symbol, 'SOLD')
assert.equal(acrossAccounts.find((row) => row.id === 'sold-name')?.symbol, 'SOLD')
assert.equal(acrossAccounts.find((row) => row.id === 'generic')?.symbol, undefined)
const crossLearn = [acrossAccounts[0], txn({ date: '2026-08-01', id: 'cross-learn', accountId: 'third', type: 'Dividend', description: 'CASH DIVIDEND NEOS NASDAQ 100 HIGH INCOME', amount: 5 })]
resolveDividendSymbols([], crossLearn)
assert.equal(crossLearn[1].symbol, 'QQQI')
const ambiguous = [acrossAccounts[0], { ...acrossAccounts[0], symbol: 'DIFFERENT', id: 'conflicting' }, { ...crossLearn[1], symbol: undefined }]
resolveDividendSymbols([], ambiguous)
assert.equal(ambiguous[2].symbol, undefined)
const ruleOnly = [txn({ date: '2026-08-01', id: 'shared-rule', accountId: 'third', type: 'Dividend', description: 'CASH DIVIDEND DISTINCTIVE OLD FUND', amount: 8 })]
resolveDividendSymbols([], ruleOnly, [{ id: 'old-rule', accountId: 'old', contains: 'DISTINCTIVE OLD FUND', symbol: 'OLD' }])
assert.equal(ruleOnly[0].symbol, 'OLD')
for (const description of ['CASH DIVIDEND', 'DIVIDEND PAID', 'SUBSTITUTE INCOME PAYMENT', 'UNIDENTIFIED PAYMENT']) {
  const generic = [txn({ date: '2026-08-01', id: 'known', type: 'Dividend', description, symbol: 'QQQI', amount: 62 }), txn({ date: '2026-08-01', id: 'missing', type: 'Dividend', description, amount: 62 })]
  resolveDividendSymbols(resolverPositions, generic)
  assert.equal(generic[1].symbol, undefined, `generic wording must not identify a payer: ${description}`)
}

const importAccount = { id: 'csv-account', broker: 'Schwab', name: 'CSV', fullName: 'CSV', mask: '9391', type: 'Margin' as const, isMargin: true, cash: 0, marginBalance: 0 }
const csvDividend = txn({ id: 'csv-dividend', accountId: importAccount.id, date: '2026-08-20', type: 'Dividend', symbol: 'TSYY', description: 'Cash dividend TSYY', amount: 19 })
const importResult: ImportResult = { accounts: [importAccount], positions: [], transactions: [csvDividend], warnings: [] }
const existingAccount = { ...importAccount, id: 'acc_9391' }
const missingSymbol = txn({ id: 'api-dividend', accountId: existingAccount.id, date: '2026-08-20', type: 'Dividend', description: 'CASH DIVIDEND TSYY', amount: 19 })
const enrichment = previewDividendEnrichment(importResult, [existingAccount], [missingSymbol])
assert.deepEqual(enrichment.matches.map(({ transactionId, symbol }) => ({ transactionId, symbol })), [{ transactionId: 'api-dividend', symbol: 'TSYY' }])
assert.equal(enrichment.ambiguous.length, 0)

const realizedCsv = `"Symbol","Closed Date","Quantity","Proceeds","Gain/Loss ($)","Transaction Closed Date","Total Transaction Gain/Loss ($)"
"SPXU","09/14/2026","44","$1,575.60","$67.28","09/14/2026","$64.44"
"SPXU","09/14/2026","1","$35.81","-$11.55","09/14/2026","$64.44"`
const aggregateSale = txn({ id: 'sale', accountId: existingAccount.id, date: '2026-09-14', type: 'Sell', symbol: 'SPXU', description: 'TRADE', amount: 1611.41, units: -45, pl: 12 })
const realizedPreview = previewRealizedGainLoss(realizedCsv, [existingAccount], [aggregateSale], existingAccount.mask)
assert.equal(realizedPreview.rows, 1)
assert.equal(realizedPreview.matches.length, 1)
assert.equal(realizedPreview.matches[0].pl, 64.44)
assert.equal(enrichment.unmatched.length, 0)

const csvPosition = { ...positions[0], id: 'csv-position', accountId: importAccount.id, shares: 12, avgCost: 91, lastPrice: 99 }
const apiPosition = { ...positions[0], id: 'api-position', accountId: existingAccount.id, shares: 10, avgCost: 95, lastPrice: 105, annualDividend: 4 }
const csvSale = txn({ id: 'csv-sale', accountId: importAccount.id, date: '2026-09-01', type: 'Sell', symbol: 'QQQ', description: 'SELL QQQ', amount: 1100, units: -10, pl: 100 })
const apiSale = txn({ id: 'api-sale', accountId: existingAccount.id, date: '2026-09-01', type: 'Sell', symbol: 'QQQ', description: 'API wording', amount: 1100, units: -10 })
const authority = captureCsvAuthority([importAccount], [csvPosition], [csvSale], '2026-09-14T12:00:00Z')
const reconciled = reconcileCsvAuthority([existingAccount], [apiPosition], [apiSale], authority.positions, authority.transactions)
assert.equal(reconciled.positions[0].shares, 10)
assert.equal(reconciled.positions[0].avgCost, 91)
assert.equal(reconciled.positions[0].lastPrice, 105)
assert.equal(reconciled.positions[0].annualDividend, 4)
assert.equal(reconciled.transactions.length, 1)
assert.equal(reconciled.transactions[0].id, 'api-sale')
assert.equal(reconciled.transactions[0].pl, 100)
assert.equal(reconciled.transactions[0].description, 'SELL QQQ')
assert.equal(reconciled.transactions[0].dataSource, 'csv')
assert.equal(reconciled.conflicts, 3)
assert.deepEqual(reconciled.conflictDetails.map((row) => row.field), ['Average cost', 'Description', 'Realized P/L'])

console.log('dividendStats tests passed')

// Legacy blank masks resolve only when a single account can own the import.
const blankAuthority = { positions: authority.positions.map(r => ({ ...r, accountMask: '' })), transactions: authority.transactions.map(r => ({ ...r, accountMask: '' })) }
const blankMatch = reconcileCsvAuthority([existingAccount], [apiPosition], [apiSale], blankAuthority.positions, blankAuthority.transactions)
assert.equal(blankMatch.transactions.length, 1)
assert.equal(blankMatch.transactions[0].pl, 100)
assert.equal(blankMatch.positions[0].avgCost, 91)
const ambiguousAccounts = reconcileCsvAuthority([existingAccount, { ...existingAccount, id: 'second', mask: '9999' }], [apiPosition], [apiSale], blankAuthority.positions, blankAuthority.transactions)
assert.equal(ambiguousAccounts.transactions[0].pl, undefined)
// CSV aggregates two execution fills; importing it must not double the trade.
const fills = [{ ...apiSale, id: 'fill1', amount: 440, units: -4 }, { ...apiSale, id: 'fill2', amount: 660, units: -6 }]
const aggregated = reconcileCsvAuthority([existingAccount], [], fills, [], blankAuthority.transactions)
assert.equal(aggregated.transactions.length, 2)
assert.equal(aggregated.transactions.reduce((n, t) => n + t.amount, 0), 1100)
assert.equal(aggregated.transactions.reduce((n, t) => n + (t.pl ?? 0), 0), 100)
// Missing CSV P/L must not erase a known API estimate or its provenance.
const noPl = blankAuthority.transactions.map(r => ({ ...r, transaction: { ...r.transaction, pl: undefined } }))
const retainedPl = reconcileCsvAuthority([existingAccount], [], [{ ...apiSale, pl: 75, plEstimated: true, plSource: 'estimated' }], [], noPl)
assert.equal(retainedPl.transactions[0].pl, 75)
assert.equal(retainedPl.transactions[0].plSource, 'estimated')
// CSV masks use ellipses while API descriptions contain full account numbers.
const bankApi = txn({ id: 'bank', accountId: existingAccount.id, date: '2026-09-01', type: 'Transfer', amount: -500, description: 'TRANSFER FUNDS TO SCHWAB BANK - 1234142' })
const bankCsv = { accountMask: '', importedAt: '', transaction: { ...bankApi, description: 'TRANSFER FUNDS TO SCHWAB BANK - ...142' } }
const bank = reconcileCsvAuthority([existingAccount], [], [bankApi], [], [bankCsv])
assert.equal(bank.transactions.length, 1)
assert.equal(bank.transactions[0].type, 'Withdrawal')
