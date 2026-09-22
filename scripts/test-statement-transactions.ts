import assert from 'node:assert/strict'
import { parseStatementTransactions, reconcileStatementTransactions, mergeStatementTransactions, type PdfTextItem, type PdfTextPage } from '../src/lib/statement-transactions'
import { applyTransactionOverrides, recordTransactionOverride } from '../src/lib/transaction-overrides'
import { duplicateTransactionIds } from '../src/lib/transaction-review'
import type { Account, StatementTransactions, Transaction } from '../src/lib/types'

const item = (str: string, x: number, y: number, width = 25): PdfTextItem => ({ str, x, y, width })
const headers = () => [item('Transaction Details', 18, 505), ...[['Date', 18, 16], ['Category', 45, 31], ['Action', 96, 22], ['CUSIP', 175, 24], ['Description', 248, 39], ['Quantity', 462, 29], ['per Share($)', 511, 44], ['Interest($)', 576, 35], ['Amount($)', 652, 36], ['Gain/(Loss)($)', 721, 50]].map(([str, x, width]) => item(String(str), Number(x), 482, Number(width)))]
const line = (y: number, left: string, symbol: string, description: string, cash: string, qty = '', price = '', fee = '', pl = '') => [item(left, left.match(/^\d/) ? 18 : 45, y), ...(symbol ? [item(symbol, 175, y)] : []), item(description, 248, y, 155), ...(qty ? [item(qty, 440, y, 51)] : []), ...(price ? [item(price, 520, y, 35)] : []), ...(fee ? [item(fee, 590, y, 23)] : []), ...(cash ? [item(cash, 650, y, 41)] : []), ...(pl ? [item(pl, 728, y, 45), item('(ST)', 766, y + 3, 12)] : [])]
const page1: PdfTextPage = { page: 6, items: [...headers(),
  ...line(460, '12/02 Dividend', 'TSYY', 'SYNTHETIC TSLA 2X ETF', '4.11'), item('Non-Qualified Div', 96, 460, 72),
  ...line(420, 'Dividend', 'TSYY', 'SYNTHETIC TSLA 2X ETF', '4.11'), item('Non-Qualified Div', 96, 420, 72),
  ...line(380, 'Dividend', 'TSYY', 'SYNTHETIC TSLA 2X ETF', '(0.99)'), item('Tax Withheld', 96, 380, 58),
  ...line(340, 'Dividend', 'GOF', 'SYNTHETIC FUND', '62.64'), item('Div For Reinvest', 96, 340, 72),
  ...line(300, 'Purchase', 'GOF', 'SYNTHETIC FUND', '(62.64)', '5.3040', '11.8100'),
  ...line(260, 'Withdrawal', '', 'OVERDRAFT TO CHECKING', '(171.87)'), item('SchwabBank', 96, 260, 58), item('Trnsfr', 96, 249),
  ...line(220, 'Redemption Cash-In-Lieu', 'YBIT', 'SYNTHETIC BITCOIN OPT', '21.27'), item('INCOME', 248, 209, 38),
] }
const sum = 4.11 + 4.11 - .99 + 62.64 - 62.64 - 171.87 + 21.27 + 4022.24 - 252.66
const page2: PdfTextPage = { page: 7, items: [...headers(),
  ...line(460, '12/04 Sale', 'QQQY', 'SYNTHETIC NASDAQ 100 ETF', '4,022.24', '(166.8301)', '24.1099', '0.03', '(170.34)'),
  item('Industry Fee $0.03', 248, 449, 80),
  ...line(400, 'Purchase', 'QQQ 05/15/2026', 'PUT SYNTHETIC QQQ', '(252.66)', '1.0000', '2.5200', '0.66'), item('550.00 P', 175, 389, 40),
  item('Total Transactions', 23, 340, 90), item(sum.toFixed(2), 650, 340, 41),
  ...line(250, '12/05 Dividend', 'PENDING', 'Pending payment must be ignored', '999.00'),
] }
const parsed = parseStatementTransactions([page1, page2], '2025-12', '1234', 'fixture.pdf')
assert.deepEqual(parsed.issues, [])
assert.equal(parsed.complete, true)
assert.equal(parsed.transactions.length, 9)
assert.equal(parsed.transactions[1].date, '2025-12-02')
assert.equal(parsed.transactions[2].type, 'Tax Withholding')
assert.equal(parsed.transactions[3].type, 'Dividend')
assert.equal(parsed.transactions[4].type, 'Buy')
assert.equal(parsed.transactions[5].type, 'Withdrawal')
assert.equal(parsed.transactions[6].type, 'Corporate Action')
assert.equal(parsed.transactions[6].securityName, 'SYNTHETIC BITCOIN OPT INCOME')
assert.equal(parsed.transactions[7].symbol, 'QQQY')
assert.equal(parsed.transactions[7].amount, 4022.24)
assert.equal(parsed.transactions[7].units, -166.8301)
assert.equal(parsed.transactions[7].pl, -170.34)
assert.equal(parsed.transactions[7].fee, .03)
assert.equal(parsed.transactions[8].symbol, 'QQQ   260515P00550000')
assert.equal(parsed.transactions[8].date, '2025-12-04')
assert.equal(new Set(parsed.transactions.map((row) => row.statement!.key)).size, 9, 'identical legitimate payments keep separate stable identities')
assert.deepEqual(parseStatementTransactions([page1, page2], '2025-12', '1234', 'renamed.pdf').transactions.map((row) => row.statement?.key), parsed.transactions.map((row) => row.statement?.key))
const broken = structuredClone(page2); broken.items.find((row) => row.str === '4,022.24')!.str = '4,222.24'
assert.equal(parseStatementTransactions([page1, broken], '2025-12', '1234', 'bad.pdf').complete, false)
const unsupported = structuredClone(page2); unsupported.items.push(item('12/06 UnknownCategory', 18, 360))
assert.equal(parseStatementTransactions([page1, unsupported], '2025-12', '1234', 'unknown.pdf').complete, false)
assert.equal(parseStatementTransactions([page1], '2025-12', '1234', 'truncated.pdf').complete, false)

