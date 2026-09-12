import type { Transaction } from './types'

export interface SpendingAverage {
  monthlyAverage: number
  total: number
  months: number
  from: string
  to: string
  transactionCount: number
}

const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1)
const isoMonth = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

// Average portfolio-funded spending over as many as 12 complete calendar months.
// Only explicit withdrawals and bill payments count. Buys, transfers, taxes,
// fees, and margin interest remain separate portfolio/carrying-cost decisions.
export function averagePortfolioSpending(transactions: Transaction[], todayISO: string): SpendingAverage | null {
  const dated = transactions.filter((transaction) => /^\d{4}-\d{2}-\d{2}$/.test(transaction.date) && transaction.date <= todayISO)
  if (!dated.length) return null

  const today = new Date(`${todayISO}T00:00:00`)
  const end = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const earliest = dated.reduce((value, transaction) => transaction.date < value ? transaction.date : value, dated[0].date)
  const earliestDate = new Date(`${earliest}T00:00:00`)
  // A Schwab sync normally begins mid-month. Start with the following month so
  // a partial first month does not make the average look artificially low.
  const firstComplete = earliestDate.getDate() === 1
    ? monthStart(earliestDate)
    : new Date(earliestDate.getFullYear(), earliestDate.getMonth() + 1, 1)
  const twelveMonthFloor = new Date(end.getFullYear(), end.getMonth() - 11, 1)
  const start = firstComplete > twelveMonthFloor ? firstComplete : twelveMonthFloor
  if (start > end) return null

  const months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1
  const from = isoMonth(start)
  const to = isoMonth(end)
  const spending = dated.filter((transaction) =>
    transaction.amount < 0
    && (transaction.type === 'Bill Payment' || transaction.type === 'Withdrawal')
    && transaction.date.slice(0, 7) >= from
    && transaction.date.slice(0, 7) <= to,
  )
  const total = spending.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0)
  return {
    monthlyAverage: +(total / months).toFixed(2),
    total: +total.toFixed(2),
    months,
    from,
    to,
    transactionCount: spending.length,
  }
}
