import type { Account, HistoricalBalance, MonthlyBalanceSnapshot, Transaction } from './types'
import { automaticBalances, previousMonth } from './balance-snapshots'
import { monthLabel } from './format'

export function statementAccount(balance: Pick<HistoricalBalance, 'accountMask'>, accounts: Account[]) {
  const mask = balance.accountMask.replace(/\D/g, '')
  if (!mask) return accounts.length === 1 ? accounts[0] : undefined
  const matches = accounts.filter((account) => {
    const candidate = account.mask.replace(/\D/g, '')
    return candidate && (candidate.endsWith(mask) || mask.endsWith(candidate))
  })
  return matches.length === 1 ? matches[0] : undefined
}

export function mergeHistoricalBalances(existing: HistoricalBalance[], incoming: HistoricalBalance[], accounts: Account[]) {
  const rows = new Map<string, HistoricalBalance>()
  // New imports replace a month for the same account, including legacy blank masks
  // when there is only one account. Re-importing never doubles the balances.
  for (const balance of [...existing, ...incoming]) {
    const accountMask = statementAccount(balance, accounts)?.mask ?? balance.accountMask
    const key = `${accountMask}|${balance.month}`
    const prior = rows.get(key)
    // A newer file for the same month replaces the old one, but it must not
    // erase a loan balance the older file had (e.g. a CSV with net_loan_balance
    // followed by a PDF whose loan line didn't parse) when both describe the
    // same month-end.
    const keepLoan = balance.marginLoanBalance == null && prior?.marginLoanBalance != null && Math.abs(prior.closingEquity - balance.closingEquity) < 1
    rows.set(key, { ...balance, accountMask, ...(keepLoan ? { marginLoanBalance: prior.marginLoanBalance } : {}) })
  }
  return [...rows.values()].sort((a, b) => a.month.localeCompare(b.month))
}

export type StatementMonth = HistoricalBalance & {
  statements: HistoricalBalance[]
  complete: boolean
  /** Accounts in scope that have no statement or snapshot for this month. */
  missingAccounts: Account[]
  /** Statements whose account mask could not be matched to a known account. */
  unmatched: HistoricalBalance[]
  /** Display names of accounts whose row has no opening balance this month. */
  noOpening: string[]
  /** Accounts whose loan figure was inferred (no loan line) or is unknown. */
  loanNotes: { account: string; basis: LoanBasis }[]
}

// Schwab prints a "Net Loan Balance" line only when an account is carrying a
// loan. A cash/IRA account never has one, so it is $0. A margin-enabled account
// with no line is also $0: it hasn't started borrowing yet, or it paid the loan
// off (both happen next to months that do show a loan). The only pattern that
// points to a parse miss is a loan in the month BEFORE and the month AFTER with
// no line in between; then the figure stays unknown.
export type LoanBasis = 'statement' | 'no line · cash account' | 'no line · not borrowing' | 'unknown'

export function statementMarginDebt(row: HistoricalBalance, accounts: Account[], all: HistoricalBalance[] = []): { value?: number; basis: LoanBasis } {
  if (row.marginLoanBalance != null) return { value: row.marginLoanBalance, basis: 'statement' }
  const account = statementAccount(row, accounts)
  if (!account) return { basis: 'unknown' }
  if (!account.isMargin) return { value: 0, basis: 'no line · cash account' }
  const borrowedIn = (month: string) => all.some((other) => other.month === month && statementAccount(other, accounts)?.id === account.id && (other.marginLoanBalance ?? 0) > 0)
  return borrowedIn(previousMonth(row.month)) && borrowedIn(nextMonth(row.month)) ? { basis: 'unknown' } : { value: 0, basis: 'no line · not borrowing' }
}

function nextMonth(month: string) {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7)
}

export type OpenMonthSource = 'manual' | 'first statement' | undefined
const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/