const account: Account = { id: 'a', name: 'Test', fullName: 'Test', mask: '1234', broker: 'Schwab', type: 'Individual', isMargin: false, cash: 0, marginBalance: 0 }
const other = { ...account, id: 'b', mask: '5678' }
const api = (row: number, patch: Partial<Transaction> = {}): Transaction => ({ ...parsed.transactions[row], statement: undefined, id: `api${row}`, brokerTransactionId: `broker${row}`, accountId: 'a', dataSource: 'api', ...patch })
const original = [api(0, { symbol: undefined }), api(1, { symbol: undefined }), api(7, { date: '2025-12-03', pl: undefined }), api(0, { id: 'other', accountId: 'b', symbol: 'OTHER' })]
const merged = reconcileStatementTransactions([account, other], original, [parsed])
assert.equal(merged.added, 6)
assert.equal(merged.matched, 3)
assert.equal(merged.ambiguous, 0)
assert.equal(merged.transactions.length, 10)
assert.equal(merged.transactions.find((row) => row.id === 'api7')?.date, '2025-12-03', 'API trade date survives settlement matching')
assert.equal(merged.transactions.find((row) => row.id === 'api7')?.statement?.date, '2025-12-04')
assert.equal(merged.transactions.find((row) => row.id === 'api7')?.pl, -170.34)
assert.equal(merged.transactions.find((row) => row.id === 'other')?.symbol, 'OTHER')
const again = reconcileStatementTransactions([account, other], merged.transactions, [parsed])
assert.equal(again.added, 0)
assert.deepEqual(again.transactions, merged.transactions, 're-import and shared-preference hydration are idempotent')
assert.equal(duplicateTransactionIds(merged.transactions).size, 0)
assert.deepEqual(original[0].symbol, undefined, 'preview never mutates the ledger')
assert.equal(reconcileStatementTransactions([account], [], [{ ...parsed, complete: false }]).added, 0)

const ambiguous: StatementTransactions = { ...parsed, transactions: [parsed.transactions[0], { ...parsed.transactions[0], symbol: 'DIFFERENT', statement: { ...parsed.transactions[0].statement!, key: 'different' } }] }
const held = reconcileStatementTransactions([account], [api(0, { symbol: undefined }), api(1, { symbol: undefined })], [ambiguous])
assert.equal(held.ambiguous, 2)
assert.equal(held.added, 0)
const fills = reconcileStatementTransactions([account], [api(7, { id: 'fill1', units: -100, amount: 2000 }), api(7, { id: 'fill2', units: -66.8301, amount: 2022.24 })], [{ ...parsed, transactions: [parsed.transactions[7]] }])
assert.equal(fills.added, 0, 'aggregate statement trades do not double-count API fills')
assert.equal(fills.ambiguous, 1)

const imported = reconcileStatementTransactions([account], [], [parsed]).transactions
const target = imported.find((row) => row.statement?.key === parsed.transactions[0].statement?.key)!
const overrides = recordTransactionOverride(imported, [account], {}, target.id, { symbol: 'MANUAL', type: 'Other' })
const synced = reconcileStatementTransactions([account], original.slice(0, 3), [parsed]).transactions
applyTransactionOverrides(synced, [account], overrides)
assert.equal(synced.find((row) => row.id === 'api0')?.symbol, 'MANUAL', 'manual PDF-row edits survive acquiring an API broker ID')
assert.equal(synced.find((row) => row.id === 'api0')?.type, 'Other')
assert.equal(synced.find((row) => row.id === 'api1')?.symbol, 'TSYY', 'only the edited repeated payment changes')
const linkedEdit = recordTransactionOverride(synced, [account], overrides, 'api0', { symbol: 'NEWEDIT' }, '2099-01-01T00:00:00Z')
const outsideApiWindow = reconcileStatementTransactions([account], [], [parsed]).transactions
applyTransactionOverrides(outsideApiWindow, [account], linkedEdit)
assert.equal(outsideApiWindow.find((row) => row.statement?.key === target.statement?.key)?.symbol, 'NEWEDIT', 'edits persist when the payment leaves the API history window')
const newer = { ...parsed, importedAt: '2026-09-22T12:00:00Z' }, older = { ...parsed, importedAt: '2026-09-20T12:00:00Z', transactions: [] }
assert.deepEqual(mergeStatementTransactions([newer], [older]), [newer], 'stale device preferences cannot erase statement records')
console.log('statement transaction tests passed: layout, wrapped rows, withholding, reinvestment, options, totals, settlement matching, repeat imports and manual persistence')
