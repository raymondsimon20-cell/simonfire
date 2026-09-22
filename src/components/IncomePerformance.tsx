import clsx from 'clsx'
import { incomePerformance, recordedIncomePerformance } from '../lib/income-performance'
import { monthLabel, pct, posNeg, shortDate, usd } from '../lib/format'
import type { Transaction, TwrPoint } from '../lib/types'
import type { StatementMonth } from '../lib/statement-history'

export function IncomePerformance({ points, transactions, sample = false, recorded = [], fromMonth = '', allTransactions }: { points: TwrPoint[]; transactions: Transaction[]; sample?: boolean; recorded?: StatementMonth[]; fromMonth?: string; allTransactions?: Transaction[] }) {
  const measured = recordedIncomePerformance(recorded, transactions, fromMonth, allTransactions ?? transactions)
  if (measured) return <RecordedPerformance r={measured} sample={sample}/>
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
      Net income {r.incomeAfterWithdrawals >= 0 ? 'exceeded' : 'fell short of'} withdrawals, bills and tax withheld by <span className="num font-semibold text-ink">{usd(Math.abs(r.incomeAfterWithdrawals))}</span>
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

type Recorded = NonNullable<ReturnType<typeof recordedIncomePerformance>>

function RecordedPerformance({ r, sample }: { r: Recorded; sample: boolean }) {
  const span = `${monthLabel(r.fromMonth)} – ${r.asOf ? shortDate(r.asOf.slice(0, 10)) : monthLabel(r.toMonth)}`
  const tag = r.estimated ? ' · includes this month to date' : ''
  const rows: [string, number][] = [
    ['Dividends & interest (before tax withheld)', r.income], ['Margin interest & fees', -r.costs], ['Net income', r.netIncome],
    ['Price change & other effects', r.priceChange], ['Investment gain / loss', r.investmentChange],
    ['Withdrawals & bill payments', -r.withdrawals], ['Tax withheld from dividends', -r.taxWithheld], ['Retained result', r.retained],
  ]
  return <section className="mt-5 rounded-2xl border border-white/[.07] bg-black/15 p-4 sm:p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">Income & capital performance</h2><span className="text-xs text-muted">{sample ? 'Sample data · ' : ''}{span}</span></div>
    <p className="mt-2 text-sm text-muted">{r.retained >= 0 ? 'Investment results covered withdrawals over this period.' : 'Investment results did not cover withdrawals over this period.'} From your recorded month-end balances{tag}; deposits and borrowing are not counted as gains.</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-3">
      <Metric label="Net income received" amount={r.netIncome} note="Dividends + interest − margin interest and fees" />
      <Metric label="Investment gain / loss" amount={r.investmentChange} note="Income plus price changes, after costs" />
      <Metric label="Retained result" amount={r.retained} note="Investment gain / loss − withdrawals, bills and tax withheld" />
    </div>
    <div className="mt-4 rounded-xl bg-white/[.03] p-3 text-xs leading-5 text-muted">
      Net income {r.incomeAfterWithdrawals >= 0 ? 'exceeded' : 'fell short of'} withdrawals and bills by <span className="num font-semibold text-ink">{usd(Math.abs(r.incomeAfterWithdrawals))}</span>
      {r.withdrawals + r.taxWithheld > 0 && <> ({pct(r.netIncome / (r.withdrawals + r.taxWithheld) * 100)} cash coverage)</>}.
      {r.priceChange < 0 && <> Price declines and other effects absorbed <span className="num text-neg">{usd(-r.priceChange)}</span>.</>}
    </div>
    <details className="mt-4 text-sm"><summary className="cursor-pointer text-muted">View income and capital reconciliation</summary>
      <dl className="mt-3 space-y-2">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt className="text-muted">{label}</dt><dd className={clsx('num shrink-0', posNeg(value))}>{usd(value, { sign: true })}</dd></div>)}</dl>
      <div className="mt-4 border-t border-white/[.07] pt-3 text-xs leading-6 text-muted">
        <p>Opening equity {usd(r.beginning)} + deposits {usd(r.deposits)} − withdrawals {usd(r.statementWithdrawals)} − tax withheld {usd(r.taxWithheld)} + investment gain / loss {usd(r.investmentChange, { sign: true })} = closing equity {usd(r.ending)}. Statements print dividends after tax withheld; here the tax is shown separately, as Schwab's performance view does. Deposits and withdrawals here are as printed on each statement, so transfers between your own accounts appear on both sides and cancel.</p>
        <p>Withdrawals &amp; bill payments above count money that left your accounts: Withdrawal and Bill Payment transactions, minus {usd(r.internalOut)} that arrived as a deposit in another of your accounts within a few days. Distributions may include return of capital; they are not all economic profit.</p>
      </div>
    </details>
    {r.needsReview > 0 && <p className="mt-2 text-xs text-[#f0a94a]">{r.needsReview} uncategorized record{r.needsReview === 1 ? '' : 's'} with cash. If any is money leaving to you, classify it as a Withdrawal so coverage is right.</p>}
  </section>
}
