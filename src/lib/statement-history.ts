import type { Account, HistoricalBalance, MonthlyBalanceSnapshot } from './types'
import { automaticBalances } from './balance-snapshots'

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

export type StatementMonth = HistoricalBalance & { statements: HistoricalBalance[]; complete: boolean }

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
    const sum = (field: 'openingEquity' | 'closingEquity' | 'deposits' | 'withdrawals' | 'dividendsInterest' | 'marketChange' | 'expenses' | 'marginLoanBalance') =>
      statements.reduce((total, row) => total + (row[field] ?? 0), 0)
    return {
      ...statements[0], month, statements,
      asOf: statements.map((row) => row.asOf).filter((date): date is string => !!date).sort()[0],
      monthEnd: statements.every((row) => row.source !== 'Automatic snapshot' || row.monthEnd),
      flowsAvailable: statements.every((row) => row.flowsAvailable !== false),
      coverageNote: [...new Set(statements.map((row) => row.coverageNote).filter(Boolean))].join(' '),
      complete: selected.length > 0 && selected.every((account) => statements.some((row) => statementAccount(row, accounts)?.id === account.id)) && statements.every((row) => !!statementAccount(row, accounts)),
      openingEquity: statements.every((row) => row.openingEquity != null) ? sum('openingEquity') : undefined,
      closingEquity: sum('closingEquity'), deposits: sum('deposits'), withdrawals: sum('withdrawals'),
      dividendsInterest: sum('dividendsInterest'), marketChange: sum('marketChange'), expenses: sum('expenses'),
      marginLoanBalance: statements.every((row) => row.marginLoanBalance != null) ? sum('marginLoanBalance') : undefined,
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
