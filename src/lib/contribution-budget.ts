import type { Account, Transaction } from './types'
import { marginCapacity } from './margin'
import { averagePortfolioSpending, spendingExclusionKey } from './spending'

// One month of outflows is reserved against current balances. Do not add future
// wages/dividends or treat a withdrawal like a purchase: withdrawals reduce equity.
export function contributionBudget(account: Account | undefined, positionValue: number, transactions: Transaction[], today: string, exclusions: string[] = []) {
  const rows = transactions.filter((row) => row.accountId === account?.id)
  const spending = averagePortfolioSpending(rows, today, exclusions)
  const current = marginCapacity(account, positionValue)
  const excluded = new Set(exclusions)
  const reviewRows = rows.filter((row) => spending && row.date.slice(0, 7) >= spending.from && row.date.slice(0, 7) <= spending.to && row.amount < 0 && (row.type === 'Other' || row.type === 'Transfer') && !excluded.has(spendingExclusionKey(row)))
  if (!account || !spending || !current) return { spending, current, reserved: null, reviewRows }
  const reserve = spending.monthlyAverage
  const cash = Math.max(0, account.cash || 0)
  const debt = Math.max(0, account.marginBalance || 0)
  const equity = account.equity ?? positionValue + account.cash - debt
  const reserved = marginCapacity({
    ...account,
    cash: Math.max(0, cash - reserve),
    marginBalance: debt + (account.isMargin ? Math.max(0, reserve - cash) : 0),
    equity: equity - reserve,
    buyingPower: account.buyingPower == null ? undefined : Math.max(0, account.buyingPower - reserve),
    sma: account.sma == null ? undefined : Math.max(0, account.sma - reserve),
  }, positionValue)!
  return { spending, current, reserved, reviewRows }
}
