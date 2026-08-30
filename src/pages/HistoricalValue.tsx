import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Activity, ArrowDownRight, ArrowUpRight, Landmark, TrendingUp } from 'lucide-react'
import clsx from 'clsx'
import { useScoped, useStore } from '../lib/store'
import { computeTwr, flowsByDate, seriesForScope } from '../lib/twr'
import type { TwrPoint } from '../lib/types'
import { KpiCard, PageHeader } from '../components/ui'
import { pct, posNeg, shortDate, usd } from '../lib/format'

type Range = '1M' | '3M' | 'YTD' | '1Y' | '3Y' | 'ALL'
const RANGES: Range[] = ['1M', '3M', 'YTD', '1Y', '3Y', 'ALL']

function startForRange(lastDate: string, range: Range) {
  const start = new Date(`${lastDate}T00:00:00`)
  if (range === '1M') start.setMonth(start.getMonth() - 1)
  if (range === '3M') start.setMonth(start.getMonth() - 3)
  if (range === '1Y') start.setFullYear(start.getFullYear() - 1)
  if (range === '3Y') start.setFullYear(start.getFullYear() - 3)
  if (range === 'YTD') start.setMonth(0, 1)
  return start.toISOString().slice(0, 10)
}

function compactUsd(value: number) {
  const magnitude = Math.abs(value)
  if (magnitude >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (magnitude >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

function ValueTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload as TwrPoint
  return (
    <div className="rounded-xl border border-white/10 bg-[#10151d]/95 px-3.5 py-3 text-xs shadow-2xl backdrop-blur-xl">
      <div className="text-muted">{shortDate(row.date)}</div>
      <div className="mt-2 flex min-w-40 items-center justify-between gap-5"><span className="text-muted">Portfolio value</span><span className="num font-semibold text-[#d8bd7a]">{usd(row.value)}</span></div>
      <div className="mt-1 flex items-center justify-between gap-5"><span className="text-muted">Equity value</span><span className="num font-semibold text-[#5aa2ff]">{usd(row.equity ?? row.value)}</span></div>
    </div>
  )
}

export default function HistoricalValue() {
  const { data } = useStore()
  const { scope, transactions } = useScoped()
  const [range, setRange] = useState<Range>('1Y')
  const fullSeries = useMemo(() => seriesForScope(data.twr, scope), [data.twr, scope])
  const marginDebt = useMemo(() => data.accounts.filter((account) => scope === 'all' || account.id === scope).reduce((sum, account) => sum + account.marginBalance, 0), [data.accounts, scope])
  const normalizedSeries = useMemo(() => fullSeries.map((point) => ({ ...point, equity: point.equity ?? point.value - marginDebt })), [fullSeries, marginDebt])

  const visible = useMemo(() => {
    if (!normalizedSeries.length || range === 'ALL') return normalizedSeries
    const cutoff = startForRange(normalizedSeries.at(-1)!.date, range)
    const inRange = normalizedSeries.filter((point) => point.date >= cutoff)
    const prior = [...normalizedSeries].reverse().find((point) => point.date < cutoff)
    return prior ? [prior, ...inRange] : inRange
  }, [normalizedSeries, range])

  const scopedFlows = useMemo(() => flowsByDate(transactions), [transactions])
  const performance = useMemo(() => computeTwr(visible, scopedFlows), [visible, scopedFlows])
  const stats = useMemo(() => {
    if (!visible.length) return null
    const start = visible[0]
    const end = visible.at(-1)!
    const change = end.value - start.value
    let flow = 0
    for (const [date, amount] of scopedFlows) if (date > start.date && date <= end.date) flow += amount
    let peak = visible[0].value
    let maxDrawdown = 0
    for (const point of visible) {
      peak = Math.max(peak, point.value)
      if (peak > 0) maxDrawdown = Math.min(maxDrawdown, point.value / peak - 1)
    }
    return { start, end, change, changePct: start.value ? change / start.value : 0, flow, maxDrawdown }
  }, [visible, scopedFlows])

  const months = useMemo(() => {
    const monthEnds = new Map<string, TwrPoint>()
    for (const point of visible) monthEnds.set(point.date.slice(0, 7), point)
    const rows = [...monthEnds.values()].sort((a, b) => b.date.localeCompare(a.date))
    return rows.map((point, index) => {
      const previous = rows[index + 1]
      const change = previous ? point.value - previous.value : 0
      return { ...point, change, changePct: previous?.value ? change / previous.value : 0 }
    })
  }, [visible])

  const accountName = scope === 'all' ? 'all accounts' : data.accounts.find((account) => account.id === scope)?.name ?? 'this account'

  return (
    <div>
      <PageHeader title="Historical Value" subtitle={`Portfolio value and investment performance across ${accountName}.${data.source === 'sample' ? ' Currently showing sample data.' : ''}`} />

      <div className="mb-4 flex overflow-x-auto rounded-xl border border-border bg-surface p-1 sm:w-fit">
        {RANGES.map((item) => (
          <button key={item} onClick={() => setRange(item)} className={clsx('min-w-12 rounded-lg px-3 py-2 text-xs font-medium transition-colors', range === item ? 'bg-[#c7a96b]/15 text-[#e1c887]' : 'text-muted hover:bg-surface-2 hover:text-ink')}>
            {item}
          </button>
        ))}
      </div>

      {!stats ? (
        <div className="card grid min-h-[360px] place-items-center p-8 text-center">
          <div>
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-brand"><Activity size={22} /></div>
            <h2 className="mt-4 text-lg font-semibold">No value history yet</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">Sync a connected account to build daily portfolio history. New snapshots will appear here automatically.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Portfolio value" value={usd(stats.end.value)} sub={`As of ${shortDate(stats.end.date)}`} icon={<Landmark size={20} />} tile="green" />
            <KpiCard label="Equity value" value={usd(stats.end.equity ?? stats.end.value)} sub={marginDebt ? `${usd(marginDebt)} margin debt` : 'No margin debt'} icon={<Activity size={20} />} tile="blue" />
            <KpiCard label="Value change" value={usd(stats.change, { sign: true })} sub={pct(stats.changePct * 100, { sign: true }) + ' including cash flows'} valueClass={posNeg(stats.change)} icon={stats.change >= 0 ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />} tile={stats.change >= 0 ? 'green' : 'red'} />
            <KpiCard label="Time-weighted return" value={performance.ok ? pct(performance.twrPct * 100, { sign: true }) : '—'} sub={performance.ok ? `${pct(performance.annualizedPct * 100, { sign: true })} annualized` : 'Not enough history'} valueClass={performance.ok ? posNeg(performance.twrPct) : 'text-faint'} icon={<TrendingUp size={20} />} tile="purple" info="Investment performance with contributions and withdrawals removed." />
          </div>

          <div className="card mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 text-xs text-muted"><span className="flex items-center gap-2"><span className="h-0.5 w-5 bg-[#d8bd7a]" /> Portfolio value</span><span className="flex items-center gap-2"><span className="h-0.5 w-5 bg-[#5aa2ff]" /> Equity value</span><span className="ml-auto">Net contributions <span className={clsx('num ml-1 font-medium', posNeg(stats.flow))}>{usd(stats.flow, { sign: true })}</span> · Max drawdown <span className="num ml-1 text-neg">{pct(stats.maxDrawdown * 100)}</span></span></div>

          <section className="card mt-4 overflow-hidden p-0">
            <div className="flex flex-wrap items-end justify-between gap-3 px-5 py-5 sm:px-6">
              <div><h2 className="text-lg font-semibold">Portfolio value</h2><p className="mt-1 text-xs text-muted">{shortDate(stats.start.date)} – {shortDate(stats.end.date)} · {visible.length} observations</p></div>
              <div className="text-right"><div className="text-xs text-muted">Started at</div><div className="num mt-0.5 font-semibold">{usd(stats.start.value)}</div></div>
            </div>
            <div className="h-[360px] w-full px-2 pb-4 sm:h-[430px] sm:px-5">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={visible} margin={{ top: 10, right: 8, bottom: 0, left: 4 }}>
                  <defs><linearGradient id="history-value-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c7a96b" stopOpacity={0.3} /><stop offset="1" stopColor="#c7a96b" stopOpacity={0.015} /></linearGradient></defs>
                  <CartesianGrid vertical={false} stroke="#1a202a" strokeDasharray="3 5" />
                  <XAxis dataKey="date" tick={{ fill: '#697485', fontSize: 11 }} tickFormatter={shortDate} axisLine={false} tickLine={false} minTickGap={48} />
                  <YAxis domain={['auto', 'auto']} tick={{ fill: '#697485', fontSize: 11 }} tickFormatter={compactUsd} axisLine={false} tickLine={false} width={62} />
                  <Tooltip content={<ValueTooltip />} cursor={{ stroke: '#697485', strokeDasharray: '3 3' }} />
                  <Area type="monotone" dataKey="value" stroke="#d8bd7a" strokeWidth={2.25} fill="url(#history-value-fill)" activeDot={{ r: 4, fill: '#e1c887', stroke: '#10151d', strokeWidth: 2 }} />
                  <Area type="monotone" dataKey="equity" stroke="#5aa2ff" strokeWidth={2} fill="transparent" activeDot={{ r: 4, fill: '#5aa2ff', stroke: '#10151d', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card mt-4 overflow-hidden p-0">
            <div className="px-5 py-4 sm:px-6"><h2 className="text-lg font-semibold">Month-end values</h2><p className="mt-1 text-xs text-muted">Latest observation available in each month</p></div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="border-y border-border-soft text-xs text-muted"><th className="px-5 py-2.5 text-left font-medium sm:px-6">Month</th><th className="px-4 py-2.5 text-right font-medium">Portfolio value</th><th className="px-4 py-2.5 text-right font-medium">Equity value</th><th className="px-4 py-2.5 text-right font-medium">Change</th><th className="px-5 py-2.5 text-right font-medium sm:px-6">Change %</th></tr></thead>
                <tbody>{months.map((row, index) => <tr key={row.date} className="border-b border-border-soft last:border-0"><td className="px-5 py-3 font-medium sm:px-6">{new Date(`${row.date}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</td><td className="num px-4 py-3 text-right font-semibold">{usd(row.value)}</td><td className="num px-4 py-3 text-right font-semibold text-[#7fb5ff]">{usd(row.equity ?? row.value)}</td><td className={clsx('num px-4 py-3 text-right', index === months.length - 1 ? 'text-faint' : posNeg(row.change))}>{index === months.length - 1 ? '—' : usd(row.change, { sign: true })}</td><td className={clsx('num px-5 py-3 text-right sm:px-6', index === months.length - 1 ? 'text-faint' : posNeg(row.changePct))}>{index === months.length - 1 ? '—' : pct(row.changePct * 100, { sign: true })}</td></tr>)}</tbody>
              </table>
            </div>
          </section>

          {data.twr?.note && <p className="mt-3 text-xs text-faint">{data.twr.note}</p>}
        </>
      )}
    </div>
  )
}