// When did each account start? A manual month always wins. Otherwise, if the
// earliest recorded month for an account opens at $0.00, the account held
// nothing before then, so earlier months should not expect a statement for it.
// (Even if it technically existed, its balance contributed $0.) Without that
// evidence nothing is assumed: a missing statement stays a real gap.
export function accountOpenMonths(balances: HistoricalBalance[], accounts: Account[], manual: Record<string, string> = {}) {
  const result = new Map<string, { month: string; source: Exclude<OpenMonthSource, undefined> }>()
  for (const account of accounts) {
    const set = manual[account.mask]
    if (set && MONTH.test(set)) { result.set(account.id, { month: set, source: 'manual' }); continue }
    const first = balances.filter((row) => statementAccount(row, accounts)?.id === account.id).sort((a, b) => a.month.localeCompare(b.month))[0]
    if (first && first.openingEquity != null && Math.abs(first.openingEquity) < 0.005) result.set(account.id, { month: first.month, source: 'first statement' })
  }
  return result
}

export function statementHistory(balances: HistoricalBalance[], accounts: Account[], scope: string, snapshots: MonthlyBalanceSnapshot[] = [], manualOpenMonths: Record<string, string> = {}): StatementMonth[] {
  const groups = new Map<string, HistoricalBalance[]>()
  const imported = mergeHistoricalBalances([], balances, accounts)
  const combined = mergeHistoricalBalances(automaticBalances(snapshots, imported), imported, accounts)
  const opened = accountOpenMonths(combined, accounts, manualOpenMonths)
  for (const balance of combined) {
    if (scope !== 'all' && statementAccount(balance, accounts)?.id !== scope) continue
    groups.set(balance.month, [...(groups.get(balance.month) ?? []), balance])
  }
  const selected = accounts.filter((account) => scope === 'all' || account.id === scope)
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([month, statements]) => {
    const sum = (field: 'openingEquity' | 'closingEquity' | 'deposits' | 'withdrawals' | 'dividendsInterest' | 'marketChange' | 'expenses') =>
      statements.reduce((total, row) => total + (row[field] ?? 0), 0)
    const loans = statements.map((row) => ({ row, ...statementMarginDebt(row, accounts, combined) }))
    const margins = loans.map((item) => item.value)
    const loanNotes = loans.filter((item) => item.basis !== 'statement' && item.basis !== 'no line · cash account').map((item) => ({ account: statementAccount(item.row, accounts)?.name ?? `····${item.row.accountMask || '?'}`, basis: item.basis }))
    const expected = selected.filter((account) => !opened.has(account.id) || month >= opened.get(account.id)!.month)
    const missingAccounts = expected.filter((account) => !statements.some((row) => statementAccount(row, accounts)?.id === account.id))
    const unmatched = statements.filter((row) => !statementAccount(row, accounts))
    const noOpening = statements.filter((row) => row.openingEquity == null).map((row) => statementAccount(row, accounts)?.name ?? `····${row.accountMask || '?'}`)
    return {
      ...statements[0], month, statements, missingAccounts, unmatched, noOpening, loanNotes,
      asOf: statements.map((row) => row.asOf).filter((date): date is string => !!date).sort()[0],
      monthEnd: statements.every((row) => row.source !== 'Automatic snapshot' || row.monthEnd),
      flowsAvailable: statements.every((row) => row.flowsAvailable !== false),
      coverageNote: [...new Set(statements.map((row) => row.coverageNote).filter(Boolean))].join(' '),
      complete: expected.length > 0 && missingAccounts.length === 0 && unmatched.length === 0,
      openingEquity: statements.every((row) => row.openingEquity != null) ? sum('openingEquity') : undefined,
      closingEquity: sum('closingEquity'), deposits: sum('deposits'), withdrawals: sum('withdrawals'),
      dividendsInterest: sum('dividendsInterest'), marketChange: sum('marketChange'), expenses: sum('expenses'),
      marginLoanBalance: margins.every((value) => value != null) ? margins.reduce((total, value) => total + value!, 0) : undefined,
    }
  })
}

// Investment result for a month. Pass the month's tax withheld so it is
// treated as money leaving, not as an investment loss.
export function statementProfit(row: HistoricalBalance, withheld = 0) {
  return row.openingEquity == null || row.flowsAvailable === false ? undefined : row.closingEquity - row.openingEquity - row.deposits - row.withdrawals + withheld
}

