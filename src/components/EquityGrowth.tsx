import clsx from 'clsx'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown } from 'lucide-react'
import { monthLabel, posNeg, shortDate, usd } from '../lib/format'
import type { EquityGrowth as Growth } from '../lib/equity-growth'
import type { Transaction } from '../lib/types'
import { TransactionDrawer } from './TransactionDrawer'

export function EquityGrowth({ result: r, sample }: { result: Growth; sample: boolean }) {
  const available = r.totalGrowth != null
  const [selected, setSelected] = useState<Transaction | null>(null)
  return <div className="mt-6" data-testid="equity-growth">
    <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[.14em] text-[#d8bd7a]">
      <span>Accumulation progress</span><span className="rounded-full border border-white/10 px-2 py-1 text-faint">{sample ? 'Sample data' : !available ? 'Incomplete history' : r.balanceEstimated ? 'Includes saved balances' : 'Recorded statements'}</span>
    </div>
    <h1 className="mt-3 text-xl font-medium tracking-tight sm:text-2xl">Net equity growth after spending</h1>
    <p className="mt-1 text-sm text-muted">Includes W-2 contributions and portfolio results · margin debt already deducted</p>
    <div className={clsx('num mt-4 break-words text-4xl font-semibold tracking-[-.045em] sm:text-6xl', available && posNeg(r.totalGrowth!))} data-testid="equity-growth-value">{available ? usd(r.totalGrowth!, { sign: true }) : '—'}</div>
    {r.from && <p className="mt-3 text-xs text-muted">{shortDate(r.from)} – {shortDate(r.to)} · recorded months in the selected range</p>}
    <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">{!available ? r.reason : r.totalGrowth! > .005 ? 'Your net equity grew after recorded spending and costs, with new contributions included.' : r.totalGrowth! < -.005 ? 'Your net equity declined after recorded spending and costs, even with new contributions included.' : 'Your net equity held steady after recorded spending and costs, with new contributions included.'}</p>
    {r.balancesAvailable ? <>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {([['Ending net equity', r.ending], ['Less starting net equity', r.beginning]] as const).map(([label, value]) => <div key={label} className="rounded-xl border border-white/[.07] bg-black/20 px-4 py-3"><div className="text-[11px] text-muted">{label}</div><div className="num mt-1 text-lg font-medium">{usd(value)}</div></div>)}
      </div>
      <details className="group mt-4 rounded-xl border border-[#c7a96b]/15 bg-[#c7a96b]/[.03]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm text-[#e1c887]">View equity-growth calculation<ChevronDown size={16} className="shrink-0 transition-transform group-open:rotate-180"/></summary>
        <div className="border-t border-white/[.06] p-4 text-xs leading-6 text-muted">
          <p className="num text-ink">{usd(r.ending)} − {usd(r.beginning)} = {usd(r.totalGrowth!, { sign: true })}</p>
          <p className="mt-2">Net equity = account assets minus margin debt. W-2 deposits increase equity. Investing borrowed money adds assets and debt together; paying bills with margin increases debt without adding assets, reducing equity. Recorded margin interest, fees and tax withholding also stay deducted.</p>
          <p className="mt-2">This measures accumulation after recorded spending, including contributions and realized and unrealized portfolio results. Unpaid taxes and spending outside these accounts are not captured. It does not isolate investment performance or the benefit of using margin.</p>
          <div className="mt-3 divide-y divide-white/[.06]">{r.months.map((m) => <div key={m.month} className="flex flex-wrap justify-between gap-x-4 py-2"><span>{monthLabel(m.month)}</span><span className={clsx('num', posNeg(m.totalGrowth))}>{usd(m.totalGrowth, { sign: true })}</span></div>)}</div>
        </div>
      </details>
      <div className="mt-4 rounded-xl border border-white/[.07] bg-black/15 p-4">
        <div className="text-xs text-muted">Secondary diagnostic · result excluding contributions</div>
        <div className={clsx('num mt-2 text-lg font-medium', r.value != null ? posNeg(r.value) : 'text-[#e1c887]')} data-testid="contribution-excluded-result">{r.value != null ? usd(r.value, { sign: true }) : 'Funding needs review'}</div>
        <p className="mt-2 text-xs leading-5 text-muted">Separates outside funding from the result after spending. A negative figure here does not mean accumulation stopped; your contribution-inclusive equity growth is shown above.</p>
        {r.fundingNeedsReview && <p className="mt-2 text-xs text-[#e1c887]">Funding details are incomplete. This affects the secondary diagnostic, not the change in recorded net equity.</p>}
        {r.provisionalValue != null && <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer">{r.fundingNeedsReview ? 'View provisional funding calculation' : 'View contribution adjustment'}</summary><p className="num mt-2">{usd(r.totalGrowth!)} equity growth − {usd(r.outsideContributions)} {r.fundingNeedsReview ? 'unverified' : 'outside'} funding = {usd(r.provisionalValue, { sign: true })}</p><p className="mt-2">Funding = recorded deposits {usd(r.deposits)} − matched internal deposits {usd(r.internalDeposits)}.</p></details>}
      </div>
      <details className="mt-3 rounded-xl border border-white/[.07] p-4">
        <summary className="cursor-pointer text-sm text-[#e1c887]">Review funding by account and month{r.fundingNeedsReview ? ` · ${r.funding.filter((f) => f.issues.length).length} need review` : ''}</summary>
        <p className="mt-3 text-xs leading-5 text-muted">Compare recorded totals with transaction details. Import missing statement transactions or open a record below to correct its classification. Matched transfers are counted once across the selected accounts.</p>
        <div className="mt-3 space-y-2">{[...r.funding].sort((a, b) => Number(b.issues.length > 0) - Number(a.issues.length > 0)).map((f) => <details key={`${f.accountId}-${f.month}`} className="rounded-lg border border-white/[.07] p-3">
          <summary className="cursor-pointer text-xs">{f.account} · {monthLabel(f.month)} <span className={f.issues.length ? 'text-[#e1c887]' : 'text-muted'}>· {f.issues.length ? 'Needs review' : 'Totals reconciled'}</span></summary>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">{([['Recorded deposits', f.deposits], ['Deposit transaction total', f.ledgerDeposits], ['Recorded withdrawals', f.withdrawals], ['Withdrawal transaction total', f.ledgerWithdrawals], ['Internal deposits excluded', f.internalDeposits]] as const).map(([label, amount]) => <div key={label} className="flex flex-wrap justify-between gap-2"><dt className="text-muted">{label}</dt><dd className="num">{usd(amount)}</dd></div>)}</dl>
          {f.issues.map((issue) => <p key={issue} className="mt-2 text-xs text-[#e1c887]">{issue}</p>)}
          <div className="mt-3 max-h-64 overflow-y-auto">{f.transactions.length ? f.transactions.map((t) => <button key={t.id} onClick={() => setSelected(t)} className="flex w-full flex-wrap justify-between gap-2 border-t border-white/[.06] py-2 text-left text-xs hover:text-[#e1c887]"><span className="min-w-0 flex-1"><span className="block">{shortDate(t.date)} · {t.type}</span><span className="block break-words text-faint">{t.description}</span></span><span className="num">{usd(t.amount, { sign: true })}</span></button>) : <p className="text-xs text-muted">No funding transaction details for this account and month.</p>}</div>
        </details>)}</div>
        {r.transferMatches.length > 0 && <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted">Matched internal transfers · {r.transferMatches.length} pairs</summary>{r.transferMatches.map((pair) => <div key={pair.incoming.id} className="mt-2 rounded-lg border border-white/[.07] p-3">{[pair.outgoing, pair.incoming].map((t) => <button key={t.id} onClick={() => setSelected(t)} className="flex w-full flex-wrap justify-between gap-2 py-1 text-left hover:text-[#e1c887]"><span>{shortDate(t.date)} · {r.funding.find((f) => f.accountId === t.accountId)?.account ?? t.accountId}</span><span className="num">{usd(t.amount, { sign: true })}</span></button>)}</div>)}</details>}
      </details>
      {r.notes.map((note) => <p key={note} className="mt-2 text-xs leading-5 text-[#d8bd7a]">{note}</p>)}
    </> : null}
    <Link to="/history" className="mt-3 inline-flex items-center gap-1 text-xs text-[#e1c887] hover:underline">{r.balancesAvailable ? 'Review historical balances' : 'Complete historical balances'}<ArrowUpRight size={13}/></Link>
    {selected && <TransactionDrawer txn={selected} onClose={() => setSelected(null)}/>}
  </div>
}
