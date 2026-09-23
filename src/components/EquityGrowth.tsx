import clsx from 'clsx'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown } from 'lucide-react'
import { monthLabel, posNeg, shortDate, usd } from '../lib/format'
import type { EquityGrowth as Growth } from '../lib/equity-growth'

export function EquityGrowth({ result: r, sample }: { result: Growth; sample: boolean }) {
  const available = r.value != null
  return <div className="mt-6" data-testid="equity-growth">
    <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[.14em] text-[#d8bd7a]">
      <span>Your primary progress metric</span><span className="rounded-full border border-white/10 px-2 py-1 text-faint">{sample ? 'Sample data' : !available ? 'Incomplete history' : r.estimated ? 'Estimated' : 'Recorded statements'}</span>
    </div>
    <h1 className="mt-3 text-xl font-medium tracking-tight sm:text-2xl">Net equity growth after spending</h1>
    <p className="mt-1 text-sm text-muted">Excluding W-2 deposits and other outside contributions</p>
    <div className={clsx('num mt-4 break-words text-4xl font-semibold tracking-[-.045em] sm:text-6xl', available && posNeg(r.value!))} data-testid="equity-growth-value">{available ? usd(r.value!, { sign: true }) : '—'}</div>
    {r.from && <p className="mt-3 text-xs text-muted">{shortDate(r.from)} – {shortDate(r.to)} · recorded months in the selected range</p>}
    <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">{!available ? r.reason : r.value! > .005 ? 'Equity grew beyond outside funding after recorded spending and costs.' : r.value! < -.005 ? 'Equity declined after removing outside funding, including recorded spending and costs.' : 'Equity held steady after removing outside funding and accounting for recorded spending and costs.'}</p>
    {available ? <>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {([['Ending net equity', r.ending], ['Less starting net equity', r.beginning], ['Less outside contributions', r.outsideContributions]] as const).map(([label, value]) => <div key={label} className="rounded-xl border border-white/[.07] bg-black/20 px-4 py-3"><div className="text-[11px] text-muted">{label}</div><div className="num mt-1 text-lg font-medium">{usd(value)}</div></div>)}
      </div>
      <details className="group mt-4 rounded-xl border border-[#c7a96b]/15 bg-[#c7a96b]/[.03]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm text-[#e1c887]">View equity-growth calculation<ChevronDown size={16} className="shrink-0 transition-transform group-open:rotate-180"/></summary>
        <div className="border-t border-white/[.06] p-4 text-xs leading-6 text-muted">
          <p className="num text-ink">{usd(r.ending)} − {usd(r.beginning)} − {usd(r.outsideContributions)} = {usd(r.value!, { sign: true })}</p>
          <p className="mt-2">Outside contributions = recorded deposits {usd(r.deposits)} − matched transfers between selected accounts {usd(r.internalDeposits)}.</p>
          <p className="mt-2">Net equity already subtracts margin debt. Recorded withdrawals, bills, interest, fees and tax withholding stay deducted. Includes unrealized gains and losses; unpaid taxes and spending outside these accounts are not captured.</p>
          <div className="mt-3 divide-y divide-white/[.06]">{r.months.map((m) => <div key={m.month} className="flex flex-wrap justify-between gap-x-4 py-2"><span>{monthLabel(m.month)}</span><span className={clsx('num', posNeg(m.value))}>{usd(m.value, { sign: true })}</span></div>)}</div>
          <p className="mt-3">A positive period shows progress toward independence; it does not establish a sustainable withdrawal rate or protection from a margin call.</p>
        </div>
      </details>
      {r.notes.map((note) => <p key={note} className="mt-2 text-xs leading-5 text-[#d8bd7a]">{note}</p>)}
    </> : null}
    <Link to="/history" className="mt-3 inline-flex items-center gap-1 text-xs text-[#e1c887] hover:underline">{available ? 'Review historical balances' : 'Complete historical balances'}<ArrowUpRight size={13}/></Link>
  </div>
}
