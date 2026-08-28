import { useEffect, useMemo, useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { Target, Wand2, Eraser, Percent, Calculator, Activity, TrendingDown, Copy, Check, ClipboardList, ShieldCheck, LoaderCircle, ListChecks, CircleAlert, Lock, Unlock, Scale, SlidersHorizontal, Eye, ShoppingCart } from 'lucide-react'
import { useScoped, useStore } from '../lib/store'
import { bucketOf, bucketStats, bucketClassification, BUCKETS, BUCKET_COLOR, type Bucket } from '../lib/buckets'
import { normTicker } from '../lib/plan'
import { buildInsights, SIGNAL_STYLE, ACTION_STYLE, type HoldingInsight } from '../lib/insights'
import { usd, pct, intfmt } from '../lib/format'
import { PageHeader, Button } from '../components/ui'
import { Modal } from '../components/Modal'
import { schwabOrderStatus, schwabPlaceOrder, schwabPreviewOrder, type EquityOrder } from '../lib/api'
import { marginCapacity, type MarginCapacity } from '../lib/margin'
import clsx from 'clsx'
import type { Account, Position } from '../lib/types'
import { protectivePutOutcome, protectivePutPlan } from '../lib/hedge'

const roundWeights = (buckets: Record<Bucket, { weight: number }>): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const b of BUCKETS) out[b] = +(buckets[b].weight * 100).toFixed(1)
  return out
}

