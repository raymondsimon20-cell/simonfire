import { useMemo, useState } from 'react'
import { FlaskConical, Lock, Unlock, Eye, LoaderCircle, ShieldAlert } from 'lucide-react'
import { PageHeader, Button } from '../components/ui'
import { schwabStrategyHistory } from '../lib/api'
import { runLeveragedRegimeStrategy, type StrategyConfig, type StrategyMetrics } from '../lib/strategy'
import { pct, usd, shortDate } from '../lib/format'
import clsx from 'clsx'

const defaults: StrategyConfig = { startingCapital: 100000, trendWindow: 200, fastWindow: 50, tqqqAllocationPct: 50, sqqqAllocationPct: 20, tradingCostBps: 10 }

export default function StrategyLab() {
  const [config, setConfig] = useState(defaults)
  const [lockedConfig, setLockedConfig] = useState<StrategyConfig | null>(null)
  const [result, setResult] = useState<ReturnType<typeof runLeveragedRegimeStrategy> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [fetchedAt, setFetchedAt] = useState('')
  const locked = !!lockedConfig
  const fingerprint = useMemo(() => lockedConfig ? simpleHash(JSON.stringify(lockedConfig)) : '', [lockedConfig])
  const set = (key: keyof StrategyConfig, value: number) => !locked && setConfig((c) => ({ ...c, [key]: value }))
  const run = async () => {
    const frozen = { ...config }
    setLockedConfig(frozen); setLoading(true); setError(''); setRevealed(false); setResult(null)
    const history = await schwabStrategyHistory()
    setLoading(false)
    if (!history.ok || !history.series) { setLockedConfig(null); setError(history.error === 'not_connected' || history.error === 'refresh_expired' ? 'Connect or reconnect Schwab before running the test.' : history.error || 'Historical prices are unavailable.'); return }
    setFetchedAt(history.fetchedAt ?? '')
    setResult(runLeveragedRegimeStrategy(history.series.QQQ, history.series.TQQQ, history.series.SQQQ, frozen))
  }
  const reset = () => { setLockedConfig(null); setResult(null); setRevealed(false); setError('') }
  const segments = result?.segments ?? []
  return <div><PageHeader title="Leveraged Strategy Lab" subtitle="Blinded walk-forward testing for a tactical TQQQ / SQQQ regime strategy" right={locked ? <Button onClick={reset}><Unlock size={14}/> Unlock & reset</Button> : undefined}/>
    <div className="rounded-xl border border-[#5a3a16] bg-[#38240f]/45 p-4 text-xs leading-5 text-[#e7c88f]"><div className="flex items-center gap-2 font-semibold"><ShieldAlert size={15}/> Honest test boundary</div><p className="mt-1">The scored strategy uses actual QQQ, TQQQ, and SQQQ closes. VIX calls are excluded because an honest options test requires historical chains, spreads, and Greeks; spot VIX is not a substitute.</p></div>
    <div className="card mt-4 p-5"><div className="flex items-start gap-3"><FlaskConical size={20} className="text-brand"/><div><h2 className="font-semibold">Freeze the hypothesis</h2><p className="mt-1 text-xs text-faint">Signals observed at a close take effect next trading day. History is divided chronologically into 60% training, 20% validation, and a concealed 20% final holdout.</p></div>{locked && <span className="ml-auto rounded-md bg-pos/10 px-2 py-1 text-xs text-pos"><Lock size={11} className="mr-1 inline"/>Rules locked · {fingerprint}</span>}</div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Input label="Starting capital" prefix="$" value={config.startingCapital} disabled={locked} onChange={(v) => set('startingCapital', Math.max(1000, v))}/><Input label="Slow trend window" suffix="days" value={config.trendWindow} disabled={locked} onChange={(v) => set('trendWindow', Math.max(20, v))}/><Input label="Fast trend window" suffix="days" value={config.fastWindow} disabled={locked} onChange={(v) => set('fastWindow', Math.max(5, v))}/><Input label="TQQQ allocation in risk-on" suffix="%" value={config.tqqqAllocationPct} disabled={locked} onChange={(v) => set('tqqqAllocationPct', clamp(v, 0, 100))}/><Input label="SQQQ allocation in risk-off" suffix="%" value={config.sqqqAllocationPct} disabled={locked} onChange={(v) => set('sqqqAllocationPct', clamp(v, 0, 100))}/><Input label="Cost per allocation change" suffix="bps" value={config.tradingCostBps} disabled={locked} onChange={(v) => set('tradingCostBps', clamp(v, 0, 100))}/></div>
      {!locked && <div className="mt-5 flex justify-end"><Button variant="primary" onClick={run}><Lock size={14}/> Lock rules & run blind test</Button></div>}{loading && <div className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-surface-2/40 p-6 text-sm text-muted"><LoaderCircle size={16} className="animate-spin"/>Downloading Schwab daily history…</div>}{error && <div className="mt-4 rounded-lg border border-neg/30 bg-neg/10 p-3 text-xs text-neg">{error}</div>}
    </div>
    {result && <div className="mt-4 space-y-4"><div className="grid gap-4 lg:grid-cols-2"><ResultCard label="Training sample" note="Rules may be inspected here" metrics={segments[0]} capital={lockedConfig!.startingCapital}/><ResultCard label="Out-of-sample validation" note="First unseen period" metrics={segments[1]} capital={lockedConfig!.startingCapital}/></div>
      <div className="card p-5">{!revealed ? <div className="py-8 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#c7a96b]/10 text-[#d8bd7a]"><Eye size={20}/></div><h3 className="mt-3 font-semibold">Final holdout remains concealed</h3><p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-faint">Do not change the frozen rules after seeing validation. Reveal only when you accept this as the final test. Once viewed, this period cannot honestly be reused as unseen evidence.</p><Button variant="primary" className="mt-4" onClick={() => setRevealed(true)}><Eye size={14}/> Reveal final holdout once</Button></div> : <ResultCard label="Final untouched holdout" note="Rules were frozen before reveal" metrics={segments[2]} capital={lockedConfig!.startingCapital} embedded/>}</div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-faint"><span>{result.days.length.toLocaleString()} aligned trading days · fetched {fetchedAt ? new Date(fetchedAt).toLocaleString() : 'from Schwab'}</span><span>No taxes, borrowing costs, options, or cash interest modeled.</span></div></div>}
  </div>
}

function Input({ label, value, prefix, suffix, disabled, onChange }: { label: string; value: number; prefix?: string; suffix?: string; disabled: boolean; onChange: (v: number) => void }) { return <label className="text-xs text-muted"><span>{label}</span><div className={clsx('mt-1 flex rounded-xl border border-border bg-surface-2 px-3', disabled && 'opacity-60')}>{prefix && <span className="my-auto">{prefix}</span>}<input type="number" value={value} disabled={disabled} onChange={(e) => onChange(+e.target.value)} className="num w-full bg-transparent py-2.5 outline-none"/>{suffix && <span className="my-auto whitespace-nowrap">{suffix}</span>}</div></label> }
function ResultCard({ label, note, metrics, capital, embedded }: { label: string; note: string; metrics?: StrategyMetrics; capital: number; embedded?: boolean }) { if (!metrics) return null; return <div className={embedded ? '' : 'card p-5'}><div className="flex items-start justify-between"><div><h3 className="font-semibold">{label}</h3><p className="mt-1 text-xs text-faint">{note} · {shortDate(metrics.start)}–{shortDate(metrics.end)}</p></div><span className={clsx('num text-lg font-semibold', metrics.totalReturn >= 0 ? 'text-pos' : 'text-neg')}>{pct(metrics.totalReturn * 100)}</span></div><div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3"><Metric label="Period return" value={pct(metrics.totalReturn * 100)}/><Metric label="Annualized return" value={pct(metrics.annualizedReturn * 100)}/><Metric label="QQQ benchmark" value={pct(metrics.benchmarkReturn * 100)}/><Metric label="Maximum drawdown" value={pct(metrics.maxDrawdown * 100)} bad/><Metric label="Annualized volatility" value={pct(metrics.annualizedVolatility * 100)}/><Metric label="Sharpe (0% cash rate)" value={metrics.sharpe.toFixed(2)}/><Metric label="Allocation changes" value={metrics.trades.toLocaleString()}/><Metric label="Trading days" value={metrics.days.toLocaleString()}/><Metric label="Test capital" value={usd(capital)}/></div></div> }
function Metric({ label, value, bad }: { label: string; value: string; bad?: boolean }) { return <div><div className="text-[10px] uppercase tracking-wide text-faint">{label}</div><div className={clsx('num mt-1 text-sm font-semibold', bad && 'text-neg')}>{value}</div></div> }
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
function simpleHash(text: string) { let hash = 2166136261; for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619); return (hash >>> 0).toString(16).padStart(8, '0') }
