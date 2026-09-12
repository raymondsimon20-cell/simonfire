import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowUpRight, CheckCircle2, ChevronDown, CircleDollarSign, Database, Gauge, PiggyBank, Settings2, ShieldAlert, Sparkles, Target } from 'lucide-react'
import { bucketStats } from '../lib/buckets'
import { dividendStats, portfolioSummary } from '../lib/calc'
import { pct, relTime, usd } from '../lib/format'
import { DEFAULT_INCOME_PLAN, useScoped, useStore } from '../lib/store'
import type { IncomePlan } from '../lib/types'
import { averagePortfolioSpending } from '../lib/spending'
import clsx from 'clsx'

const localToday = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

type Action = { tone: 'danger' | 'warn' | 'good'; title: string; detail: string; to: string }

export function PlanHealth() {
  const { data, setIncomePlan } = useStore()
  const { positions, accounts, transactions, scope, lastSyncAt } = useScoped()
  const [editing, setEditing] = useState(false)
  const plan = data.incomePlan ?? DEFAULT_INCOME_PLAN

  const model = useMemo(() => {
    const summary = portfolioSummary(positions, accounts, scope, transactions)
    const dividends = dividendStats(positions, transactions, localToday())
    const observedSpending = averagePortfolioSpending(transactions, localToday())
    const buckets = bucketStats(positions, transactions)
    const afterTaxAnnual = dividends.estAnnual * (1 - plan.estimatedTaxRate / 100)
    const afterTaxMonthly = afterTaxAnnual / 12
    const stressedMonthly = afterTaxMonthly * (1 - plan.distributionCutPct / 100)
    const w2Coverage = plan.annualW2Target > 0 ? afterTaxAnnual / plan.annualW2Target : null
    const spendingCoverage = plan.monthlySpending > 0 ? afterTaxMonthly / plan.monthlySpending : null
    const cashRunway = plan.monthlySpending > 0 ? Math.max(0, summary.availableCash) / plan.monthlySpending : null
    const largest = positions.reduce((best, position) => {
      const value = Math.abs(position.shares * position.lastPrice)
      return value > best.value ? { symbol: position.symbol, value } : best
    }, { symbol: '', value: 0 })
    const concentration = summary.gross > 0 ? largest.value / summary.gross : 0
    const highRiskWeight = buckets.buckets['High Yield'].weight + buckets.buckets.Leveraged.weight
    const unassigned = transactions.filter((transaction) => transaction.type === 'Dividend' && !transaction.symbol).length
    const uncategorized = transactions.filter((transaction) => transaction.type === 'Other').length
    const missingPl = transactions.filter((transaction) => transaction.type === 'Sell' && transaction.pl == null).length
    const pendingRolls = (data.hedgeRolls ?? []).filter((roll) => !['closed', 'rolled'].includes(roll.status)).length
    const syncedDate = lastSyncAt.slice(0, 10)
    const stale = !syncedDate || syncedDate < localToday()
    const actions: Action[] = []
    if (!plan.annualW2Target || !plan.monthlySpending) actions.push({ tone: 'warn', title: 'Finish income-plan assumptions', detail: 'Enter your W-2 target and monthly spending so coverage has a meaningful goal.', to: '#plan-settings' })
    if (stale) actions.push({ tone: 'warn', title: 'Refresh portfolio data', detail: `The last portfolio sync was ${relTime(lastSyncAt)}.`, to: '/connections' })
    if (unassigned) actions.push({ tone: 'warn', title: `Assign ${unassigned} dividend payment${unassigned === 1 ? '' : 's'}`, detail: 'Missing symbols reduce the accuracy of payer-level projections.', to: '/dividends' })
    if (uncategorized) actions.push({ tone: 'warn', title: `Review ${uncategorized} uncategorized transaction${uncategorized === 1 ? '' : 's'}`, detail: 'Cash flow and return calculations depend on transaction type.', to: '/transactions' })
    if (missingPl) actions.push({ tone: 'warn', title: `Complete P/L for ${missingPl} sale${missingPl === 1 ? '' : 's'}`, detail: 'No usable purchase cost was available for these sales.', to: '/transactions' })
    if (summary.equityPct < .5) actions.push({ tone: 'danger', title: 'Margin equity is below 50%', detail: `${pct(summary.equityPct * 100)} of gross assets are owned after margin debt.`, to: '/allocation' })
    if (concentration > .15) actions.push({ tone: 'warn', title: `Review ${largest.symbol} concentration`, detail: `${pct(concentration * 100)} of gross portfolio value is in one position.`, to: '/positions' })
    if (highRiskWeight > .5) actions.push({ tone: 'warn', title: 'Review income concentration', detail: `${pct(highRiskWeight * 100)} is classified as High Yield or Leveraged.`, to: '/allocation' })
    if (pendingRolls) actions.push({ tone: 'warn', title: `Review ${pendingRolls} protective-put item${pendingRolls === 1 ? '' : 's'}`, detail: 'Confirm current order status and the next required roll step.', to: '/allocation' })
    if (!actions.length) actions.push({ tone: 'good', title: 'No immediate data issues', detail: 'Your plan inputs and portfolio records pass the current checks.', to: '/month-close' })
    const priority = { danger: 0, warn: 1, good: 2 }
    actions.sort((a, b) => priority[a.tone] - priority[b.tone])
    return { summary, dividends, observedSpending, afterTaxMonthly, stressedMonthly, w2Coverage, spendingCoverage, cashRunway, unassigned, uncategorized, missingPl, actions: actions.slice(0, 5) }
  }, [accounts, data.hedgeRolls, lastSyncAt, plan, positions, scope, transactions])

  const configured = plan.annualW2Target > 0 && plan.monthlySpending > 0
  const headline = !configured
    ? 'Add two targets to turn portfolio income into a measurable replacement plan.'
    : model.spendingCoverage != null && model.spendingCoverage >= 1
      ? `Estimated after-tax dividends cover ${pct(model.spendingCoverage * 100)} of monthly spending.`
      : `Estimated after-tax dividends cover ${pct((model.spendingCoverage ?? 0) * 100)} of monthly spending; the remaining gap is ${usd(Math.max(0, plan.monthlySpending - model.afterTaxMonthly))} per month.`

  return <section className="mb-6 overflow-hidden rounded-[24px] border border-[#c7a96b]/20 bg-[linear-gradient(135deg,#171a20_0%,#10151d_65%,#1d180d_100%)] shadow-[0_24px_80px_rgba(0,0,0,.22)]">
    <div className="p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.18em] text-[#d8bd7a]"><Target size={13}/> Today · Plan health</div><h1 className="mt-3 max-w-3xl text-2xl font-semibold tracking-[-.035em] sm:text-3xl">{headline}</h1><p className="mt-2 text-xs text-faint">Portfolio data synced {relTime(lastSyncAt)} · projections are estimates, not guaranteed income.</p></div>
        <button id="plan-settings" onClick={() => setEditing((value) => !value)} className="flex items-center gap-2 rounded-xl border border-[#c7a96b]/25 bg-[#c7a96b]/5 px-3.5 py-2 text-sm text-[#e1c887] hover:bg-[#c7a96b]/10"><Settings2 size={15}/> Plan assumptions <ChevronDown size={14} className={clsx('transition-transform', editing && 'rotate-180')}/></button>
      </div>
      <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-2xl border border-white/[.07] bg-black/15 sm:grid-cols-4">
        <SnapshotMetric label="Net portfolio equity" value={usd(model.summary.net)} source="Schwab reported"/>
        <SnapshotMetric label="Gross portfolio value" value={usd(model.summary.gross)} source="Schwab reported"/>
        <SnapshotMetric label="Today’s change" value={usd(model.summary.dayChange, { sign: true })} source="Calculated" valueClass={model.summary.dayChange >= 0 ? 'text-pos' : 'text-neg'}/>
        <SnapshotMetric label="Margin used" value={usd(model.summary.marginUsed)} source="Schwab reported" valueClass={model.summary.marginUsed > 0 ? 'text-[#f0a94a]' : undefined}/>
      </div>
      {editing && <PlanInputs plan={plan} observedSpending={model.observedSpending} onChange={setIncomePlan}/>}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <HealthMetric icon={<CircleDollarSign size={17}/>} label="After-tax dividends" value={`${usd(model.afterTaxMonthly)}/mo`} source="Estimated" note={`Uses ${pct(plan.estimatedTaxRate)} tax assumption`} tone="green"/>
        <HealthMetric icon={<Target size={17}/>} label="W-2 income replaced" value={model.w2Coverage == null ? 'Set target' : pct(model.w2Coverage * 100)} source="Calculated" note={plan.annualW2Target ? `${usd(plan.annualW2Target)}/yr target` : 'Annual target needed'} tone="blue"/>
        <HealthMetric icon={<Gauge size={17}/>} label="Spending covered" value={model.spendingCoverage == null ? 'Set spending' : pct(model.spendingCoverage * 100)} source="Calculated" note={plan.monthlySpending ? `${usd(plan.monthlySpending)}/mo plan` : 'Monthly spending needed'} tone="purple"/>
        <HealthMetric icon={<PiggyBank size={17}/>} label="Cash runway" value={model.cashRunway == null ? 'Set spending' : `${model.cashRunway.toFixed(1)} mo`} source="Schwab + calculated" note={`${usd(model.summary.availableCash)} available cash`} tone="orange"/>
        <HealthMetric icon={<ShieldAlert size={17}/>} label={`${pct(plan.distributionCutPct)} cut scenario`} value={`${usd(model.stressedMonthly)}/mo`} source="Stress test" note="After estimated tax and distribution cut" tone="red"/>
      </div>
    </div>
    <div className="grid border-t border-white/[.06] lg:grid-cols-[1.15fr_.85fr]">
      <div className="p-5 sm:p-7 lg:border-r lg:border-white/[.06]"><div className="flex items-center justify-between"><h2 className="font-semibold">What needs attention</h2><span className="text-xs text-faint">Highest priority first</span></div><div className="mt-3 space-y-2">{model.actions.map((action) => <Link key={action.title} to={action.to} onClick={() => action.to.startsWith('#') && setEditing(true)} className="group flex items-start gap-3 rounded-xl border border-white/[.06] bg-black/10 p-3 hover:bg-white/[.035]">{action.tone === 'good' ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-pos"/> : <AlertTriangle size={17} className={clsx('mt-0.5 shrink-0', action.tone === 'danger' ? 'text-neg' : 'text-[#e1c887]')}/>}<span className="min-w-0 flex-1"><span className="block text-sm font-medium">{action.title}</span><span className="mt-0.5 block text-xs text-faint">{action.detail}</span></span><ArrowUpRight size={14} className="mt-0.5 shrink-0 text-faint group-hover:text-brand"/></Link>)}</div></div>
      <div className="p-5 sm:p-7"><div className="flex items-center gap-2"><Database size={16} className="text-[#5aa2ff]"/><h2 className="font-semibold">Can I trust this view?</h2></div><div className="mt-4 space-y-3 text-xs"><TrustRow label="Portfolio value and cash" value={data.source === 'live' ? 'Schwab reported' : data.source === 'imported' ? 'CSV imported' : 'Sample data'} good={data.source === 'live'}/><TrustRow label="Annual dividend run rate" value={`${pct(model.dividends.forwardCoverage * 100)} Schwab coverage`} good={model.dividends.forwardCoverage >= .8}/><TrustRow label="Unassigned dividends" value={String(model.unassigned)} good={!model.unassigned}/><TrustRow label="Uncategorized transactions" value={String(model.uncategorized)} good={!model.uncategorized}/><TrustRow label="Sales missing cost basis" value={String(model.missingPl)} good={!model.missingPl}/></div><div className="mt-5 rounded-xl border border-white/[.06] bg-black/10 p-3 text-xs leading-5 text-faint">Reported values come directly from the connected source. Calculated values combine reported records. Estimated values depend on the assumptions above and may differ from taxes or future distributions.</div></div>
    </div>
  </section>
}

function PlanInputs({ plan, observedSpending, onChange }: { plan: IncomePlan; observedSpending: ReturnType<typeof averagePortfolioSpending>; onChange: (plan: IncomePlan) => void }) {
  const set = (field: keyof IncomePlan, value: number, max = Number.POSITIVE_INFINITY) => onChange({ ...plan, [field]: Math.min(max, Math.max(0, value || 0)) })
  return <div className="mt-5 rounded-2xl border border-white/[.07] bg-black/15 p-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><PlanField label="Annual W-2 target" prefix="$" value={plan.annualW2Target} onChange={(value) => set('annualW2Target', value, 10_000_000)}/><PlanField label="Monthly spending" prefix="$" value={plan.monthlySpending} onChange={(value) => set('monthlySpending', value, 1_000_000)}/><PlanField label="Estimated tax rate" suffix="%" value={plan.estimatedTaxRate} max={60} onChange={(value) => set('estimatedTaxRate', value, 60)}/><PlanField label="Distribution-cut test" suffix="%" value={plan.distributionCutPct} max={100} onChange={(value) => set('distributionCutPct', value, 100)}/><PlanField label="Cash reserve goal" suffix="months" value={plan.cashReserveMonths} max={60} onChange={(value) => set('cashReserveMonths', value, 60)}/></div>
    {observedSpending && <div className="mt-4 rounded-xl border border-[#5aa2ff]/15 bg-[#5aa2ff]/5 p-4"><div className="flex flex-wrap items-center gap-3"><Sparkles size={16} className="text-[#6aa9ff]"/><div className="min-w-0 flex-1"><div className="text-xs font-medium">Observed portfolio-funded spending: <span className="num text-ink">{usd(observedSpending.monthlyAverage)}/month</span></div><div className="mt-0.5 text-[10px] text-faint">Calculated from {observedSpending.transactionCount} included outflows across {observedSpending.months} complete month{observedSpending.months === 1 ? '' : 's'} ({observedSpending.from}–{observedSpending.to}).</div></div><button onClick={() => set('monthlySpending', observedSpending.monthlyAverage, 1_000_000)} disabled={observedSpending.monthlyAverage <= 0} className="rounded-lg border border-[#5aa2ff]/25 px-3 py-1.5 text-xs font-medium text-[#7fb5ff] enabled:hover:bg-[#5aa2ff]/10 disabled:opacity-40">Use average</button></div><SpendingBreakdown spending={observedSpending}/></div>}
  </div>
}

function SpendingBreakdown({ spending }: { spending: NonNullable<ReturnType<typeof averagePortfolioSpending>> }) {
  const rows = [
    { label: 'Bills & withdrawals', value: spending.livingSpending / spending.months, color: '#5aa2ff', included: true },
    { label: 'Margin interest', value: spending.marginInterest / spending.months, color: '#f0a94a', included: true },
    { label: 'Portfolio fees', value: spending.fees / spending.months, color: '#b18aff', included: true },
    { label: 'Tax withholding', value: spending.taxWithholding / spending.months, color: '#f2607a', included: false },
  ]
  const max = Math.max(...rows.map((row) => row.value), 1)
  return <div className="mt-4 border-t border-[#5aa2ff]/10 pt-3"><div className="mb-2 flex items-center justify-between gap-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Average monthly outflow breakdown</span><span className="text-[10px] text-faint">Tax shown separately</span></div><div className="space-y-2">{rows.map((row) => <div key={row.label} className="grid grid-cols-[7.5rem_1fr_5.5rem] items-center gap-2 text-[10px]"><span className="truncate text-muted">{row.label}</span><span className="h-2 overflow-hidden rounded-full bg-white/[.05]"><span className="block h-full rounded-full" style={{ width: `${row.value / max * 100}%`, backgroundColor: row.color }}/></span><span className={clsx('num text-right', row.included ? 'text-ink' : 'text-faint')}>{usd(row.value)}/mo</span></div>)}</div><p className="mt-3 text-[10px] text-faint">The suggested spending target includes bills, withdrawals, margin interest, and fees. Tax withholding is visible here but excluded to avoid mixing estimated income tax with recurring spending. Investments and transfers are excluded.</p></div>
}

function PlanField({ label, value, onChange, prefix, suffix, max }: { label: string; value: number; onChange: (value: number) => void; prefix?: string; suffix?: string; max?: number }) {
  return <label className="text-xs text-muted"><span>{label}</span><span className="mt-1 flex items-center rounded-xl border border-border bg-surface-2 px-3 focus-within:border-brand">{prefix && <span className="text-faint">{prefix}</span>}<input type="number" min="0" max={max} value={value || ''} placeholder="0" onChange={(event) => onChange(Number(event.target.value))} className="num min-w-0 flex-1 bg-transparent px-1 py-2.5 text-sm text-ink outline-none"/>{suffix && <span className="text-faint">{suffix}</span>}</span></label>
}

function HealthMetric({ icon, label, value, source, note, tone }: { icon: ReactNode; label: string; value: string; source: string; note: string; tone: 'green'|'blue'|'purple'|'orange'|'red' }) {
  const colors = { green: 'text-pos bg-pos/10', blue: 'text-[#6aa9ff] bg-[#5aa2ff]/10', purple: 'text-[#b18aff] bg-[#b18aff]/10', orange: 'text-[#f0a94a] bg-[#f0a94a]/10', red: 'text-neg bg-neg/10' }
  return <div className="rounded-2xl border border-white/[.06] bg-black/15 p-4"><div className="flex items-center justify-between gap-2"><span className={clsx('grid h-8 w-8 place-items-center rounded-lg', colors[tone])}>{icon}</span><span className="rounded-full border border-white/[.07] px-2 py-0.5 text-[9px] uppercase tracking-wider text-faint">{source}</span></div><div className="mt-4 text-xs text-muted">{label}</div><div className="num mt-1 text-xl font-semibold">{value}</div><div className="mt-1 text-[10px] text-faint">{note}</div></div>
}

function SnapshotMetric({ label, value, source, valueClass }: { label: string; value: string; source: string; valueClass?: string }) {
  return <div className="border-b border-r border-white/[.06] p-3.5 last:border-r-0 sm:border-b-0"><div className="text-[10px] text-faint">{label}</div><div className={clsx('num mt-1 text-lg font-semibold', valueClass)}>{value}</div><div className="mt-0.5 text-[9px] uppercase tracking-wider text-faint">{source}</div></div>
}

function TrustRow({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-muted">{label}</span><span className={clsx('font-medium', good ? 'text-pos' : 'text-[#e1c887]')}>{value}</span></div>
}