export function historySource(row: StatementMonth) {
  const automatic = row.statements.filter((item) => item.source === 'Automatic snapshot').length
  return automatic === 0 ? 'Imported' : automatic === row.statements.length ? 'Auto snapshot' : 'Mixed sources'
}

export function statementBridgeValues(row: HistoricalBalance) {
  return [row.openingEquity ?? 0, row.deposits, row.withdrawals, row.dividendsInterest + row.expenses, row.marketChange, row.closingEquity]
}

// One sentence a person can act on: which statements to import, or why a
// figure is blank. Empty when the month is complete and fully reconciled.
export function coverageGap(row: StatementMonth) {
  const parts: string[] = []
  if (row.missingAccounts.length) parts.push(`No statement for ${row.missingAccounts.map((account) => account.name).join(', ')}. If it opened later, set its open month in Data Quality.`)
  if (row.unmatched.length) {
    const blank = row.unmatched.filter((item) => !item.accountMask.replace(/\D/g, ''))
    if (blank.length) parts.push(`${blank.length} imported row${blank.length === 1 ? ' has' : 's have'} no account number, so it cannot be tied to an account: re-import it with the account chosen.`)
    const other = row.unmatched.length - blank.length
    if (other) parts.push(`${other} statement${other === 1 ? '' : 's'} could not be matched to an account (ending ${row.unmatched.filter((item) => item.accountMask.replace(/\D/g, '')).map((item) => item.accountMask).join(', ')}).`)
  }
  if (row.openingEquity == null && row.noOpening.length) parts.push(`No opening balance for ${row.noOpening.join(', ')}: import the ${monthLabel(previousMonth(row.month))} statement.`)
  const unknown = row.loanNotes.filter((note) => note.basis === 'unknown').map((note) => note.account)
  if (unknown.length) parts.push(`Margin debt unknown: the ${unknown.join(', ')} statement has no Net Loan Balance line, but the months before and after both show a loan. Re-import it or check the PDF.`)
  return parts.join(' ')
}

// Short note for figures inferred from a missing loan line (not an error).
export function loanAssumption(row: StatementMonth) {
  const zero = row.loanNotes.filter((note) => note.basis === 'no line · not borrowing').map((note) => note.account)
  return zero.length ? `${zero.join(', ')}: no loan line on the statement, counted as $0 (margin-enabled, not borrowing).` : ''
}

// ---------- Time-weighted return from recorded months ----------
// Each month is measured with Modified Dietz, the standard way to get a return
// from a month's opening balance, closing balance and external flows when the
// exact day of each flow isn't used:
//
//     r = (closing − opening − netFlow) / (opening + netFlow / 2)
//
// netFlow is deposits + withdrawals exactly as the statement (or snapshot)
// records them, so money moving in or out is never counted as return. Income
// and fees stay inside the portfolio and are part of the result. Monthly returns
// are chained geometrically. The chain starts at the earliest month in the
// window and restarts after any month that can't be measured (partial account
// coverage, no opening balance, or unavailable cash flows), so the label always
// states the span actually measured.
export interface StatementTwr {
  ok: boolean
  twrPct: number
  gainUsd: number
  startMonth: string
  endMonth: string
  months: number
  estimated: boolean // includes an automatic-snapshot month
}

// Tax withheld from dividends is a prepayment of your income tax, not an
// investment loss. Statements print dividends net of it; Schwab's performance
// view counts the gross dividend as income and the withholding as money
// leaving. The flow context carries it, plus the dates money actually moved,
// so each month's return can weight flows by when they happened.
export interface FlowContext {
  withheld: Map<string, number> // month -> tax withheld (positive dollars)
  daily: Map<string, number> // date -> net external flow (deposits +, withdrawals / bills / tax -)
}

export const EMPTY_FLOWS: FlowContext = { withheld: new Map(), daily: new Map() }

