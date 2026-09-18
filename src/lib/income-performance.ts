import type { Transaction, TwrPoint } from './types'
import { flowsByDate } from './twr'
import { isClosingSale } from './transaction-review'

// Transaction earnings do not require reconstructed market-value history.
export function incomeAndRealizedGains(transactions: Transaction[], fromDate: string, toDate: string) {
  const txns = transactions.filter((t) => t.date >= fromDate && t.date <= toDate)
  const sum = (type: Transaction['type']) => txns.filter((t) => t.type === type).reduce((n, t) => n + t.amount, 0)
  const dividends = sum('Dividend')
  const interest = txns.filter((t) => t.type === 'Interest' && t.amount > 0).reduce((n, t) => n + t.amount, 0)
  const sales = txns.filter((t) => t.type === 'Sell')
  const realized = sales.reduce((n, t) => n + (t.pl ?? 0), 0)
  const marginInterest = -txns.filter((t) => t.type === 'Interest' && t.amount < 0).reduce((n, t) => n + t.amount, 0)
  const fees = -sum('Fee')
  const gross = dividends + interest + realized
  const missingPl = sales.filter((t) => isClosingSale(t) && t.pl == null).length
  const estimated = sales.some((t) => t.pl != null && t.plEstimated)
  return { dividends, interest, realized, marginInterest, fees, gross, net: gross - marginInterest - fees, missingPl, estimated }
}

// Use endpoint dollar changes, not linked TWR steps or lifetime cost basis.
// This reconciles the covered value series even when a TWR step is unusable.
export function incomePerformance(series: TwrPoint[], transactions: Transaction[]) {
  const points = [...series].sort((a, b) => a.date.localeCompare(b.date))
  if (points.length < 2 || points.some((p) => !Number.isFinite(p.value))) return null
  const start = points[0]
  const end = points.at(-1)!
  if (start.date === end.date) return null
  const txns = transactions.filter((t) => t.date > start.date && t.date <= end.date)
  const sum = (type: Transaction['type']) => txns.filter((t) => t.type === type).reduce((n, t) => n + t.amount, 0)
  const dividends = sum('Dividend')
  const interest = txns.filter((t) => t.type === 'Interest' && t.amount > 0).reduce((n, t) => n + t.amount, 0)
  const costs = -sum('Fee') - txns.filter((t) => t.type === 'Interest' && t.amount < 0).reduce((n, t) => n + t.amount, 0)
  const taxes = -sum('Tax Withholding')
  const contributions = sum('Contribution')
  const withdrawals = -sum('Withdrawal') - sum('Bill Payment')
  const netFlows = [...flowsByDate(txns).values()].reduce((n, value) => n + value, 0)
  const optionCash = netFlows - (contributions - withdrawals)
  const investmentChange = end.value - start.value - netFlows
  const netIncome = dividends + interest - costs - taxes
  const priceChange = investmentChange - netIncome
  const retained = investmentChange - withdrawals
  const incomeAfterWithdrawals = netIncome - withdrawals
  const needsReview = txns.filter((t) => ['Other', 'Transfer', 'Corporate Action'].includes(t.type)).length
  return { start, end, dividends, interest, costs, taxes, contributions, withdrawals, optionCash,
    investmentChange, netIncome, priceChange, retained, incomeAfterWithdrawals, needsReview }
}
