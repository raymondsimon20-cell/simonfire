import { useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { pct, shortDate, usd } from '../lib/format'
import type { SurvivalReport, StrategyResult } from '../lib/margin-survival'

type Props = { report: SurvivalReport }

const money = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? 'Unverified' : usd(value, { cents: false })
const tone = (value: number | null | undefined) => value != null && value < 0 ? 'text-neg' : 'text-ink'
const policyTone = {
  NORMAL: 'border-pos/25 bg-pos/10 text-pos',
  CAUTION: 'border-brand/25 bg-brand/10 text-brand',
  DEFENSIVE: 'border-brand/25 bg-brand/10 text-brand',
  CRITICAL: 'border-neg/25 bg-neg/10 text-neg',
  EMERGENCY: 'border-neg/25 bg-neg/10 text-neg',
}
const series = [
  { key: 'equity', label: 'Net equity', color: '#34d17d' },
  { key: 'debt', label: 'Margin debt', color: '#f2607a' },
  { key: 'maintenance', label: 'Maintenance requirement', color: '#c7a96b' },
  { key: 'maintenanceExcess', label: 'Maintenance excess', color: '#60a5fa' },
  { key: 'hedgeValue', label: 'Hedge value', color: '#b794f4' },
] as const

function Metric({ label, value, detail, className = '' }: { label: string; value: string; detail?: string; className?: string }) {
  return <div className="min-w-0 rounded-xl border border-border-soft bg-surface-2/35 p-3">
    <div className="text-xs text-muted">{label}</div>
    <div className={`num mt-1 break-words text-lg font-semibold ${className}`}>{value}</div>
    {detail && <div className="mt-1 text-[11px] text-faint">{detail}</div>}
  </div>
}

function StrategyNotes({ strategy }: { strategy: StrategyResult }) {
  return <div className="space-y-2 rounded-xl border border-border-soft p-3">
    <h4 className="text-sm font-semibold">{strategy.label}</h4>
    <p className="text-xs text-muted">{strategy.qualifies ? 'Meets modeled constraints; not an executable order.' : 'Does not meet modeled constraints.'}</p>
    {strategy.failures.length > 0 && <ul className="list-disc space-y-1 pl-4 text-xs text-neg">{[...new Set(strategy.failures)].map((failure) => <li key={failure}>{failure}</li>)}</ul>}
    <div className="overflow-x-auto"><table className="w-full text-left text-xs">
      <caption className="sr-only">Scenario survival and estimated deleveraging for {strategy.label}</caption>
      <thead className="text-faint"><tr><th className="p-2">Scenario</th><th className="p-2">Maintenance outcome</th><th className="p-2">Min. excess</th><th className="p-2">Max. deficiency</th><th className="p-2">First deficiency</th><th className="p-2">Deleveraging</th></tr></thead>
      <tbody>{strategy.scenarios.map((scenario) => <tr key={scenario.id} className="border-t border-border-soft">
        <th className="p-2 font-normal">{scenario.label}</th>
        <td className={`p-2 ${scenario.minExcess == null ? 'text-muted' : scenario.survives ? 'text-pos' : 'text-neg'}`}>{scenario.minExcess == null ? 'Unverified' : scenario.survives ? 'No modeled deficiency' : 'Deficiency'}</td>
        <td className={`num p-2 ${tone(scenario.minExcess)}`}>{money(scenario.minExcess)}</td>
        <td className="num p-2">{scenario.minExcess == null ? 'Unverified' : money(scenario.maxDeficiency)}</td>
        <td className="p-2">{scenario.firstDeficiency ? shortDate(scenario.firstDeficiency) : scenario.minExcess == null ? 'Unverified' : 'None modeled'}</td>
        <td className="num p-2">{money(scenario.deleveraging)}</td>
      </tr>)}</tbody>
    </table></div>
  </div>
}

export function MarginSurvivalDashboard({ report }: Props) {
  const [strategyId, setStrategyId] = useState('')
  const [scenarioId, setScenarioId] = useState('')
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const [hiddenSeries, setHiddenSeries] = useState<string[]>([])
  const hold = report.strategies.find((strategy) => strategy.id === 'hold')
    ?? report.strategies.find((strategy) => /hold/i.test(strategy.label))
  const selected = report.strategies.find((strategy) => strategy.id === strategyId) ?? hold ?? report.strategies[0]
  const scenario = selected?.scenarios.find((item) => item.id === scenarioId) ?? selected?.scenarios[0]
  const alerts = report.alerts.filter((alert, index, all) => all.findIndex((item) => item.message.trim().toLowerCase() === alert.message.trim().toLowerCase()) === index)
  const missing = [...new Set(report.missing)]
  const recommended = report.recommended?.qualifies ? report.recommended : null
  const selectStrategy = (id: string) => { setStrategyId(id) }

  return <section className="card space-y-4 p-4 sm:p-5" aria-label="Margin survival dashboard">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-semibold">Margin survival</h3><p className="mt-1 text-xs text-muted">Current balances and hypothetical risk estimates</p></div>
      <span className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${policyTone[report.policy]}`}>{report.policy}</span>
    </div>
    <p className="text-xs text-faint">User-defined operating policy, not a Schwab margin-call threshold. Broker maintenance excess is separate from equity percentage, buying power, SMA, and withdrawable funds.</p>

    <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
      <Metric label="Current margin debt" value={money(report.currentDebt)} />
      <Metric label="Current equity" value={Number.isFinite(report.currentEquityPct) ? pct(report.currentEquityPct) : 'Unverified'} />
      <Metric label="Broker maintenance excess" value={money(report.brokerMaintenanceExcess)} detail="Broker-reported snapshot" className={tone(report.brokerMaintenanceExcess)} />
      <Metric label="Minimum modeled excess" value={money(hold?.minExcess)} detail="Hold · worst point across scenarios" className={tone(hold?.minExcess)} />
      <Metric label="Worst modeled shortfall" value={hold?.minExcess == null ? 'Unverified' : money(hold.maxDeficiency)} detail="Hold · full simulation horizon" className={hold && hold.maxDeficiency > 0 ? 'text-neg' : ''} />
    </div>
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
      <span>Hedge value <span className="num text-ink">{money(report.hedgeValue)}</span></span>
      <span>Expiration <span className="num text-ink">{report.daysToExpiration == null ? 'Unverified' : `${report.daysToExpiration} days`}</span></span>
      <span>Put notional / holdings <span className="num text-ink">{Number.isFinite(report.coverage) ? pct(report.coverage * 100) : 'Unverified'}</span></span>
      <span>Interest / day <span className="num text-ink">{money(report.dailyInterest)}</span></span>
      <span>Projected / month <span className="num text-ink">{money(report.monthlyInterest)}</span></span>
      <span>First modeled deficiency · hold <span className="text-ink">{hold?.firstDeficiency ? shortDate(hold.firstDeficiency) : hold?.minExcess == null ? 'Unverified' : 'None modeled'}</span></span>
    </div>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border-soft px-3 py-2 text-xs">
      <span className="text-muted">Cash required for equity target</span>
      {[50, 55, 60].map((target) => <span key={target}>{target}% <span className="num ml-1 font-semibold">{money(report.cashTargets.find((item) => item.target === target)?.cash)}</span></span>)}
    </div>

    <div className={`rounded-xl border p-3 text-xs ${recommended ? 'border-brand/25 bg-brand/5' : 'border-neg/25 bg-neg/5'}`}>
      <p className={`font-semibold ${recommended ? 'text-brand' : 'text-neg'}`}>{recommended ? `Modeled candidate: ${recommended.label}` : 'NO QUALIFYING HEDGE — RISK REDUCTION REQUIRED'}</p>
      <p className="mt-1 text-muted">{report.explanation}</p>
      {missing.length > 0 && <p className="mt-2 text-brand">Unverified inputs: {missing.slice(0, 3).join('; ')}{missing.length > 3 ? `; +${missing.length - 3} more in details` : ''}. Estimates are not trade authorization.</p>}
    </div>
    {alerts.length > 0 && <ul aria-label="Current margin alerts" className="space-y-1.5 text-xs">
      {alerts.map((alert, index) => <li key={`${alert.id}-${index}`} className={`rounded-lg border px-3 py-2 ${alert.severity === 'danger' ? 'border-neg/20 bg-neg/5 text-neg' : alert.severity === 'warning' ? 'border-brand/20 bg-brand/5 text-brand' : 'border-border-soft text-muted'}`}>
        <span className="font-semibold">{alert.severity === 'danger' ? 'Danger' : alert.severity === 'warning' ? 'Warning' : 'Info'}: </span>{alert.message}
      </li>)}
    </ul>}

    <details className="border-t border-border-soft pt-3" onToggle={(event) => setComparisonOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-semibold">Explore scenarios & compare strategies</summary>
      {comparisonOpen && <div className="mt-4 space-y-4">
        {selected ? <>
          <div className="flex flex-wrap gap-3">
            <label className="min-w-48 flex-1 text-xs text-muted">Strategy<select className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-ink" value={selected.id} onChange={(event) => selectStrategy(event.target.value)}>{report.strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.label}</option>)}</select></label>
            <label className="min-w-48 flex-1 text-xs text-muted">Hypothetical scenario<select className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-ink" value={scenario?.id ?? ''} disabled={!selected.scenarios.length} onChange={(event) => setScenarioId(event.target.value)}>{selected.scenarios.length ? selected.scenarios.map((item) => <option key={item.id} value={item.id}>{item.label}</option>) : <option value="">No scenarios available</option>}</select></label>
          </div>
          <p className="text-xs text-muted">{selected.label} · {scenario?.label ?? 'No scenario'} · hypothetical model, not historical performance or live broker balances. Click a chart legend item to toggle a series.</p>
          {scenario && <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>Min. excess <span className={`num ${tone(scenario.minExcess)}`}>{money(scenario.minExcess)}</span></span>
            <span>Max. deficiency <span className="num text-ink">{scenario.minExcess == null ? 'Unverified' : money(scenario.maxDeficiency)}</span></span>
            <span>First deficiency <span className="text-ink">{scenario.firstDeficiency ? shortDate(scenario.firstDeficiency) : scenario.minExcess == null ? 'Unverified' : 'None modeled'}</span></span>
            <span>Estimated deleveraging <span className="num text-ink">{money(scenario.deleveraging)}</span></span>
          </div>}
          {scenario?.points.length ? <div className="h-72 min-w-0" role="img" aria-label={`Modeled dollar values over time for ${selected.label}, ${scenario.label}`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={scenario.points} margin={{ top: 8, right: 12, bottom: 8, left: 8 }} accessibilityLayer>
                <CartesianGrid stroke="#252c37" strokeDasharray="3 3" />
                <XAxis dataKey="day" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(day: number) => `Day ${day}`} tick={{ fill: '#929cab', fontSize: 10 }} />
                <YAxis width={70} tickFormatter={(value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value)} tick={{ fill: '#929cab', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: '#141a24', border: '1px solid #252c37', borderRadius: 10, fontSize: 12 }} labelFormatter={(day) => { const point = scenario.points.find((item) => item.day === Number(day)); return `Day ${day}${point ? ` · ${shortDate(point.date)}${point.phase ? ` · ${point.phase}` : ''}` : ''}` }} formatter={(value) => money(typeof value === 'number' ? value : null)} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} onClick={(entry) => { const key = String(entry.dataKey); setHiddenSeries((previous) => previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key]) }} />
                <ReferenceLine y={0} stroke="#929cab" strokeDasharray="4 4" />
                {series.map((item) => <Line key={item.key} dataKey={item.key} name={item.label} stroke={item.color} hide={hiddenSeries.includes(item.key)} type="linear" dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div> : <p className="rounded-lg border border-border-soft p-4 text-xs text-muted">No modeled checkpoints available for this selection.</p>}
        </> : <p className="text-xs text-muted">No modeled strategies available.</p>}

        {scenario&&<details className="rounded-xl border border-border-soft p-3"><summary className="cursor-pointer text-xs font-semibold">Daily checkpoint ledger</summary><p className="mt-2 text-xs text-muted">All forward values are modeled. Liquidity and broker margin equity remain unverified away from an explicitly reported live checkpoint. Put notional coverage is not a guaranteed loss offset. Asset-sale estimates exclude taxes, sale fees, slippage and changing house rules.</p><div className="mt-2 max-h-80 overflow-auto"><table className="w-full whitespace-nowrap text-left text-xs"><thead><tr>{['Day / phase','Gross assets','Net liquidation','Margin debit','Broker margin equity','Equity %','Maintenance','Excess','Withdrawable liquidity','Hedge value','Intrinsic','Time value','Interest accrued','Notional / holdings','Asset sale to cure'].map(label=><th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{scenario.points.map((p,i)=><tr className="border-t border-border-soft" key={`${p.day}-${i}`}><td className="p-2">{p.day} · {shortDate(p.date)} {p.phase??''}</td>{[p.gross,p.equity,p.debt,p.brokerEquity].map((n,j)=><td className="num p-2" key={j}>{money(n)}</td>)}<td className="p-2">{pct(p.equityPct)}</td>{[p.maintenance,p.maintenanceExcess,p.liquidity,p.hedgeValue,p.intrinsic,p.timeValue,p.interest].map((n,j)=><td className="num p-2" key={j}>{money(n)}</td>)}<td className="p-2">{pct(p.coverage*100)}</td><td className="num p-2">{money(p.forcedLiquidation)}</td></tr>)}</tbody></table></div></details>}
        <div className="overflow-x-auto rounded-xl border border-border-soft">
          <table className="w-full whitespace-nowrap text-left text-xs">
            <caption className="p-3 text-left text-xs text-muted">Hypothetical strategy comparison · full-horizon risk across all scenarios. Select a row to explore.</caption>
            <thead className="text-faint"><tr>{['Strategy', 'Net debit (+) / credit (−)', 'Post debt', 'Post equity', 'Immediate excess', 'Min. excess', 'Max. deficiency', 'First deficiency', 'Hedge cost', 'Financing', 'Coverage days', 'Deleveraging', 'Constraints'].map((label) => <th key={label} scope="col" className="p-3 font-medium">{label}</th>)}</tr></thead>
            <tbody>{report.strategies.map((strategy) => <tr key={strategy.id} className={`border-t border-border-soft ${selected?.id === strategy.id ? 'bg-brand/5' : ''}`}>
              <th scope="row" className="p-3 font-medium"><button type="button" onClick={() => selectStrategy(strategy.id)} aria-pressed={selected?.id === strategy.id} className="text-left text-brand hover:underline">{strategy.label}</button>{recommended?.id === strategy.id && <span className="ml-2 text-[10px] text-muted">Candidate</span>}</th>
              <td className="num p-3">{usd(strategy.netDebit, { sign: true, cents: false })}</td>
              <td className="num p-3">{money(strategy.postDebt)}</td><td className="num p-3">{pct(strategy.postEquityPct)}</td>
              <td className={`num p-3 ${tone(strategy.immediateExcess)}`}>{money(strategy.immediateExcess)}</td>
              <td className={`num p-3 ${tone(strategy.minExcess)}`}>{money(strategy.minExcess)}</td>
              <td className={`num p-3 ${strategy.maxDeficiency > 0 ? 'text-neg' : ''}`}>{strategy.minExcess == null ? 'Unverified' : money(strategy.maxDeficiency)}</td>
              <td className="p-3">{strategy.firstDeficiency ? shortDate(strategy.firstDeficiency) : strategy.minExcess == null ? 'Unverified' : 'None modeled'}</td>
              <td className="num p-3">{money(strategy.hedgeCost)}</td><td className="num p-3">{money(strategy.financing)}</td><td className="num p-3">{strategy.coverageDays}</td><td className="num p-3">{money(strategy.deleveraging)}</td>
              <td className={`p-3 ${strategy.qualifies ? 'text-pos' : 'text-neg'}`}>{strategy.qualifies ? 'Meets model' : 'Fails model'}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>}
    </details>

    <details className="border-t border-border-soft pt-3">
      <summary className="cursor-pointer text-xs font-semibold text-muted">Model assumptions, expiration risk & constraint details</summary>
      <div className="mt-3 space-y-3 text-xs leading-5 text-muted">
        <p>{report.explanation}</p>
        {missing.length > 0 && <div><h4 className="font-semibold text-brand">Unverified inputs ({missing.length})</h4><ul className="mt-1 list-disc space-y-1 pl-4">{missing.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        <p>Current balances are report snapshots. All forward values are hypothetical model estimates; missing maintenance data remains unverified. A modeled deficiency is not a broker-issued margin call. Cash proceeds from an option sale or asset sale are not newly created net equity.</p>
        <p>Coverage duration describes the modeled protection window. Expiration, settlement, replacement costs, execution gaps, interest, and maintenance assumptions determine the subsequent path. Expired protection must not be treated as continuing coverage. Inspect checkpoint phases in the chart tooltip.</p>
        <p>No orders or balance refreshes are performed here. The broker remains authoritative for maintenance and execution.</p>
        {report.strategies.map((strategy) => <StrategyNotes key={strategy.id} strategy={strategy} />)}
      </div>
    </details>
  </section>
}

export default MarginSurvivalDashboard