// A withdrawal from one of your accounts that lands as a deposit in another of
// your accounts (same amount, within a few days) is money moving between your
// accounts, not money leaving to you. Each deposit pairs once.
export function internalTransferIds(pool: Transaction[], windowDays = 4) {
  const ids = new Set<string>()
  const deposits = pool.filter((t) => t.type === 'Contribution' && t.amount > 0).sort((a, b) => a.date.localeCompare(b.date))
  const used = new Set<string>()
  const day = (date: string) => new Date(`${date}T12:00:00Z`).getTime() / 86_400_000
  for (const out of pool.filter((t) => (t.type === 'Withdrawal' || t.type === 'Bill Payment') && t.amount < 0).sort((a, b) => a.date.localeCompare(b.date))) {
    const match = deposits.find((d) => !used.has(d.id) && d.accountId !== out.accountId && Math.abs(d.amount + out.amount) < 0.01 && Math.abs(day(d.date) - day(out.date)) <= windowDays)
    if (!match) continue
    used.add(match.id)
    ids.add(out.id)
    ids.add(match.id)
  }
  return ids
}

export function flowContext(transactions: Transaction[]): FlowContext {
  const withheld = new Map<string, number>()
  const daily = new Map<string, number>()
  const internal = internalTransferIds(transactions)
  for (const t of transactions) {
    if (t.type === 'Tax Withholding' && t.amount < 0) {
      withheld.set(t.date.slice(0, 7), (withheld.get(t.date.slice(0, 7)) ?? 0) - t.amount)
      daily.set(t.date, (daily.get(t.date) ?? 0) + t.amount)
    } else if ((t.type === 'Contribution' || t.type === 'Withdrawal' || t.type === 'Bill Payment') && !internal.has(t.id)) {
      daily.set(t.date, (daily.get(t.date) ?? 0) + t.amount)
    }
  }
  return { withheld, daily }
}

// Modified Dietz for one month. Each dated flow is weighted by the share of the
// month it was invested (a deposit on the 2nd counts almost fully, one on the
// 28th barely). Any part of the statement's net flow the transactions don't
// explain is placed mid-month.
export function monthlyReturn(row: StatementMonth, flows: FlowContext = EMPTY_FLOWS) {
  if (!row.complete || row.openingEquity == null || row.flowsAvailable === false) return undefined
  const withheld = flows.withheld.get(row.month) ?? 0
  const flow = row.deposits + row.withdrawals - withheld
  const [year, number] = row.month.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(year, number, 0)).getUTCDate()
  const end = row.asOf && row.asOf.slice(0, 7) === row.month ? Math.max(1, Number(row.asOf.slice(8, 10))) : daysInMonth
  let dated = 0
  let weighted = 0
  for (const [date, amount] of flows.daily) {
    if (date.slice(0, 7) !== row.month) continue
    const day = Number(date.slice(8, 10))
    if (day > end) continue
    dated += amount
    weighted += amount * Math.max(0, (end - day + 0.5) / end)
  }
  const base = row.openingEquity + weighted + (flow - dated) / 2
  if (base <= 0) return undefined
  const gain = row.closingEquity - row.openingEquity - flow
  return { r: gain / base, gain }
}

export function statementTwr(rows: StatementMonth[], fromMonth = '', flows: FlowContext = EMPTY_FLOWS): StatementTwr {
  const window = rows.filter((row) => !fromMonth || row.month >= fromMonth).sort((a, b) => a.month.localeCompare(b.month))
  // Longest unbroken run ending at the latest measurable month.
  let run: { row: StatementMonth; r: number; gain: number }[] = []
  for (const row of window) {
    const result = monthlyReturn(row, flows)
    if (!result) { run = []; continue }
    run.push({ row, ...result })
  }
  if (!run.length) return { ok: false, twrPct: 0, gainUsd: 0, startMonth: '', endMonth: '', months: 0, estimated: false }
  return {
    ok: true,
    twrPct: run.reduce((factor, item) => factor * (1 + item.r), 1) - 1,
    gainUsd: run.reduce((sum, item) => sum + item.gain, 0),
    startMonth: run[0].row.month,
    endMonth: run.at(-1)!.row.month,
    months: run.length,
    estimated: run.some((item) => item.row.statements.some((statement) => statement.source === 'Automatic snapshot')),
  }
}
