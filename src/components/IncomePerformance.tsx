import clsx from 'clsx'
import { incomePerformance } from '../lib/income-performance'
import { pct, posNeg, shortDate, usd } from '../lib/format'
import type { Transaction, TwrPoint } from '../lib/types'

export function IncomePerformance({ points, transactions, sample = false }: { points: TwrPoint[]; transactions: Transaction[]; sample?: boolean }) {
  const result = incomePerformance(points, transactions)
  if (!result) return <section className="mt-5 rounded-2xl border border-white/[.07] p-5"><h2 className="font-semibold">Income & capital performance</h2><p className="mt-2 text-sm text-muted">Not enough value history for this period. Sync your account or select a longer date range.</p></section>
  const r = result
  const rows: [string, number][] = [
    ['Distributions received', r.dividends], ['Interest received', r.interest],
    ['Margin interest & fees', -r.costs], ['Tax withholding', -r.taxes],
    ['Net income', r.netIncome], ['Price change & other effects (estimated)', r.priceChange],
    ['Investment gain / loss (estimated)', r.investmentChange],
    ['Withdrawals & bill payments', -r.withdrawals], ['Retained result (estimated)', r.retained],
  ]
  return <section className="mt-5 rounded-2xl border border-white/[.07] bg-black/15 p-4 sm:p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">Income & capital performance</h2><span className="text-xs text-muted">{sample ? 'Sample data · ' : ''}{shortDate(r.start.date)} – {shortDate(r.end.date)}</span></div>
    <p className="mt-2 text-sm text-muted">{r.retained >= 0 ? 'Estimated investment gains covered withdrawals over this period.' : 'Estimated investment results did not cover withdrawals over this period.'} New deposits are excluded from this assessment.</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-3">
      <Metric label="Net income received" amount={r.netIncome} note="Distributions + interest − costs − withholding" />
      <Metric label="Investment gain / loss · estimated" amount={r.investmentChange} note="Income plus price changes, after costs" />
      <Metric label="Retained result · estimated" amount={r.retained} note="Investment gain / loss − withdrawals and bills" />
    </div>
    <div className="mt-4 rounded-xl bg-white/[.03] p-3 text-xs leading-5 text-muted">
      Net income {r.incomeAfterWithdrawals >= 0 ? 'exceeded' : 'fell short of'} withdrawals and bills by <span className="num font-semibold text-ink">{usd(Math.abs(r.incomeAfterWithdrawals))}</span>
      {r.withdrawals > 0 && <> ({pct(r.netIncome / r.withdrawals * 100)} cash coverage)</>}. Cash coverage alone does not establish capital preservation.
      {r.priceChange < 0 && <> Estimated price decline and other effects absorbed <span className="num text-neg">{usd(-r.priceChange)}</span>. This is an account-level estimate, not a measurement of fund NAV erosion.</>}
    </div>
    <details className="mt-4 text-sm"><summary className="cursor-pointer text-muted">View income and capital reconciliation</summary>
      <dl className="mt-3 space-y-2">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt className="text-muted">{label}</dt><dd className={clsx('num shrink-0', posNeg(value))}>{usd(value, { sign: true })}</dd></div>)}</dl>
      <div className="mt-4 border-t border-white/[.07] pt-3 text-xs leading-6 text-muted">
        <p>Beginning covered value {usd(r.start.value)} + deposits {usd(r.contributions)} − withdrawals and bills {usd(r.withdrawals)} + investment gain / loss {usd(r.investmentChange, { sign: true })} + excluded option cash {usd(r.optionCash, { sign: true })} = ending covered value {usd(r.end.value)}.</p>
        <p>Distributions may include return of capital; they are not all economic profit. Withdrawals include transfers out classified as withdrawals, so they are not necessarily living expenses. Trade costs and unclassified effects can remain in the price-change estimate.</p>
      </div>
    </details>
    <p className="mt-4 text-xs leading-5 text-faint">Cash figures use recorded transactions. Capital results are estimates from reconstructed stock/ETF and cash values; historical option valuations, accrued income, and changes in margin debt are not captured. Full-account capital preservation cannot be confirmed from this history. Compare the same dates with Schwab’s investment change.</p>
    {r.needsReview > 0 && <p className="mt-2 text-xs text-[#f0a94a]">Review {r.needsReview} transfer, corporate-action, or uncategorized record(s); their treatment may affect this estimate.</p>}
  </section>
}

function Metric({ label, amount, note }: { label: string; amount: number; note: string }) {
  return <div><div className="text-xs text-muted">{label}</div><div className={clsx('num mt-1 text-xl font-semibold', posNeg(amount))}>{usd(amount, { sign: true })}</div><div className="mt-1 text-[11px] text-faint">{note}</div></div>
}
