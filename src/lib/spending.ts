import type { Transaction } from './types'

export interface SpendingAverage {
  monthlyAverage: number
  total: number
  months: number
  from: string
  to: string
  transactionCount: number
  livingSpending: number
  marginInterest: number
  fees: number
  taxWithholding: number
}

export function spendingExclusionKey(transaction: Transaction) {
  const description = transaction.description.trim().toUpperCase().replace(/\s+/g, ' ')
  return `${transaction.accountId}|${transaction.date}|${transaction.amount.toFixed(2)}|${description}`
}

const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1)
const isoMonth = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

// Up to 12 complete calendar months ending last month, starting no earlier
// than the first full month of history (a sync usually begins mid-month).
function completeMonthWindow(dated: Transaction[], todayISO: string) {
  const today = new Date(`${todayISO}T00:00:00`)
  const end = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const earliest = dated.reduce((value, transaction) => transaction.date < value ? transaction.date : value, dated[0].date)
  const earliestDate = new Date(`${earliest}T00:00:00`)
  const firstComplete = earliestDate.getDate() === 1
    ? monthStart(earliestDate)
    : new Date(earliestDate.getFullYear(), earliestDate.getMonth() + 1, 1)
  const twelveMonthFloor = new Date(end.getFullYear(), end.getMonth() - 11, 1)
  const start = firstComplete > twelveMonthFloor ? firstComplete : twelveMonthFloor
  if (start > end) return null
  const months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1
  return { months, from: isoMonth(start), to: isoMonth(end) }
}

// Average portfolio-funded spending over as many as 12 complete calendar months.
// Explicit withdrawals and bill payments count as living spending. Negative
// interest and fee transactions are included as portfolio carrying costs.
// Pass internalIds (matched transfers between your own accounts) so moving money
// between accounts is not counted as spending.
export function averagePortfolioSpending(transactions: Transaction[], todayISO: string, exclusions: Iterable<string> = [], internalIds: ReadonlySet<string> = new Set()): SpendingAverage | null {
  const excluded = new Set(exclusions)
  const dated = transactions.filter((transaction) => /^\d{4}-\d{2}-\d{2}$/.test(transaction.date) && transaction.date <= todayISO)
  if (!dated.length) return null

  const window = completeMonthWindow(dated, todayISO)
  if (!window) return null
  const { months, from, to } = window
  const spending = dated.filter((transaction) =>
    transaction.amount < 0
    && (transaction.type === 'Bill Payment' || transaction.type === 'Withdrawal' || transaction.type === 'Interest' || transaction.type === 'Fee')
    && transaction.date.slice(0, 7) >= from
    && transaction.date.slice(0, 7) <= to,
  ).filter((transaction) => !excluded.has(spendingExclusionKey(transaction)) && !internalIds.has(transaction.id))
  const sumTypes = (...types: Transaction['type'][]) => spending
    .filter((transaction) => types.includes(transaction.type))
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0)
  const livingSpending = sumTypes('Bill Payment', 'Withdrawal')
  const marginInterest = sumTypes('Interest')
  const fees = sumTypes('Fee')
  const taxWithholding = dated
    .filter((transaction) => transaction.amount < 0 && transaction.type === 'Tax Withholding' && transaction.date.slice(0, 7) >= from && transaction.date.slice(0, 7) <= to)
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0)
  const total = spending.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0)
  return {
    monthlyAverage: +(total / months).toFixed(2),
    total: +total.toFixed(2),
    months,
    from,
    to,
    transactionCount: spending.length,
    livingSpending: +livingSpending.toFixed(2),
    marginInterest: +marginInterest.toFixed(2),
    fees: +fees.toFixed(2),
    taxWithholding: +taxWithholding.toFixed(2),
  }
}

export interface ContributionAverage {
  monthlyAverage: number
  total: number
  months: number
  from: string
  to: string
  transactionCount: number
}

// Average new money deposited over as many as 12 complete calendar months.
// Only positive deposits of the given types count (default: W-2 and Contribution). Pass the ids of internal
// transfers between your own accounts so moving money is not counted as new.
export function averageMonthlyContributions(transactions: Transaction[], todayISO: string, excludeIds: ReadonlySet<string> = new Set(), types: readonly Transaction['type'][] = ['Contribution', 'W-2']): ContributionAverage | null {
  const dated = transactions.filter((transaction) => /^\d{4}-\d{2}-\d{2}$/.test(transaction.date) && transaction.date <= todayISO)
  if (!dated.length) return null
  const window = completeMonthWindow(dated, todayISO)
  if (!window) return null
  const { months, from, to } = window
  const deposits = dated.filter((transaction) =>
    types.includes(transaction.type) && transaction.amount > 0 && !excludeIds.has(transaction.id)
    && transaction.date.slice(0, 7) >= from && transaction.date.slice(0, 7) <= to)
  const total = deposits.reduce((sum, transaction) => sum + transaction.amount, 0)
  return { monthlyAverage: +(total / months).toFixed(2), total: +total.toFixed(2), months, from, to, transactionCount: deposits.length }
}
