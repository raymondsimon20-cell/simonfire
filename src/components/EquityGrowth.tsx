import clsx from 'clsx'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown } from 'lucide-react'
import { monthLabel, posNeg, shortDate, usd } from '../lib/format'
import type { EquityGrowth as Growth } from '../lib/equity-growth'
import type { Transaction } from '../lib/types'
import { TransactionDrawer } from './TransactionDrawer'
import { FundingAudit } from './FundingAudit'

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
      <details className="mt-4 rounded-xl border border-white/[.07] bg-black/15 p-4">
        <summary className="cursor-pointer text-sm text-muted">Cash contribution adjustment · optional diagnostic</summary>
        <div className={clsx('num mt-2 text-lg font-medium', r.value != null ? posNeg(r.value) : 'text-[#e1c887]')} data-testid="contribution-excluded-result">{r.value != null ? usd(r.value, { sign: true }) : 'Funding needs review'}</div>
        <p className="mt-2 text-xs leading-5 text-muted">Separates outside cash funding from the result after spending. A negative figure here does not mean accumulation stopped; your contribution-inclusive equity growth is shown above.</p>
        {r.fundingNeedsReview && <p className="mt-2 text-xs text-[#e1c887]">Funding details are incomplete. This affects the secondary diagnostic, not the change in recorded net equity.</p>}
        {r.provisionalValue != null && <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer">{r.fundingNeedsReview ? 'View provisional funding calculation' : 'View contribution adjustment'}</summary><p className="num mt-2">{usd(r.totalGrowth!)} equity growth − {usd(r.outsideContributions)} {r.fundingNeedsReview ? 'unverified' : 'outside'} funding = {usd(r.provisionalValue, { sign: true })}</p><p className="mt-2">Funding = recorded deposits {usd(r.deposits)} − matched internal deposits {usd(r.internalDeposits)}.</p></details>}
      </details>
      <FundingAudit result={r} onSelect={setSelected}/>
      {r.notes.length>0&&<details className="mt-3 text-xs text-muted"><summary className="cursor-pointer">Source and matching notes</summary>{r.notes.map(note=><p key={note} className="mt-2 leading-5">{note}</p>)}</details>}
    </> : null}
    <Link to="/history" className="mt-3 inline-flex items-center gap-1 text-xs text-[#e1c887] hover:underline">{r.balancesAvailable ? 'Review historical balances' : 'Complete historical balances'}<ArrowUpRight size={13}/></Link>
    {selected && <TransactionDrawer txn={selected} onClose={() => setSelected(null)}/>}
  </div>
}
