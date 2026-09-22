import type { Transaction, TwrPoint } from './types'
import { flowsByDate } from './twr'
import { isClosingSale } from './transaction-review'
import { monthlyReturn, type StatementMonth } from './statement-history'

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

// ---------- Recorded-month version (statements + saved balances) ----------
// The capital side comes from recorded month-end equity, which already nets
// margin debt and uses deposits/withdrawals exactly as Schwab reported them, so
// borrowing or moving money is never counted as investment gain. Uses the same
// unbroken run of measurable months as the statement TWR.
// A withdrawal from one of your accounts that lands as a deposit in another of
// your accounts (same amount, within a few days) is money moving between your
// accounts, not money leaving to you. Schwab classifies each side on its own
// statement, so they have to be paired up here. Each deposit pairs once.
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

export function recordedIncomePerformance(rows: StatementMonth[], transactions: Transaction[], fromMonth = '', allTransactions: Transaction[] = transactions) {
  const window = rows.filter((row) => !fromMonth || row.month >= fromMonth).sort((a, b) => a.month.localeCompare(b.month))
  let run: StatementMonth[] = []
  for (const row of window) run = monthlyReturn(row) ? [...run, row] : []
  if (!run.length) return null
  const first = run[0]
  const last = run.at(-1)!
  const total = (pick: (row: StatementMonth) => number) => run.reduce((sum, row) => sum + pick(row), 0)
  const deposits = total((row) => row.deposits)
  const statementWithdrawals = -total((row) => row.withdrawals)
  const beginning = first.openingEquity!
  const ending = last.closingEquity
  // Statements print dividends net of tax withheld. Add it back: withholding is
  // a prepayment of your income tax (credited on your return), not a loss.
  const months = new Set(run.map((row) => row.month))
  const taxWithheld = -transactions.filter((t) => t.type === 'Tax Withholding' && t.amount < 0 && months.has(t.date.slice(0, 7))).reduce((n, t) => n + t.amount, 0)
  const investmentChange = ending - beginning - deposits + statementWithdrawals + taxWithheld
  const income = total((row) => row.dividendsInterest) + taxWithheld
  const costs = -total((row) => row.expenses)
  const netIncome = income - costs
  // Money that actually left to you: transaction-classified withdrawals and
  // bills, so transfers between your own accounts (tagged Transfer) don't count.
  const fromDate = `${first.month}-01`
  const toDate = last.asOf?.slice(0, 10) ?? `${last.month}-31`
  const txns = transactions.filter((t) => t.date >= fromDate && t.date <= toDate)
  const internal = internalTransferIds(allTransactions.filter((t) => t.date >= fromDate && t.date <= toDate))
  const outflows = txns.filter((t) => t.type === 'Withdrawal' || t.type === 'Bill Payment')
  const withdrawals = -outflows.filter((t) => !internal.has(t.id)).reduce((n, t) => n + t.amount, 0)
  const internalOut = -outflows.filter((t) => internal.has(t.id)).reduce((n, t) => n + t.amount, 0)
  return {
    fromMonth: first.month, toMonth: last.month, asOf: last.asOf, estimated: run.some((row) => row.statements.some((s) => s.source === 'Automatic snapshot')),
    beginning, ending, deposits, statementWithdrawals, income, costs, netIncome,
    investmentChange, priceChange: investmentChange - netIncome, withdrawals,
    taxWithheld, retained: investmentChange - withdrawals - taxWithheld, incomeAfterWithdrawals: netIncome - withdrawals - taxWithheld, internalOut,
    // Only uncategorized cash rows can hide money leaving; journals already tagged
    // Transfer or Corporate Action are deliberate.
    needsReview: txns.filter((t) => t.type === 'Other' && t.amount !== 0).length,
  }
}