export default function Allocation() {
  const { positions, transactions } = useScoped()
  const { data, setTargetAlloc, setPositionBucket } = useStore()

  const stats = useMemo(() => bucketStats(positions, transactions), [positions, transactions])
  const { buckets, total, blendedYield } = stats
  const [tab, setTab] = useState<'targets' | 'plan' | 'review' | 'hedges' | 'orders'>('targets')
  const [locked, setLocked] = useState<Set<Bucket>>(new Set())

  const insights = useMemo(
    () => buildInsights(positions, data.insights?.bySymbol),
    [positions, data.insights],
  )

  // Unique tickers per bucket (dedupe symbols across accounts).
  const tickersByBucket = useMemo(() => {
    const m: Record<Bucket, { symbol: string; name: string; price: number }[]> = {
      Growth: [], CEFs: [], 'High Yield': [], Leveraged: [],
    }
    const seen = new Set<string>()
    for (const p of positions) {
      if (p.isOption) continue // don't suggest DCA-ing into a specific option contract
      const key = normTicker(p.symbol)
      if (seen.has(key)) continue
      seen.add(key)
      m[bucketOf(p)].push({ symbol: p.symbol, name: p.name, price: p.lastPrice })
    }
    for (const b of BUCKETS) m[b].sort((a, z) => a.symbol.localeCompare(z.symbol))
    return m
  }, [positions])

  // Target weights (persisted). Default to current allocation on first visit.
  const [target, setTarget] = useState<Record<string, number>>(
    () => data.targetAlloc ?? roundWeights(buckets),
  )
  useEffect(() => {
    if (!data.targetAlloc) setTarget(roundWeights(buckets))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = (next: Record<string, number>) => {
    setTarget(next)
    setTargetAlloc(next)
  }
  const setBucket = (b: Bucket, v: number) => { if (!locked.has(b)) update({ ...target, [b]: Math.max(0, Math.min(100, v)) }) }
  const resetFromCurrent = () => update(roundWeights(buckets))
  const clearAll = () => update({ Growth: 0, CEFs: 0, 'High Yield': 0, Leveraged: 0 })
  const normalizeTargets = () => {
    const lockedTotal = BUCKETS.filter((b) => locked.has(b)).reduce((sum, b) => sum + (target[b] ?? 0), 0)
    const open = BUCKETS.filter((b) => !locked.has(b))
    const openTotal = open.reduce((sum, b) => sum + (target[b] ?? 0), 0)
    const remaining = Math.max(0, 100 - lockedTotal)
    const next = { ...target }
    open.forEach((b) => { next[b] = openTotal ? ((target[b] ?? 0) / openTotal) * remaining : remaining / Math.max(open.length, 1) })
    update(Object.fromEntries(BUCKETS.map((b) => [b, +Number(next[b] ?? 0).toFixed(1)])))
  }
  const scenario = (name: 'income' | 'growth' | 'defensive' | 'current') => {
    if (name === 'current') return resetFromCurrent()
    const presets = name === 'income' ? { Growth: 20, CEFs: 30, 'High Yield': 45, Leveraged: 5 } : name === 'growth' ? { Growth: 65, CEFs: 15, 'High Yield': 15, Leveraged: 5 } : { Growth: 50, CEFs: 30, 'High Yield': 20, Leveraged: 0 }
    update(presets)
  }

  const targetTotal = BUCKETS.reduce((s, b) => s + (target[b] ?? 0), 0)
  const balanced = Math.abs(targetTotal - 100) < 0.05

  const targetBlended = BUCKETS.reduce((s, b) => s + ((target[b] ?? 0) / 100) * buckets[b].yield, 0)

  // ---- Rebalance calculator ----
  const [contribution, setContribution] = useState(2000)
  const [planMode, setPlanMode] = useState<'contribution' | 'rebalance'>('contribution')
  const [wholeShares, setWholeShares] = useState(true)
  const [orderAccount, setOrderAccount] = useState<string>(() => data.accounts[0]?.id ?? '')
  const selectedOrderAccount = data.accounts.find((account) => account.id === orderAccount)
  const capacities = useMemo(() => data.accounts.map((account) => {
    const positionValue = data.positions
      .filter((position) => position.accountId === account.id)
      .reduce((sum, position) => sum + position.shares * position.lastPrice, 0)
    return { account, capacity: marginCapacity(account, positionValue)! }
  }), [data.accounts, data.positions])
  const capacity = capacities.find(({ account }) => account.id === orderAccount)?.capacity ?? null
  const contributionOverCapacity = !!capacity && contribution > capacity.maxOrderSpend + 0.005

  const plan = useMemo(() => {
    const empty: Record<Bucket, number> = { Growth: 0, CEFs: 0, 'High Yield': 0, Leveraged: 0 }
    if (!balanced) return empty
    const newTotal = total + contribution
    const desired = BUCKETS.map((b) => {
      const targetValue = newTotal * ((target[b] ?? 0) / 100)
      return { b, add: Math.max(0, targetValue - buckets[b].value) }
    })
    const sumDesired = desired.reduce((s, d) => s + d.add, 0)
    const addByBucket: Record<Bucket, number> = empty
    if (planMode === 'rebalance') {
      for (const d of desired) addByBucket[d.b] = d.add
      return addByBucket
    }
    if (sumDesired <= 0) {
      // Already at/over target everywhere → split by target weight.
      for (const b of BUCKETS) addByBucket[b] = contribution * ((target[b] ?? 0) / 100)
    } else if (sumDesired >= contribution) {
      for (const d of desired) addByBucket[d.b] = (d.add / sumDesired) * contribution
    } else {
      const leftover = contribution - sumDesired
      for (const d of desired)
        addByBucket[d.b] = d.add + leftover * ((target[d.b] ?? 0) / 100)
    }
    return addByBucket
  }, [total, contribution, target, buckets, balanced, planMode])

  // Flatten the plan into a reviewable BUY order queue (one row per ticker).
  const orderQueue = useMemo(() => {
    const items: { symbol: string; name: string; bucket: Bucket; price: number; shares: number; spend: number }[] = []
    for (const b of BUCKETS) {
      const add = plan[b]
      if (add <= 0.5) continue
      const tickers = tickersByBucket[b]
      if (!tickers.length) continue
      const per = add / tickers.length
      for (const t of tickers) {
        const rawShares = t.price ? per / t.price : 0
        const shares = wholeShares ? Math.floor(rawShares) : +rawShares.toFixed(3)
        const spend = wholeShares ? shares * t.price : per
        if (shares <= 0 || spend <= 0.5) continue
        items.push({ symbol: t.symbol, name: t.name, bucket: b, price: t.price, shares, spend })
      }
    }
    return items
  }, [plan, tickersByBucket, wholeShares])
  const sellPlan = useMemo(() => {
    if (planMode !== 'rebalance' || !balanced) return []
    const postValue = total + contribution
    return BUCKETS.map((bucket) => ({ bucket, amount: Math.max(0, buckets[bucket].value - postValue * ((target[bucket] ?? 0) / 100)) })).filter((row) => row.amount > .5)
  }, [planMode, balanced, total, contribution, buckets, target])

  const driftRows = BUCKETS.map((b) => ({ bucket: b, current: buckets[b].weight * 100, target: target[b] ?? 0, drift: buckets[b].weight * 100 - (target[b] ?? 0) }))
  const largestDrift = [...driftRows].sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))[0]
  const annualIncomeDelta = total * (targetBlended - blendedYield)
  const plannedSpend = orderQueue.reduce((sum, item) => sum + item.spend, 0)
  const cashRemaining = Math.max(0, contribution - plannedSpend)
  const classificationRows = positions.map((p) => ({ position: p, ...bucketClassification(p) }))
  const fallbackCount = classificationRows.filter((r) => r.method === 'Growth fallback').length

  return (
    <div>
      <PageHeader
        title="Target Allocation"
        subtitle="Set your ideal allocation, then see exactly where to put your next dollars"
        right={
          <>
            <Button onClick={resetFromCurrent}><Wand2 size={15} /> Reset from current</Button>
            <Button onClick={clearAll}><Eraser size={15} /> Clear all</Button>
          </>
        }
      />

      <div className="mb-5 flex overflow-x-auto rounded-xl border border-border bg-surface/70 p-1">
        {([
          ['targets', Target, 'Targets'], ['plan', Calculator, 'Contribution Plan'], ['review', Eye, 'Holdings Review'], ['hedges', ShieldCheck, 'Protective Puts'], ['orders', ShoppingCart, 'Orders'],
        ] as const).map(([key, Icon, label]) => <button key={key} onClick={() => setTab(key)} className={clsx('flex min-w-max flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors', tab === key ? 'bg-[#c7a96b]/15 text-[#e1c887]' : 'text-muted hover:bg-white/[0.03] hover:text-ink')}><Icon size={15} />{label}</button>)}
      </div>

      {tab === 'targets' && <>
      <section className="mb-4 overflow-hidden rounded-[22px] border border-[#c7a96b]/15 bg-[linear-gradient(135deg,#151922,#0c1016)] p-6">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#cbb77f]">Allocation mandate</div>
        <div className="mt-4 grid grid-cols-2 gap-5 lg:grid-cols-5">
          <SummaryMetric label="Portfolio" value={usd(total, { cents: false })} />
          <SummaryMetric label="Largest drift" value={largestDrift ? `${largestDrift.bucket} ${largestDrift.drift >= 0 ? '+' : ''}${largestDrift.drift.toFixed(1)}%` : '—'} tone={largestDrift && Math.abs(largestDrift.drift) > 2 ? 'warn' : undefined} />
          <SummaryMetric label="Current run-rate" value={pct(blendedYield * 100)} />
          <SummaryMetric label="At-target run-rate" value={pct(targetBlended * 100)} />
          <SummaryMetric label="Annual income impact" value={usd(annualIncomeDelta, { sign: true })} tone={annualIncomeDelta >= 0 ? 'positive' : 'warn'} />
        </div>
      </section>

      {/* Blended yield */}
      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#f0a94a]">
          <Percent size={16} /> Current-Share Distribution Yield
        </div>
        <div className="flex items-center gap-4">
          <div>
            <div className="text-xs text-muted">CURRENT RUN RATE</div>
            <div className="num text-2xl font-bold">{pct(blendedYield * 100)}</div>
          </div>
          <div className="text-faint">→</div>
          <div>
            <div className="text-xs text-muted">AT TARGET MIX</div>
            <div className="num text-2xl font-bold text-pos">{pct(targetBlended * 100)}</div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {BUCKETS.map((b) => (
              <span key={b} className="rounded-md px-2 py-1 text-xs font-medium" style={{ background: BUCKET_COLOR[b] + '22', color: BUCKET_COLOR[b] }}>
                {b} yield {pct(buckets[b].yield * 100)} · {target[b] ?? 0}% target
              </span>
            ))}
          </div>
        </div>
        <p className="mt-3 text-xs text-faint">
          Run-rate yield scales historical per-share distributions to the shares held today and excludes options. At-target mix applies each bucket's run-rate yield to your target allocation; it is an estimate, not a declared forward yield.
        </p>
      </div>

      {/* Current vs Target donuts */}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <DonutCard title="Current" subtitle={`${BUCKETS.filter((b) => buckets[b].value > 0).length} buckets`}
          slices={BUCKETS.map((b) => ({ name: b, value: buckets[b].value }))} labels={(b) => pct(buckets[b].weight * 100)} />
        <DonutCard title="Target" subtitle={balanced ? '100% complete' : `${targetTotal.toFixed(0)}% allocated`}
          slices={BUCKETS.map((b) => ({ name: b, value: target[b] ?? 0 }))} labels={(b) => pct(target[b] ?? 0)} />
      </div>

      {/* Bucket allocation editor */}
      <div className="card mt-4 p-5">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Bucket Allocation</h3>
          <span className={clsx('num text-sm font-semibold', balanced ? 'text-pos' : 'text-[#f0a94a]')}>
            Total target: {targetTotal.toFixed(1)}% {balanced ? '✓' : ''}
          </span>
        </div>
        <p className="mb-4 text-xs text-faint">Adjust target percentages for each bucket. Targets should sum to 100%.</p>
        <div className="mb-4 flex flex-wrap gap-2">
          <Button onClick={normalizeTargets}><Scale size={14} /> Normalize to 100%</Button>
          <span className="my-auto text-xs text-faint">Scenarios:</span>
          <button onClick={() => scenario('income')} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:text-ink">Income focus</button>
          <button onClick={() => scenario('growth')} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:text-ink">Growth focus</button>
          <button onClick={() => scenario('defensive')} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:text-ink">Reduce leverage</button>
          <button onClick={() => scenario('current')} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:text-ink">Current mix</button>
        </div>
        <div className="space-y-3">
          {BUCKETS.map((b) => {
            const s = buckets[b]
            const delta = (target[b] ?? 0) - s.weight * 100
            return (
              <div key={b} className="flex flex-wrap items-center gap-4 rounded-xl border border-border-soft bg-surface-2/40 p-3.5">
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: BUCKET_COLOR[b] }} />
                <div className="min-w-[150px]">
                  <div className="font-semibold">{b}</div>
                  <div className="text-xs text-faint">{usd(s.value)} · {intfmt(s.count)} holdings</div>
                </div>
                <div className="text-right text-xs">
                  <div className="text-faint">NOW</div>
                  <div className="num font-semibold">{pct(s.weight * 100)}</div>
                </div>
                <div className={clsx('text-right text-xs', delta >= 0 ? 'text-pos' : 'text-neg')}>
                  <div className="text-faint">Δ TARGET</div>
                  <div className="num font-semibold">{delta >= 0 ? '+' : ''}{delta.toFixed(1)}%</div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => setLocked((prev) => { const next = new Set(prev); if (next.has(b)) next.delete(b); else next.add(b); return next })} className={clsx('grid h-8 w-8 place-items-center rounded-lg border', locked.has(b) ? 'border-[#c7a96b]/40 bg-[#c7a96b]/10 text-[#d8bd7a]' : 'border-border text-faint')} title={locked.has(b) ? 'Unlock target' : 'Lock target'}>{locked.has(b) ? <Lock size={13} /> : <Unlock size={13} />}</button>
                  <input
                    type="range" min={0} max={100} step={0.5} value={target[b] ?? 0}
                    onChange={(e) => setBucket(b, +e.target.value)}
                    disabled={locked.has(b)}
                    className="w-40 accent-[color:var(--tw)]"
                    style={{ accentColor: BUCKET_COLOR[b] }}
                  />
                  <div className="flex items-center rounded-lg border border-border bg-surface px-2">
                    <input
                      type="number" min={0} max={100} step={0.5} value={target[b] ?? 0}
                      onChange={(e) => setBucket(b, +e.target.value)}
                      disabled={locked.has(b)}
                      className="w-16 bg-transparent py-1.5 text-right text-sm outline-none"
                    />
                    <span className="text-xs text-faint">%</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card mt-4 overflow-x-auto p-0">
        <div className="flex items-center gap-2 p-5 pb-3"><SlidersHorizontal size={16} className="text-brand" /><h3 className="font-semibold">Allocation Drift</h3></div>
        <table className="w-full min-w-[680px] text-sm"><thead><tr className="border-y border-border-soft text-left text-xs text-muted"><th className="px-5 py-2.5">Bucket</th><th className="px-4 py-2.5 text-right">Current</th><th className="px-4 py-2.5 text-right">Target</th><th className="px-4 py-2.5 text-right">Drift</th><th className="px-5 py-2.5">Action</th></tr></thead><tbody>{driftRows.map((r) => <tr key={r.bucket} className="border-b border-border-soft"><td className="px-5 py-3 font-semibold"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: BUCKET_COLOR[r.bucket] }} />{r.bucket}</td><td className="num px-4 py-3 text-right">{pct(r.current)}</td><td className="num px-4 py-3 text-right">{pct(r.target)}</td><td className={clsx('num px-4 py-3 text-right font-semibold', Math.abs(r.drift) < .5 ? 'text-faint' : r.drift > 0 ? 'text-neg' : 'text-pos')}>{r.drift >= 0 ? '+' : ''}{r.drift.toFixed(1)}%</td><td className="px-5 py-3"><span className={clsx('rounded-md px-2 py-1 text-xs font-medium', Math.abs(r.drift) < .5 ? 'bg-white/[.04] text-faint' : r.drift > 0 ? 'bg-neg/10 text-neg' : 'bg-pos/10 text-pos')}>{Math.abs(r.drift) < .5 ? 'Hold' : r.drift > 0 ? 'Pause / trim' : 'Add'}</span></td></tr>)}</tbody></table>
      </div>
      </>}

      {/* Rebalance calculator */}
      {tab === 'plan' && <>
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-4"><span className="text-xs font-medium uppercase tracking-[.12em] text-faint">Scenario</span><button onClick={() => setPlanMode('contribution')} className={clsx('rounded-lg px-3 py-2 text-sm', planMode === 'contribution' ? 'bg-[#c7a96b]/15 text-[#e1c887]' : 'text-muted hover:bg-white/[.03]')}>New contribution only</button><button onClick={() => setPlanMode('rebalance')} className={clsx('rounded-lg px-3 py-2 text-sm', planMode === 'rebalance' ? 'bg-[#c7a96b]/15 text-[#e1c887]' : 'text-muted hover:bg-white/[.03]')}>Rebalance with sales</button><span className="ml-auto text-xs text-faint">Sales remain review-only and are never submitted automatically.</span></div>
      <div className="card mt-4 p-5">
        <div className="mb-1 flex items-center gap-2">
          <Calculator size={18} className="text-brand" />
          <h3 className="text-lg font-semibold">Rebalance Calculator</h3>
        </div>
        <p className="mb-4 text-xs text-faint">Enter your next contribution and see exactly how to split it toward your target.</p>

        <div className="mb-5 flex flex-wrap items-center gap-4">
          <div className="flex items-center rounded-lg border border-border bg-surface-2 px-3">
            <span className="text-faint">$</span>
            <input
              type="number" min={0} step={100} value={contribution}
              onChange={(e) => setContribution(Math.max(0, +e.target.value))}
              className="w-32 bg-transparent py-2 pl-1 text-sm outline-none"
            />
          </div>
          <span className="text-sm text-muted">{usd(total, { cents: false })} → {usd(total + contribution, { cents: false })}</span>
          <div className="ml-auto flex items-center rounded-lg border border-border bg-surface-2 p-0.5 text-xs">
            <button onClick={() => setWholeShares(true)} className={clsx('rounded-md px-3 py-1.5', wholeShares ? 'bg-surface text-ink' : 'text-muted')}>Whole shares</button>
            <button onClick={() => setWholeShares(false)} className={clsx('rounded-md px-3 py-1.5', !wholeShares ? 'bg-surface text-ink' : 'text-muted')}>Fractional</button>
          </div>
        </div>

        {capacities.length > 0 && (
          <div className="mb-5 overflow-hidden rounded-xl border border-border-soft">
            <div className="flex items-start gap-2 bg-surface-2/60 px-4 py-3">
              <CircleAlert size={16} className="mt-0.5 shrink-0 text-[#f0a94a]" />
              <div>
                <div className="text-sm font-semibold">50% Minimum Equity by Account</div>
                <div className="mt-0.5 text-xs text-faint">Equity % matches Schwab’s view. Maximum safe spend accounts for current margin debt and keeps account equity at or above 50%, capped by Schwab SMA and buying power.</div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-t border-border-soft text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Account</th>
                    <th className="px-3 py-2 text-right font-medium">Current Equity %</th>
                    <th className="px-3 py-2 text-right font-medium">Maximum Safe Spend</th>
                    <th className="px-3 py-2 text-right font-medium">After This Plan</th>
                    <th className="px-4 py-2 text-right font-medium">Use</th>
                  </tr>
                </thead>
                <tbody>
                  {capacities.map(({ account, capacity: accountCapacity }) => {
                    const selected = account.id === orderAccount
                    const over = contribution > accountCapacity.maxOrderSpend + 0.005
                    const afterEquity = 1 - accountCapacity.projectedUsage(contribution)
                    return (
                      <tr key={account.id} className={clsx('border-t border-border-soft', selected && 'bg-[#10233f]/60')}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{account.name}</span>
                            {!account.name.includes(account.mask) && <span className="text-xs text-faint">····{account.mask}</span>}
                            {selected && <span className="rounded bg-brand/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#7eb0ff]">ORDER ACCOUNT</span>}
                          </div>
                          <div className="mt-0.5 text-[11px] text-faint">{accountCapacity.basis}</div>
                        </td>
                        <td className={clsx('num px-3 py-3 text-right', accountCapacity.alreadyOverLimit ? 'text-neg' : 'text-muted')}>
                          {account.isMargin ? pct((1 - accountCapacity.currentUsage) * 100) : '100.00%'}
                        </td>
                        <td className="num px-3 py-3 text-right font-semibold">{usd(accountCapacity.maxOrderSpend)}</td>
                        <td className={clsx('num px-3 py-3 text-right font-semibold', over || accountCapacity.alreadyOverLimit ? 'text-neg' : 'text-pos')}>
                          {accountCapacity.alreadyOverLimit
                            ? 'Below 50%'
                            : account.isMargin ? pct(afterEquity * 100) : over ? `Over by ${usd(contribution - accountCapacity.maxOrderSpend)}` : '100.00%'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button onClick={() => setOrderAccount(account.id)} className="py-1 text-[11px]" disabled={selected}>Use account</Button>
                            <Button
                              onClick={() => {
                                setOrderAccount(account.id)
                                setContribution(Math.floor(accountCapacity.maxOrderSpend * 100) / 100)
                              }}
                              className="py-1 text-[11px]"
                              disabled={accountCapacity.alreadyOverLimit}
                            >
                              Use max
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {capacity && (contributionOverCapacity || capacity.alreadyOverLimit) && (
              <div className="border-t border-[#5a2631] bg-[#33161d] px-4 py-2.5 text-xs font-semibold text-[#f2607a]">
                {capacity.alreadyOverLimit
                  ? `${selectedOrderAccount?.name} is already below 50% equity; no additional order spend is permitted by this guardrail.`
                  : `${selectedOrderAccount?.name} exceeds its safe maximum by ${usd(contribution - capacity.maxOrderSpend)}.`}
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          {planMode === 'rebalance' && sellPlan.length > 0 && <div className="rounded-xl border border-[#5a2631]/60 bg-[#33161d]/35 p-4"><div className="flex items-center gap-2"><TrendingDown size={15} className="text-neg"/><span className="font-semibold">Allocation-funded trims</span><span className="ml-auto text-xs text-faint">Review-only</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{sellPlan.map((row) => <div key={row.bucket} className="flex items-center justify-between rounded-lg bg-black/15 px-3 py-2 text-sm"><span>{row.bucket}</span><span className="num text-neg">−{usd(row.amount)}</span></div>)}</div><p className="mt-3 text-xs text-faint">These are bucket-level sale amounts required for an immediate rebalance. Choose tax lots and confirm tax consequences at Schwab; the app does not generate or submit these sells.</p></div>}
          {BUCKETS.map((b) => {
            const add = plan[b]
            const tickers = tickersByBucket[b]
            const nowW = buckets[b].weight * 100
            const tgtW = target[b] ?? 0
            const per = tickers.length ? add / tickers.length : 0
            return (
              <div key={b} className="overflow-hidden rounded-xl border border-border-soft">
                <div className="flex flex-wrap items-center gap-3 bg-surface-2/50 px-4 py-3">
                  <span className="h-3 w-3 rounded-sm" style={{ background: BUCKET_COLOR[b] }} />
                  <span className="font-semibold">{b}</span>
                  <span className="text-xs text-faint">{pct(nowW)} → {pct(tgtW)}</span>
                  <span className={clsx('num ml-auto text-sm font-semibold', add > 0.5 ? 'text-pos' : 'text-faint')}>
                    {add > 0.5 ? `+${usd(add)}` : 'On target'}
                  </span>
                </div>
                {add > 0.5 && tickers.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead>
                        <tr className="border-b border-border-soft text-left text-xs text-muted">
                          <th className="px-4 py-2 font-medium">Ticker</th>
                          <th className="px-4 py-2 text-right font-medium">Buy $</th>
                          <th className="px-4 py-2 text-right font-medium">Shares</th>
                          <th className="px-4 py-2 text-right font-medium">Price</th>
                          <th className="px-4 py-2 text-right font-medium">After plan</th>
                          <th className="px-4 py-2 font-medium">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tickers.map((t) => {
                          const rawShares = t.price ? per / t.price : 0
                          const shares = wholeShares ? Math.floor(rawShares) : rawShares
                          const spend = wholeShares ? shares * t.price : per
                          return (
                            <tr key={t.symbol} className="border-b border-border-soft last:border-0">
                              <td className="px-4 py-2">
                                <span className="font-semibold">{t.symbol}</span>
                                <span className="ml-2 text-xs text-faint">{t.name}</span>
                              </td>
                              <td className="num px-4 py-2 text-right text-pos">+{usd(spend)}</td>
                              <td className="num px-4 py-2 text-right text-muted">{wholeShares ? shares : `~${rawShares.toFixed(3)}`}</td>
                              <td className="num px-4 py-2 text-right">{usd(t.price)}</td>
                              <td className="num px-4 py-2 text-right text-muted">{pct(((buckets[b].value + plan[b]) / Math.max(total + contribution, 1)) * 100)}</td>
                              <td className="px-4 py-2 text-xs text-faint">Under target by {Math.max(0, tgtW - nowW).toFixed(1)} pts</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <p className="mt-4 text-xs text-faint">
          Amounts move your portfolio toward its target allocation and are split evenly across each bucket's holdings. This is a plan — place the actual buys in your brokerage.
        </p>
      </div>
      <PlanReview contribution={contribution} account={selectedOrderAccount?.name ?? 'No account'} orderCount={orderQueue.length} plannedSpend={plannedSpend} cashRemaining={cashRemaining} yieldBefore={blendedYield} yieldAfter={targetBlended} capacity={capacity} overCapacity={contributionOverCapacity} onContinue={() => setTab('orders')} balanced={balanced} />
      </>}

      {/* Order Queue — review & place */}
      {tab === 'orders' && <>
      <PlanReview contribution={contribution} account={selectedOrderAccount?.name ?? 'No account'} orderCount={orderQueue.length} plannedSpend={plannedSpend} cashRemaining={cashRemaining} yieldBefore={blendedYield} yieldAfter={targetBlended} capacity={capacity} overCapacity={contributionOverCapacity} balanced={balanced} />
      <OrderQueue
        items={orderQueue}
        wholeShares={wholeShares}
        accounts={data.accounts}
        orderAccount={orderAccount}
        setOrderAccount={setOrderAccount}
        live={data.source === 'live'}
        capacity={capacity}
      />
      </>}

      {/* Rebalance Insights (50/100/200 SMA) */}
      {tab === 'review' && <>
      <ClassificationReview rows={classificationRows} fallbackCount={fallbackCount} accounts={data.accounts} />
      <FallbackCorrections rows={classificationRows.filter((r) => r.method === 'Growth fallback')} onSetBucket={setPositionBucket} />
      <RebalanceInsights insights={insights} accName={(id) => data.accounts.find((a) => a.id === id)?.name ?? id} hasData={!!data.insights} />
      </>}
      {tab === 'hedges' && <ProtectivePutsEngine positions={positions} accounts={data.accounts} />}
    </div>
  )
}

function SummaryMetric({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'warn' }) {
  return <div><div className="text-[10px] font-medium uppercase tracking-[.12em] text-faint">{label}</div><div className={clsx('num mt-1 text-lg font-semibold', tone === 'positive' ? 'text-pos' : tone === 'warn' ? 'text-[#e7c88f]' : 'text-ink')}>{value}</div></div>
}

function PlanReview({ contribution, account, orderCount, plannedSpend, cashRemaining, yieldBefore, yieldAfter, capacity, overCapacity, balanced, onContinue }: { contribution: number; account: string; orderCount: number; plannedSpend: number; cashRemaining: number; yieldBefore: number; yieldAfter: number; capacity: MarginCapacity | null; overCapacity: boolean; balanced: boolean; onContinue?: () => void }) {
  const projectedEquity = capacity ? (1 - capacity.projectedUsage(plannedSpend)) * 100 : null
  const warnings = [!balanced && 'Targets do not total 100%.', overCapacity && 'Contribution exceeds the account safety limit.', orderCount === 0 && 'No executable whole-share orders were generated.'].filter(Boolean)
  return <div className="card mt-4 p-5"><div className="flex items-center gap-2"><ShieldCheck size={17} className="text-brand"/><h3 className="font-semibold">Final Plan Review</h3>{warnings.length === 0 && <span className="ml-auto rounded-md bg-pos/10 px-2 py-1 text-xs text-pos">Ready for review</span>}</div><div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4"><SummaryMetric label="Contribution" value={usd(contribution)} /><SummaryMetric label="Order account" value={account} /><SummaryMetric label="Proposed orders" value={String(orderCount)} /><SummaryMetric label="Planned exposure" value={usd(plannedSpend)} /><SummaryMetric label="Cash remaining" value={usd(cashRemaining)} /><SummaryMetric label="Yield impact" value={`${pct(yieldBefore * 100)} → ${pct(yieldAfter * 100)}`} /><SummaryMetric label="Projected equity" value={projectedEquity == null ? 'Cash account' : pct(projectedEquity)} tone={projectedEquity != null && projectedEquity < 50 ? 'warn' : undefined} /><SummaryMetric label="Safety limit" value={capacity ? usd(capacity.maxOrderSpend) : '—'} /></div>{warnings.length > 0 && <div className="mt-4 rounded-xl border border-[#5a3a16] bg-[#38240f]/70 p-3 text-xs text-[#e7c88f]">{warnings.join(' ')}</div>}{onContinue && <div className="mt-4 flex justify-end"><Button variant="primary" onClick={onContinue} disabled={warnings.length > 0}>Review order queue</Button></div>}</div>
}

function ClassificationReview({ rows, fallbackCount, accounts: _accounts }: { rows: Array<{ position: Position; bucket: Bucket; method: ReturnType<typeof bucketClassification>['method'] }>; fallbackCount: number; accounts: Account[] }) {
  return <div className="card p-0"><div className="flex items-start gap-3 p-5"><ListChecks size={18} className="mt-0.5 text-brand"/><div><h3 className="font-semibold">Classification Review</h3><p className="mt-1 text-xs text-faint">Verify how each holding entered its allocation bucket. Growth fallbacks deserve manual review because no explicit ticker or name rule matched.</p></div><span className={clsx('ml-auto rounded-md px-2 py-1 text-xs', fallbackCount ? 'bg-[#38240f] text-[#e7c88f]' : 'bg-pos/10 text-pos')}>{fallbackCount} fallback</span></div><div className="max-h-[430px] overflow-auto"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-y border-border-soft text-left text-xs text-muted"><th className="px-5 py-2.5">Holding</th><th className="px-4 py-2.5">Account</th><th className="px-4 py-2.5">Bucket</th><th className="px-5 py-2.5">Classification source</th></tr></thead><tbody>{rows.map((r) => <tr key={r.position.id} className="border-b border-border-soft"><td className="px-5 py-3"><span className="font-semibold">{r.position.symbol}</span><span className="ml-2 text-xs text-faint">{r.position.name}</span></td><td className="px-4 py-3 text-xs text-muted">{r.position.accountId}</td><td className="px-4 py-3"><span className="rounded-md px-2 py-1 text-xs font-medium" style={{ color: BUCKET_COLOR[r.bucket], backgroundColor: `${BUCKET_COLOR[r.bucket]}15` }}>{r.bucket}</span></td><td className="px-5 py-3"><span className={clsx('text-xs', r.method === 'Growth fallback' ? 'text-[#e7c88f]' : 'text-muted')}>{r.method}</span></td></tr>)}</tbody></table></div></div>
}

function FallbackCorrections({ rows, onSetBucket }: { rows: Array<{ position: Position; bucket: Bucket }>; onSetBucket: (accountId: string, symbol: string, bucket: Bucket) => void }) {
  if (!rows.length) return null
  return <div className="card mt-4 p-5"><div className="flex items-start gap-2"><CircleAlert size={16} className="mt-0.5 text-[#e7c88f]"/><div><h3 className="font-semibold">Resolve Growth Fallbacks</h3><p className="mt-1 text-xs text-faint">Choose the intended bucket. Overrides are saved by account and symbol and reapplied after every sync.</p></div></div><div className="mt-4 space-y-2">{rows.map(({ position }) => <div key={position.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border-soft bg-surface-2/40 p-3"><div className="min-w-[180px] flex-1"><span className="font-semibold">{position.symbol}</span><div className="truncate text-xs text-faint">{position.name}</div></div>{BUCKETS.map((bucket) => <button key={bucket} onClick={() => onSetBucket(position.accountId, position.symbol, bucket)} className="rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-white/[.04]" style={{ borderColor: `${BUCKET_COLOR[bucket]}35`, color: BUCKET_COLOR[bucket] }}>{bucket}</button>)}</div>)}</div></div>
}

function ProtectivePutsEngine({ positions, accounts }: { positions: Position[]; accounts: Account[] }) {
  const eligible = useMemo(() => positions.filter((p) => !p.isOption && p.shares > 0 && p.lastPrice > 0).sort((a, b) => b.shares * b.lastPrice - a.shares * a.lastPrice), [positions])
  const [positionId, setPositionId] = useState(() => eligible[0]?.id ?? '')
  const [coverage, setCoverage] = useState(100)
  const [drawdown, setDrawdown] = useState(15)
  const [premium, setPremium] = useState(0)
  const [expiry, setExpiry] = useState('')
  const [rounding, setRounding] = useState<'down' | 'nearest' | 'up'>('down')
  const [copied, setCopied] = useState(false)
  const p = eligible.find((row) => row.id === positionId) ?? eligible[0]
  if (!p) return <div className="card p-10 text-center text-sm text-muted">No eligible long equity positions are available to hedge.</div>
  const hedge = protectivePutPlan({ shares: p.shares, sharePrice: p.lastPrice, coveragePct: coverage, maxDrawdownPct: drawdown, premiumPerShare: premium, contractRounding: rounding })
  const { contracts, coveredShares, uncoveredShares, overhedgedShares, strike, premiumCost, protectedNotional: protectedValue, positionValue, effectiveFloor, premiumDrag, breakEvenPrice, maxLoss, maxLossPct } = hedge
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const expiryDate = expiry ? new Date(`${expiry}T00:00:00`) : null
  const daysToExpiry = expiryDate ? Math.ceil((expiryDate.getTime() - today.getTime()) / 86_400_000) : null
  const annualizedDrag = daysToExpiry && daysToExpiry > 0 ? premiumDrag * 365 / daysToExpiry : null
  const scenarios = [25, 15, 0, -drawdown, -30, -50]
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => b - a)
    .map((move) => ({ move, ...protectivePutOutcome(hedge, p.lastPrice * (1 + move / 100)) }))
  const account = accounts.find((a) => a.id === p.accountId)
  const ticket = `BUY TO OPEN ${contracts} ${p.symbol} PUT ${expiry || '[EXPIRY]'} $${strike.toFixed(2)} @ $${premium.toFixed(2)} LIMIT (${account?.name ?? p.accountId})`
  const copy = async () => { try { await navigator.clipboard.writeText(ticket); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* unavailable */ } }
  return <div className="space-y-4"><div className="card p-5"><div className="flex items-start gap-3"><ShieldCheck size={20} className="mt-0.5 text-brand"/><div><h3 className="text-lg font-semibold">Protective Puts Engine</h3><p className="mt-1 text-xs text-faint">Model contract sizing, hedge cost, loss limits, and expiration outcomes. Quotes and strikes remain manual planning inputs.</p></div></div><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><label className="text-xs text-muted"><span>Position</span><select value={p.id} onChange={(e) => setPositionId(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink">{eligible.map((row) => <option key={row.id} value={row.id}>{row.symbol} · {row.shares} shares · {accounts.find((a) => a.id === row.accountId)?.name}</option>)}</select></label><label className="text-xs text-muted"><span>Coverage</span><div className="mt-1 flex rounded-xl border border-border bg-surface-2 px-3"><input type="number" min={1} max={100} value={coverage} onChange={(e) => setCoverage(Math.max(1, Math.min(100, +e.target.value)))} className="num w-full bg-transparent py-2.5 outline-none"/><span className="my-auto">%</span></div></label><label className="text-xs text-muted"><span>Maximum tolerated drawdown</span><div className="mt-1 flex rounded-xl border border-border bg-surface-2 px-3"><input type="number" min={1} max={90} value={drawdown} onChange={(e) => setDrawdown(Math.max(1, Math.min(90, +e.target.value)))} className="num w-full bg-transparent py-2.5 outline-none"/><span className="my-auto">%</span></div></label><label className="text-xs text-muted"><span>Expiration</span><input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm [color-scheme:dark]"/></label><label className="text-xs text-muted"><span>Premium per share (manual quote)</span><div className="mt-1 flex rounded-xl border border-border bg-surface-2 px-3"><span className="my-auto">$</span><input type="number" min={0} step={.01} value={premium} onChange={(e) => setPremium(Math.max(0, +e.target.value))} className="num w-full bg-transparent py-2.5 pl-1 outline-none"/></div></label><label className="text-xs text-muted"><span>Contract rounding</span><select value={rounding} onChange={(e) => setRounding(e.target.value as typeof rounding)} className="mt-1 w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink"><option value="down">Down · avoid overhedging</option><option value="nearest">Nearest 100 shares</option><option value="up">Up · meet requested coverage</option></select></label></div>{daysToExpiry != null && daysToExpiry <= 0 && <div className="mt-4 rounded-lg border border-neg/30 bg-neg/10 p-3 text-xs text-neg">Expiration must be in the future.</div>}{contracts === 0 && <div className="mt-4 rounded-lg border border-[#5a3a16] bg-[#38240f]/70 p-3 text-xs text-[#e7c88f]">This position and coverage produce fewer than 100 protected shares. Choose round up to model one contract.</div>}</div><div className="card p-5"><div className="grid grid-cols-2 gap-5 lg:grid-cols-4"><SummaryMetric label="Suggested strike" value={usd(strike)} /><SummaryMetric label="Contracts" value={String(contracts)} /><SummaryMetric label="Shares protected" value={`${coveredShares} / ${p.shares}`} /><SummaryMetric label="Shares uncovered" value={String(uncoveredShares)} tone={uncoveredShares > 0 ? 'warn' : undefined} /><SummaryMetric label="Premium cost" value={usd(premiumCost)} /><SummaryMetric label="Break-even at expiry" value={usd(breakEvenPrice)} /><SummaryMetric label="Maximum modeled loss" value={`${usd(maxLoss)} · ${pct(maxLossPct * 100)}`} tone={maxLossPct > drawdown / 100 ? 'warn' : undefined} /><SummaryMetric label="Effective floor / share" value={usd(effectiveFloor)} /><SummaryMetric label="Premium drag" value={pct(premiumDrag * 100)} tone={premiumDrag > .03 ? 'warn' : undefined} /><SummaryMetric label="Annualized drag" value={annualizedDrag == null ? 'Select expiry' : pct(annualizedDrag * 100)} tone={annualizedDrag != null && annualizedDrag > .05 ? 'warn' : undefined} /><SummaryMetric label="Protected notional" value={usd(protectedValue)} /><SummaryMetric label="Current position" value={usd(positionValue)} /></div>{overhedgedShares > 0 && <div className="mt-4 rounded-lg border border-[#5a3a16] bg-[#38240f]/70 p-3 text-xs text-[#e7c88f]">This rounds above the holding by {overhedgedShares} shares. Results below the strike include that extra put exposure.</div>}</div><div className="card overflow-x-auto p-0"><div className="p-5"><h3 className="font-semibold">Expiration scenario analysis</h3><p className="mt-1 text-xs text-faint">Intrinsic value at expiration only. Excludes taxes, commissions, dividends, volatility, and early sale value.</p></div><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-y border-border-soft text-xs text-muted"><th className="px-5 py-3 text-left">Underlying move</th><th className="px-4 py-3 text-right">Price</th><th className="px-4 py-3 text-right">Stock + put value</th><th className="px-5 py-3 text-right">Net P/L after premium</th></tr></thead><tbody>{scenarios.map((row) => <tr key={row.move} className="border-b border-border-soft"><td className={clsx('px-5 py-3 font-semibold', row.move < 0 ? 'text-neg' : row.move > 0 ? 'text-pos' : '')}>{row.move > 0 ? '+' : ''}{row.move}%</td><td className="num px-4 py-3 text-right">{usd(row.expirationPrice)}</td><td className="num px-4 py-3 text-right">{usd(row.terminalValue)}</td><td className={clsx('num px-5 py-3 text-right', row.pnl >= 0 ? 'text-pos' : 'text-neg')}>{usd(row.pnl, { sign: true })} · {pct(row.returnPct * 100)}</td></tr>)}</tbody></table></div><div className="card p-5"><div className="rounded-xl border border-[#c7a96b]/20 bg-[#c7a96b]/5 p-4"><div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#cbb77f]">Reviewable hedge ticket</div><div className="num mt-2 break-words text-sm">{ticket}</div><div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-faint">Confirm the option multiplier, deliverable, liquidity, expiration, strike, and live premium in Schwab. Maximum loss assumes the hedge is held through expiration.</p><Button onClick={copy} disabled={!contracts || !expiry || daysToExpiry == null || daysToExpiry <= 0}>{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? 'Copied' : 'Copy ticket'}</Button></div></div></div></div>
}

function OrderQueue({
  items,
  wholeShares,
  accounts,
  orderAccount,
  setOrderAccount,
  live,
  capacity,
}: {
  items: { symbol: string; name: string; bucket: Bucket; price: number; shares: number; spend: number }[]
  wholeShares: boolean
  accounts: { id: string; name: string; mask: string; cash: number; buyingPower?: number }[]
  orderAccount: string
  setOrderAccount: (id: string) => void
  live: boolean
  capacity: MarginCapacity | null
}) {
  const [placed, setPlaced] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState<string | null>(null)
  const [review, setReview] = useState<{
    key: string
    item: (typeof items)[number]
    requestId: string
    order: EquityOrder
    preview?: unknown
    orderId?: string
    status?: string
    error?: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  type BatchRow = {
    key: string
    item: (typeof items)[number]
    requestId: string
    order: EquityOrder
    state: 'pending' | 'previewing' | 'ready' | 'submitting' | 'accepted' | 'failed' | 'not_attempted'
    preview?: unknown
    orderId?: string
    status?: string
    error?: string
  }
  const [batch, setBatch] = useState<{
    accountId: string
    accountName: string
    rows: BatchRow[]
    stage: 'edit' | 'review' | 'submitting' | 'complete'
  } | null>(null)
  const accName = accounts.find((a) => a.id === orderAccount)?.name ?? 'your account'

  const toggleSelected = (k: string) =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k)
      else if (n.size < 40) n.add(k)
      return n
    })
  const doCopy = async (k: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(k)
      setTimeout(() => setCopied((c) => (c === k ? null : c)), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  const line = (it: (typeof items)[number]) =>
    `BUY ${wholeShares ? it.shares : `~${it.shares}`} ${it.symbol} @ market (${accName}) ≈ ${usd(it.spend)}`
  const copyAll = () => doCopy('__all__', items.map(line).join('\n'))

  const totalSpend = items.reduce((s, it) => s + it.spend, 0)

  const readableError = (error: unknown) => {
    if (typeof error === 'string') return error.replaceAll('_', ' ')
    try { return JSON.stringify(error) } catch { return 'Order request failed' }
  }
  const buildOrder = (it: (typeof items)[number], orderType: 'MARKET' | 'LIMIT' = 'LIMIT'): EquityOrder => ({
    session: 'NORMAL',
    duration: 'DAY',
    orderType,
    ...(orderType === 'LIMIT' ? { price: it.price.toFixed(2) } : {}),
    orderStrategyType: 'SINGLE',
    orderLegCollection: [{
      instruction: 'BUY',
      quantity: it.shares,
      instrument: { symbol: it.symbol.toUpperCase(), assetType: 'EQUITY' },
    }],
  })
  const openOrder = (key: string, item: (typeof items)[number]) =>
    setReview({ key, item, requestId: crypto.randomUUID(), order: buildOrder(item) })
  const previewOrder = async () => {
    if (!review) return
    const requestId = review.requestId
    setBusy(true)
    const result = await schwabPreviewOrder(orderAccount, requestId, review.order)
    setBusy(false)
    setReview((current) => current?.requestId === requestId
      ? { ...current, preview: result.ok ? result.preview ?? {} : undefined, error: result.ok ? undefined : readableError(result.error) }
      : current)
  }
  const placeOrder = async () => {
    if (!review || review.preview === undefined) return
    setBusy(true)
    const result = await schwabPlaceOrder(orderAccount, review.requestId, review.order)
    if (!result.ok) {
      setBusy(false)
      setReview((current) => current ? { ...current, error: readableError(result.error) } : current)
      return
    }
    const orderId = result.orderId!
    setPlaced((prev) => new Set(prev).add(review.key))
    setReview((current) => current ? { ...current, orderId, status: result.status ?? 'ACCEPTED', error: undefined } : current)
    await new Promise((resolve) => setTimeout(resolve, 3000))
    const status = await schwabOrderStatus(orderAccount, orderId)
    setBusy(false)
    setReview((current) => current?.orderId === orderId
      ? { ...current, status: status.ok ? status.status ?? 'UNKNOWN' : current.status, error: status.ok ? undefined : `Status check: ${readableError(status.error)}` }
      : current)
  }

  const eligibleItems = items.filter((it) => !placed.has(it.symbol + it.bucket))
  const selectedItems = eligibleItems.filter((it) => selected.has(it.symbol + it.bucket))
  const selectAll = () => {
    const eligible = eligibleItems.slice(0, 40).map((it) => it.symbol + it.bucket)
    setSelected((current) => current.size === eligible.length && eligible.every((key) => current.has(key))
      ? new Set()
      : new Set(eligible))
  }
  const openBulk = () => {
    if (!selectedItems.length) return
    setBatch({
      accountId: orderAccount,
      accountName: accName,
      stage: 'edit',
      rows: selectedItems.map((item) => ({
        key: item.symbol + item.bucket,
        item,
        requestId: crypto.randomUUID(),
        order: buildOrder(item, 'LIMIT'),
        state: 'pending',
      })),
    })
  }
  const setBatchRow = (key: string, update: Partial<BatchRow>) =>
    setBatch((current) => current ? {
      ...current,
      rows: current.rows.map((row) => row.key === key ? { ...row, ...update } : row),
    } : current)
  const previewBulk = async () => {
    if (!batch) return
    const rows: BatchRow[] = batch.rows.map((row) => ({
      ...row,
      requestId: crypto.randomUUID(),
      state: 'pending',
      preview: undefined,
      error: undefined,
    }))
    setBatch({ ...batch, rows, stage: 'edit' })
    setBusy(true)
    for (const row of rows) {
      setBatchRow(row.key, { state: 'previewing' })
      const result = await schwabPreviewOrder(batch.accountId, row.requestId, row.order)
      if (result.ok) {
        row.state = 'ready'
        row.preview = result.preview ?? {}
        setBatchRow(row.key, { state: 'ready', preview: row.preview, error: undefined })
      } else {
        row.state = 'failed'
        row.error = readableError(result.error)
        setBatchRow(row.key, { state: 'failed', error: row.error })
      }
    }
    setBusy(false)
    setBatch((current) => current ? { ...current, stage: 'review' } : current)
  }
  const submitBulk = async () => {
    if (!batch || batch.rows.some((row) => row.state !== 'ready')) return
    const rows = batch.rows.map((row) => ({ ...row }))
    setBusy(true)
    setBatch({ ...batch, rows, stage: 'submitting' })
    const accepted: BatchRow[] = []
    let stopped = false
    for (const row of rows) {
      if (stopped) {
        row.state = 'not_attempted'
        setBatchRow(row.key, { state: 'not_attempted' })
        continue
      }
      row.state = 'submitting'
      setBatchRow(row.key, { state: 'submitting' })
      const result = await schwabPlaceOrder(batch.accountId, row.requestId, row.order)
      if (!result.ok || !result.orderId) {
        row.state = 'failed'
        row.error = readableError(result.error)
        setBatchRow(row.key, { state: 'failed', error: row.error })
        stopped = true
        continue
      }
      row.state = 'accepted'
      row.orderId = result.orderId
      row.status = result.status ?? 'ACCEPTED'
      accepted.push(row)
      setPlaced((current) => new Set(current).add(row.key))
      setSelected((current) => {
        const next = new Set(current)
        next.delete(row.key)
        return next
      })
      setBatchRow(row.key, { state: 'accepted', orderId: row.orderId, status: row.status })
    }
    if (accepted.length) {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      for (const row of accepted) {
        const result = await schwabOrderStatus(batch.accountId, row.orderId!)
        row.status = result.ok ? result.status ?? 'UNKNOWN' : row.status
        setBatchRow(row.key, {
          status: row.status,
          error: result.ok ? undefined : `Status check: ${readableError(result.error)}`,
        })
      }
    }
    setBusy(false)
    setBatch((current) => current ? { ...current, stage: 'complete' } : current)
  }

  const batchExposure = batch?.rows.reduce(
    (sum, row) => sum + row.item.shares * Number(row.order.price ?? row.item.price),
    0,
  ) ?? 0
  const batchAccount = accounts.find((account) => account.id === batch?.accountId)
  const batchFunding = batchAccount?.buyingPower ?? batchAccount?.cash ?? 0
  const batchCapacity = batch?.accountId === orderAccount ? capacity : null
  const batchOverCapacity = !!batchCapacity && batchExposure > batchCapacity.maxOrderSpend + 0.005
  const allBatchReady = !!batch?.rows.length && batch.rows.every((row) => row.state === 'ready')

  return (
    <div className="mt-4 card p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <ClipboardList size={18} className="text-brand" />
        <h3 className="text-lg font-semibold">Order Queue</h3>
        <span className={clsx('rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide', live ? 'bg-pos/10 text-pos' : 'bg-[#c7a96b]/10 text-[#d8bd7a]')}>{live ? 'Live Schwab orders' : 'Planning only'}</span>
        <span className="text-xs text-faint">{placed.size}/{items.length} placed · ≈ {usd(totalSpend)}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted">Account</span>
          <select
            value={orderAccount}
            onChange={(e) => setOrderAccount(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm text-ink outline-none"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ····{a.mask}</option>
            ))}
          </select>
          <Button onClick={copyAll}>
            {copied === '__all__' ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy all</>}
          </Button>
        </div>
      </div>
      <p className="mb-3 text-xs text-faint">
        Buys from the calculator above, queued for review. Individual orders may be limit or market; bulk submission is limit-only and stops on the first failure.
      </p>

      {items.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border-soft bg-surface-2/40 p-2.5 text-xs">
          <label className="flex cursor-pointer items-center gap-2 text-muted">
            <input
              type="checkbox"
              checked={eligibleItems.length > 0 && selected.size === Math.min(eligibleItems.length, 40)}
              onChange={selectAll}
              className="h-4 w-4 accent-[#4d8dff]"
            />
            Select {eligibleItems.length > 40 ? 'first 40' : 'all'}
          </label>
          <span className="text-faint">{selectedItems.length} selected · max 40</span>
          <Button
            variant="primary"
            disabled={!live || !wholeShares || !orderAccount || selectedItems.length === 0}
            onClick={openBulk}
            className="ml-auto py-1.5 text-xs"
          >
            <ListChecks size={14} /> Bulk review
          </Button>
        </div>
      )}

      {!live && (
        <div className="mb-3 rounded-lg border border-[#3a2a12] bg-[#241a0c]/60 p-3 text-xs text-[#e7c88f]">
          Live ordering is available only after loading a live Schwab sync. Sample and imported accounts stay review-only.
        </div>
      )}

      {items.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted">
          Nothing to buy at this contribution — you're at or above target everywhere. Raise the contribution above to generate orders.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const k = it.symbol + it.bucket
            return (
              <div key={k} className="flex flex-wrap items-center gap-3 rounded-lg border border-border-soft bg-surface-2/40 px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  title="Select for bulk review"
                  checked={selected.has(k)}
                  disabled={placed.has(k)}
                  onChange={() => toggleSelected(k)}
                  className="h-4 w-4 accent-[#4d8dff] disabled:opacity-40"
                />
                <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-[#123024] text-[#3fd88a]">BUY</span>
                <span className="num font-semibold">{wholeShares ? it.shares : `~${it.shares}`}</span>
                <span className="font-semibold">{it.symbol}</span>
                <span className="text-xs text-faint">@ market · {usd(it.price)}</span>
                <span className="rounded-md px-1.5 py-0.5 text-[10px]" style={{ background: BUCKET_COLOR[it.bucket] + '22', color: BUCKET_COLOR[it.bucket] }}>{it.bucket}</span>
                <span className={clsx('num ml-auto', placed.has(k) && 'text-faint line-through')}>≈ {usd(it.spend)}</span>
                <button
                  onClick={() => doCopy(k, line(it))}
                  className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-muted hover:text-ink"
                >
                  {copied === k ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                </button>
                <Button
                  variant="primary"
                  disabled={!live || !wholeShares || placed.has(k) || !orderAccount}
                  onClick={() => openOrder(k, it)}
                  className="py-1 text-[11px]"
                >
                  <ShieldCheck size={12} /> Preview
                </Button>
              </div>
            )
          })}
        </div>
      )}


      <Modal
        open={!!review}
        onClose={() => !busy && setReview(null)}
        title={review?.orderId ? 'Order submitted' : 'Review Schwab order'}
        subtitle="One confirmation submits one order. Review every field before continuing."
        footer={review && !review.orderId ? (
          <>
            <Button onClick={() => setReview(null)} disabled={busy}>Cancel</Button>
            <Button
              variant="primary"
              onClick={review.preview === undefined ? previewOrder : placeOrder}
              disabled={busy}
            >
              {busy
                ? <><LoaderCircle size={14} className="animate-spin" /> Working…</>
                : review.preview === undefined ? 'Preview with Schwab' : 'Confirm & place order'}
            </Button>
          </>
        ) : review?.orderId ? <Button onClick={() => setReview(null)} disabled={busy}>Close</Button> : undefined}
      >
        {review && (
          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-border-soft bg-surface-2/50 p-4">
              <div className="flex items-center justify-between"><span className="text-muted">Account</span><span>{accName}</span></div>
              <div className="mt-2 flex items-center justify-between"><span className="text-muted">Action</span><span className="font-semibold text-pos">BUY</span></div>
              <div className="mt-2 flex items-center justify-between"><span className="text-muted">Security</span><span className="font-semibold">{review.item.symbol}</span></div>
              <div className="mt-2 flex items-center justify-between"><span className="text-muted">Quantity</span><span className="num font-semibold">{review.item.shares} whole shares</span></div>
              <div className="mt-2 flex items-center justify-between gap-4">
                <span className="text-muted">Order type</span>
                <select
                  value={review.order.orderType}
                  disabled={busy || review.preview !== undefined}
                  onChange={(e) => {
                    const orderType = e.target.value as 'MARKET' | 'LIMIT'
                    setReview((current) => current ? {
                      ...current,
                      requestId: crypto.randomUUID(),
                      order: buildOrder(current.item, orderType),
                      preview: undefined,
                      error: undefined,
                    } : current)
                  }}
                  className="rounded-lg border border-border bg-surface px-2 py-1 text-ink disabled:opacity-60"
                >
                  <option value="LIMIT">Limit (recommended)</option>
                  <option value="MARKET">Market</option>
                </select>
              </div>
              {review.order.orderType === 'LIMIT' && (
                <div className="mt-2 flex items-center justify-between gap-4">
                  <span className="text-muted">Limit price</span>
                  <div className="flex items-center rounded-lg border border-border bg-surface px-2">
                    <span className="text-faint">$</span>
                    <input
                      type="number"
                      min="0.01"
                      max="1000000"
                      step="0.01"
                      value={review.order.price ?? ''}
                      disabled={busy || review.preview !== undefined}
                      onChange={(e) => setReview((current) => current ? {
                        ...current,
                        requestId: crypto.randomUUID(),
                        order: { ...current.order, price: e.target.value },
                        preview: undefined,
                        error: undefined,
                      } : current)}
                      className="num w-24 bg-transparent py-1 text-right outline-none disabled:opacity-60"
                    />
                  </div>
                </div>
              )}
              <div className="mt-2 flex items-center justify-between"><span className="text-muted">Timing</span><span>Day · Regular session</span></div>
              <div className="mt-2 flex items-center justify-between"><span className="text-muted">Calculator estimate</span><span className="num">≈ {usd(review.item.spend)}</span></div>
            </div>
            {busy && !review.preview && <div className="flex items-center gap-2 text-muted"><LoaderCircle size={15} className="animate-spin" /> Requesting Schwab preview…</div>}
            {review.preview !== undefined && !review.orderId && (
              <div className="rounded-lg border border-[#17472f] bg-[#123024]/70 p-3">
                <div className="font-semibold text-pos">Schwab preview passed</div>
                <p className="mt-1 text-xs text-muted">Schwab accepted this payload for preview. Confirming below sends the live order.</p>
                {Object.keys(review.preview as object).length > 0 && (
                  <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Preview details</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(review.preview, null, 2)}</pre></details>
                )}
              </div>
            )}
            {review.orderId && (
              <div className="rounded-lg border border-[#17472f] bg-[#123024]/70 p-3">
                <div className="font-semibold text-pos">Accepted by Schwab</div>
                <div className="mt-1 text-xs">Order ID: <span className="num">{review.orderId}</span> · Status: <span className="font-semibold">{review.status}</span></div>
                {busy && <div className="mt-2 flex items-center gap-2 text-xs text-muted"><LoaderCircle size={13} className="animate-spin" /> Checking order status…</div>}
              </div>
            )}
            {review.error && <div className="rounded-lg border border-[#5a2631] bg-[#33161d] p-3 text-sm text-[#f2607a]">{review.error}</div>}
            {!wholeShares && <div className="text-xs text-[#f0a94a]">Switch the calculator to whole shares before previewing an order.</div>}
          </div>
        )}
      </Modal>

      <Modal
        open={!!batch}
        onClose={() => !busy && setBatch(null)}
        title={batch?.stage === 'complete' ? 'Bulk order results' : 'Bulk Schwab review'}
        subtitle="Limit orders are previewed and submitted one at a time. Submission stops on the first failure."
        width="max-w-3xl"
        footer={batch ? (
          <>
            <Button onClick={() => setBatch(null)} disabled={busy}>{batch.stage === 'complete' ? 'Close' : 'Cancel'}</Button>
            {batch.stage !== 'complete' && batch.stage !== 'submitting' && (
              <Button
                variant="primary"
                disabled={busy || (batch.stage === 'review' && (!allBatchReady || batchOverCapacity))}
                onClick={batch.stage === 'review' && allBatchReady ? submitBulk : previewBulk}
              >
                {busy
                  ? <><LoaderCircle size={14} className="animate-spin" /> Working…</>
                  : batch.stage === 'review' && allBatchReady
                    ? `Confirm & submit ${batch.rows.length} orders`
                    : `Preview ${batch.rows.length} orders`}
              </Button>
            )}
          </>
        ) : undefined}
      >
        {batch && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-surface-2 p-3"><div className="text-xs text-faint">ACCOUNT</div><div className="mt-1 font-semibold">{batch.accountName}</div></div>
              <div className="rounded-lg bg-surface-2 p-3"><div className="text-xs text-faint">ORDERS</div><div className="num mt-1 font-semibold">{batch.rows.length}</div></div>
              <div className="rounded-lg bg-surface-2 p-3"><div className="text-xs text-faint">LIMIT EXPOSURE</div><div className="num mt-1 font-semibold">{usd(batchExposure)}</div></div>
              <div className="rounded-lg bg-surface-2 p-3"><div className="text-xs text-faint">{batchAccount?.buyingPower != null ? 'BUYING POWER' : 'CASH'}</div><div className="num mt-1 font-semibold">{usd(batchFunding)}</div></div>
            </div>
            {batchCapacity && (
              <div className={clsx(
                'rounded-lg border p-3 text-xs',
                batchOverCapacity
                  ? 'border-[#5a2631] bg-[#33161d] text-[#f2607a]'
                  : 'border-[#17472f] bg-[#123024]/60 text-[#8fe3b5]',
              )}>
                50% minimum equity: {usd(batchCapacity.maxOrderSpend)} maximum order spend · projected equity after this batch: {pct((1 - batchCapacity.projectedUsage(batchExposure)) * 100)}
                {batchOverCapacity && <span className="ml-2 font-semibold">Over by {usd(batchExposure - batchCapacity.maxOrderSpend)}. Submission is disabled.</span>}
              </div>
            )}
            {batchExposure > batchFunding && (
              <div className="flex items-start gap-2 rounded-lg border border-[#5a3a16] bg-[#38240f] p-3 text-xs text-[#f0a94a]">
                <CircleAlert size={15} className="mt-0.5 shrink-0" /> Limit exposure exceeds the account’s reported {batchAccount?.buyingPower != null ? 'buying power' : 'cash'} by {usd(batchExposure - batchFunding)}. Schwab may reject one or more orders.
              </div>
            )}
            <div className="max-h-[48vh] overflow-y-auto rounded-xl border border-border-soft">
              <table className="w-full min-w-[650px] text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-left text-xs text-muted">
                    <th className="px-3 py-2">Symbol</th><th className="px-3 py-2 text-right">Shares</th><th className="px-3 py-2 text-right">Limit</th><th className="px-3 py-2 text-right">Exposure</th><th className="px-3 py-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.rows.map((row) => (
                    <tr key={row.key} className="border-t border-border-soft">
                      <td className="px-3 py-2 font-semibold">{row.item.symbol}</td>
                      <td className="num px-3 py-2 text-right">{row.item.shares}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center rounded border border-border bg-surface-2 px-1.5">
                          <span className="text-faint">$</span>
                          <input
                            type="number" min="0.01" max="1000000" step="0.01"
                            value={row.order.price ?? ''}
                            disabled={busy || batch.stage === 'submitting' || batch.stage === 'complete'}
                            onChange={(e) => setBatchRow(row.key, {
                              requestId: crypto.randomUUID(),
                              order: { ...row.order, price: e.target.value },
                              state: 'pending', preview: undefined, error: undefined,
                            })}
                            className="num w-20 bg-transparent py-1 text-right outline-none disabled:opacity-60"
                          />
                        </div>
                      </td>
                      <td className="num px-3 py-2 text-right">{usd(row.item.shares * Number(row.order.price ?? 0))}</td>
                      <td className="px-3 py-2 text-xs">
                        {row.state === 'pending' && <span className="text-faint">Ready to preview</span>}
                        {(row.state === 'previewing' || row.state === 'submitting') && <span className="flex items-center gap-1 text-muted"><LoaderCircle size={12} className="animate-spin" /> {row.state === 'previewing' ? 'Previewing' : 'Submitting'}</span>}
                        {row.state === 'ready' && <span className="font-semibold text-pos">Preview passed</span>}
                        {row.state === 'accepted' && <span className="font-semibold text-pos">{row.status} · #{row.orderId}</span>}
                        {row.state === 'failed' && <span className="text-neg">{row.error || 'Failed'}</span>}
                        {row.state === 'not_attempted' && <span className="text-[#f0a94a]">Not attempted</span>}
                        {row.error && row.state === 'accepted' && <div className="mt-1 text-[#f0a94a]">{row.error}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {batch.stage === 'review' && allBatchReady && (
              <div className="rounded-lg border border-[#17472f] bg-[#123024]/70 p-3 text-xs text-muted">
                All {batch.rows.length} previews passed. The next confirmation submits these live orders sequentially.
              </div>
            )}
            {batch.stage === 'review' && !allBatchReady && (
              <div className="rounded-lg border border-[#5a2631] bg-[#33161d] p-3 text-xs text-[#f2607a]">
                One or more previews failed. No orders were submitted. Correct the limit prices or selection, then preview again.
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

function RebalanceInsights({
  insights,
  accName,
  hasData,
}: {
  insights: HoldingInsight[]
  accName: (id: string) => string
  hasData: boolean
}) {
  const [placed, setPlaced] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState<string | null>(null)
  const togglePlaced = (k: string) =>
    setPlaced((prev) => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  const copy = async (k: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(k)
      setTimeout(() => setCopied((c) => (c === k ? null : c)), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const trims = insights.filter((h) => h.action === 'Trim')
  const counts = {
    strong: insights.filter((h) => h.signal === 'strong').length,
    weak: insights.filter((h) => h.signal === 'weak' || h.signal === 'caution').length,
  }

  return (
    <div className="mt-4 card p-5">
      <div className="mb-1 flex items-center gap-2">
        <Activity size={18} className="text-brand" />
        <h3 className="text-lg font-semibold">Rebalance Insights</h3>
        <span className="ml-2 rounded-md bg-surface-2 px-2 py-0.5 text-xs text-faint">50 / 100 / 200-day SMA</span>
      </div>
      <p className="mb-4 text-xs text-faint">
        Each holding scored against its moving averages. Price above the 200-day with the averages stacked (50 &gt; 100 &gt; 200) signals a healthy uptrend; below the 200-day and stacked the other way flags weakness. Weakest first.
      </p>

      {!hasData && (
        <div className="mb-4 rounded-lg border border-border-soft bg-surface-2/40 p-3 text-xs text-faint">
          Moving averages are built from Schwab price history on sync. Connect and sync a live account to populate signals.
        </div>
      )}

      {insights.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted">No holdings to analyze.</div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-md bg-[#123024] px-2 py-1 font-medium text-[#3fd88a]">{counts.strong} in strong uptrend</span>
            <span className="rounded-md bg-[#33161d] px-2 py-1 font-medium text-[#f2607a]">{counts.weak} weak / caution</span>
            <span className="rounded-md bg-surface-2 px-2 py-1 font-medium text-muted">{trims.length} trim candidate{trims.length === 1 ? '' : 's'}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-y border-border-soft text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Holding</th>
                  <th className="px-3 py-2.5 text-right font-medium">Price</th>
                  <th className="px-3 py-2.5 text-right font-medium">vs 50d</th>
                  <th className="px-3 py-2.5 text-right font-medium">vs 100d</th>
                  <th className="px-3 py-2.5 text-right font-medium">vs 200d</th>
                  <th className="px-3 py-2.5 text-center font-medium">Signal</th>
                  <th className="px-4 py-2.5 text-center font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {insights.map((h) => (
                  <tr key={h.accountId + h.symbol} className="border-b border-border-soft last:border-0 hover:bg-surface-2/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{h.symbol}</span>
                        <span className="text-xs text-faint">{accName(h.accountId)}</span>
                      </div>
                      <div className="max-w-[220px] truncate text-xs text-faint">{h.note || h.name}</div>
                    </td>
                    <td className="num px-3 py-3 text-right">{usd(h.price)}</td>
                    <VsCell v={h.vs50} />
                    <VsCell v={h.vs100} />
                    <VsCell v={h.vs200} />
                    <td className="px-3 py-3 text-center">
                      <span className={clsx('rounded-md px-2 py-0.5 text-[11px] font-medium', SIGNAL_STYLE[h.signal].cls)}>
                        {SIGNAL_STYLE[h.signal].label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={clsx('rounded-md border px-2 py-0.5 text-[11px] font-semibold', ACTION_STYLE[h.action])}>
                        {h.action}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Suggested sell tickets for trim candidates */}
          {trims.length > 0 && (
            <div className="mt-5 rounded-xl border border-[#3a2a12] bg-[#241a0c]/60 p-4">
              <div className="mb-1 flex items-center gap-2">
                <ClipboardList size={16} className="text-[#f0a94a]" />
                <h4 className="font-semibold text-[#e7c88f]">Suggested Sell Tickets</h4>
                <span className="text-xs text-faint">{placed.size}/{trims.length} placed</span>
              </div>
              <p className="mb-3 text-xs text-[#e7c88f]/80">
                Holdings below their 200-day trend. Review each, place it in your brokerage, and check it off. <span className="font-semibold">This app never places orders for you.</span>
              </p>
              <div className="space-y-2">
                {trims.map((h) => {
                  const k = h.accountId + h.symbol
                  const ticket = `SELL ${h.shares} ${h.symbol} @ market (${accName(h.accountId)}) ≈ ${usd(h.value)}`
                  return (
                    <div key={k} className="flex flex-wrap items-center gap-3 rounded-lg border border-border-soft bg-surface px-3 py-2.5 text-sm">
                      <input type="checkbox" checked={placed.has(k)} onChange={() => togglePlaced(k)} className="h-4 w-4 accent-[#3fd88a]" />
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-[#33161d] text-[#f2607a]">SELL</span>
                      <span className="num font-semibold">{h.shares}</span>
                      <span className="font-semibold">{h.symbol}</span>
                      <span className="text-xs text-faint">@ market · {accName(h.accountId)}</span>
                      <TrendingDown size={13} className="text-[#f2607a]" />
                      <span className={clsx('num ml-auto', placed.has(k) && 'text-faint line-through')}>≈ {usd(h.value)}</span>
                      <button
                        onClick={() => copy(k, ticket)}
                        className="flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] font-medium text-muted hover:text-ink"
                      >
                        {copied === k ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <p className="mt-4 text-xs text-faint">
            Signals are technical (trend-following) and informational — not investment advice. Moving averages lag price and can whipsaw in choppy markets. You decide and place every trade.
          </p>
        </>
      )}
    </div>
  )
}

function VsCell({ v }: { v: number | null }) {
  if (v == null) return <td className="num px-3 py-3 text-right text-faint">—</td>
  return (
    <td className={clsx('num px-3 py-3 text-right', v >= 0 ? 'text-pos' : 'text-neg')}>
      {v >= 0 ? '+' : ''}{(v * 100).toFixed(1)}%
    </td>
  )
}

function DonutCard({
  title,
  subtitle,
  slices,
  labels,
}: {
  title: string
  subtitle: string
  slices: { name: string; value: number }[]
  labels: (b: Bucket) => string
}) {
  const has = slices.some((s) => s.value > 0)
  return (
    <div className="card p-5">
      <div className="mb-2 flex items-center gap-2">
        <Target size={16} className="text-brand" />
        <h3 className="font-semibold">{title}</h3>
        <span className="ml-auto text-xs text-faint">{subtitle}</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="h-40 w-40 shrink-0">
          {has ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices.filter((s) => s.value > 0)} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={2} stroke="none">
                  {slices.filter((s) => s.value > 0).map((s) => (
                    <Cell key={s.name} fill={BUCKET_COLOR[s.name as Bucket]} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }: any) =>
                    active && payload?.length ? (
                      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-xl">
                        <span className="font-semibold">{payload[0].name}</span>
                      </div>
                    ) : null
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center text-xs text-faint">—</div>
          )}
        </div>
        <div className="flex-1 space-y-1.5">
          {BUCKETS.map((b) => (
            <div key={b} className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: BUCKET_COLOR[b] }} />
              <span className="text-muted">{b}</span>
              <span className="num ml-auto font-semibold">{labels(b)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
