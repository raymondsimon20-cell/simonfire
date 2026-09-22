import type { Account, HistoricalBalance, MonthlyBalanceSnapshot } from './types'
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
    rows.set(`${accountMask}|${balance.month}`, { ...balance, accountMask })
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
}

// A statement that prints no "Net Loan Balance" line is a statement for an
// account that cannot borrow: its loan is zero, not unknown. Margin accounts
// stay strict so a missed line never reads as "no debt".
export function statementMarginDebt(row: HistoricalBalance, accounts: Account[]) {
  if (row.marginLoanBalance != null) return row.marginLoanBalance
  const account = statementAccount(row, accounts)
  return account && !account.isMargin ? 0 : undefined
}

export function statementHistory(balances: HistoricalBalance[], accounts: Account[], scope: string, snapshots: MonthlyBalanceSnapshot[] = []): StatementMonth[] {
  const groups = new Map<string, HistoricalBalance[]>()
  const imported = mergeHistoricalBalances([], balances, accounts)
  const combined = mergeHistoricalBalances(automaticBalances(snapshots, imported), imported, accounts)
  for (const balance of combined) {
    if (scope !== 'all' && statementAccount(balance, accounts)?.id !== scope) continue
    groups.set(balance.month, [...(groups.get(balance.month) ?? []), balance])
  }
  const selected = accounts.filter((account) => scope === 'all' || account.id === scope)
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([month, statements]) => {
    const sum = (field: 'openingEquity' | 'closingEquity' | 'deposits' | 'withdrawals' | 'dividendsInterest' | 'marketChange' | 'expenses') =>
      statements.reduce((total, row) => total + (row[field] ?? 0), 0)
    const margins = statements.map((row) => statementMarginDebt(row, accounts))
    const missingAccounts = selected.filter((account) => !statements.some((row) => statementAccount(row, accounts)?.id === account.id))
    const unmatched = statements.filter((row) => !statementAccount(row, accounts))
    const noOpening = statements.filter((row) => row.openingEquity == null).map((row) => statementAccount(row, accounts)?.name ?? `····${row.accountMask || '?'}`)
    return {
      ...statements[0], month, statements, missingAccounts, unmatched, noOpening,
      asOf: statements.map((row) => row.asOf).filter((date): date is string => !!date).sort()[0],
      monthEnd: statements.every((row) => row.source !== 'Automatic snapshot' || row.monthEnd),
      flowsAvailable: statements.every((row) => row.flowsAvailable !== false),
      coverageNote: [...new Set(statements.map((row) => row.coverageNote).filter(Boolean))].join(' '),
      complete: selected.length > 0 && missingAccounts.length === 0 && unmatched.length === 0,
      openingEquity: statements.every((row) => row.openingEquity != null) ? sum('openingEquity') : undefined,
      closingEquity: sum('closingEquity'), deposits: sum('deposits'), withdrawals: sum('withdrawals'),
      dividendsInterest: sum('dividendsInterest'), marketChange: sum('marketChange'), expenses: sum('expenses'),
      marginLoanBalance: margins.every((value) => value != null) ? margins.reduce((total, value) => total + value!, 0) : undefined,
    }
  })
}

export function statementProfit(row: HistoricalBalance) {
  return row.openingEquity == null || row.flowsAvailable === false ? undefined : row.closingEquity - row.openingEquity - row.deposits - row.withdrawals
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
  if (row.missingAccounts.length) parts.push(`No statement for ${row.missingAccounts.map((account) => account.name).join(', ')}.`)
  if (row.unmatched.length) {
    const blank = row.unmatched.filter((item) => !item.accountMask.replace(/\D/g, ''))
    if (blank.length) parts.push(`${blank.length} imported row${blank.length === 1 ? ' has' : 's have'} no account number, so it cannot be tied to an account: re-import it with the account chosen.`)
    const other = row.unmatched.length - blank.length
    if (other) parts.push(`${other} statement${other === 1 ? '' : 's'} could not be matched to an account (ending ${row.unmatched.filter((item) => item.accountMask.replace(/\D/g, '')).map((item) => item.accountMask).join(', ')}).`)
  }
  if (row.openingEquity == null && row.noOpening.length) parts.push(`No opening balance for ${row.noOpening.join(', ')}: import the ${monthLabel(previousMonth(row.month))} statement.`)
  if (row.marginLoanBalance == null) {
    const strict = row.statements.filter((item) => item.marginLoanBalance == null)
    if (strict.length && !row.missingAccounts.length) parts.push('Margin debt unknown: a margin account statement has no Net Loan Balance line.')
  }
  return parts.join(' ')
}
