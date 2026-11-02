import { type ProtectionAiEvidence } from '../lib/portfolio-protection'
import { useReviewCache } from '../lib/use-review-cache'
import { AiAllocationReview } from '../components/AiAllocationReview'
import { allocationShortlistIsCurrent, buildAllocationEvidence, filterAllocationShortlist, type AiHedgeContext } from '../lib/ai-allocation'
import { SummaryMetric } from '../components/SummaryMetric'
import { protectionContextKey } from '../lib/protection-context'
import { useEffect, useMemo, useState } from 'react'
import { Target, Wand2, Eraser, Calculator, Activity, TrendingDown, Copy, Check, ClipboardList, ShieldCheck, LoaderCircle, ListChecks, CircleAlert, Lock, Unlock, Scale, ShoppingCart, ChevronRight } from 'lucide-react'
import { DEFAULT_INCOME_PLAN, useScoped, useStore } from '../lib/store'
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
import { dividendStats, portfolioSummary } from '../lib/calc'
import { brokerageDate } from '../lib/balance-snapshots'
import { allocationOrders, allocationProjection, allocationPriorityReason, compareAllocationPriority, type AllocationHolding, type AllocationSizing } from '../lib/allocation-engine'
import { contributionBudget } from '../lib/contribution-budget'

const roundWeights = (buckets: Record<Bucket, { weight: number }>): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const b of BUCKETS) out[b] = +(buckets[b].weight * 100).toFixed(1)
  return out
}

export default function Allocation() {
  const { positions, transactions, scope } = useScoped()
  const { data, setTargetAlloc, setPositionBucket, setIncomePlan } = useStore()

  const allocationPositions = useMemo(() => positions.filter((row) => !row.isOption && row.shares > 0), [positions])
  const stats = useMemo(() => bucketStats(allocationPositions, transactions), [allocationPositions, transactions])
  const { buckets, total, blendedYield } = stats
  const [tab, setTab] = useState<'targets' | 'plan' | 'orders'>('targets')
  const cacheScope = `${data.source ?? 'sample'}:${scope}`
  const [savedShortlists, setSavedShortlists, shortlistSaveError] = useReviewCache<Record<string, { symbols: string[]; key: string; expiresAt: number }>>('simonfire.ai.allocation.shortlists.v1', {})
  const aiShortlist = savedShortlists[cacheScope] ?? null
  const setAiShortlist = (selection: { symbols: string[]; key: string; expiresAt: number } | null) => setSavedShortlists((previous) => { const next = { ...previous }; if (selection) next[cacheScope] = selection; else delete next[cacheScope]; return next })
  const [evidenceClock, setEvidenceClock] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setEvidenceClock(Date.now()), 60000); return () => window.clearInterval(timer) }, [])
  // Hedge inputs and protection reviews are written by the Protection page.
  const [savedHedges] = useReviewCache<Record<string, AiHedgeContext>>('simonfire.ai.allocation.hedge-inputs.v1', {})
  const [savedProtectionReviews] = useReviewCache<Record<string, { context: string; value: ProtectionAiEvidence }>>('simonfire.ai.allocation.protection-review.v1', {})
  const aiHedge = savedHedges[cacheScope] ?? null
  const [locked, setLocked] = useState<Set<Bucket>>(new Set())
  const [showAllHoldings, setShowAllHoldings] = useState(false)

  const insights = useMemo(
    () => buildInsights(positions, data.insights?.bySymbol),
    [positions, data.insights],
  )

  // Unique tickers per bucket (dedupe symbols across accounts).
  const tickersByBucket = useMemo(() => {
    const m: Record<Bucket, AllocationHolding[]> = {
      Growth: [], CEFs: [], 'High Yield': [], Leveraged: [],
    }
    const income = new Map(dividendStats(allocationPositions, transactions, brokerageDate()).bySymbol.map((row) => [row.symbol, row.projAnnual]))
    const insightAge = Date.parse(brokerageDate()) - Date.parse(data.insights?.generatedAt ?? '')
    const trendScores = new Map(insights.filter((row) => row.available === 3 && insightAge >= -86_400_000 && insightAge <= 7 * 86_400_000).map((row) => [normTicker(row.symbol), { score: row.score, signal: row.signal }]))
    const symbolValues = new Map<string, number>()
    for (const p of allocationPositions) symbolValues.set(normTicker(p.symbol), (symbolValues.get(normTicker(p.symbol)) ?? 0) + p.shares * p.lastPrice)
    for (const p of allocationPositions) {
      const key = normTicker(p.symbol)
      const value = p.shares * p.lastPrice
      const annualIncome = (symbolValues.get(key) ?? 0) > 0 ? (income.get(key) ?? 0) * value / symbolValues.get(key)! : 0
      const existing = m[bucketOf(p)].find((row) => normTicker(row.symbol) === key)
      if (existing) { existing.value += value; existing.annualIncome += annualIncome }
      else m[bucketOf(p)].push({ symbol: p.symbol, name: p.name, price: p.lastPrice, value, annualIncome, trendScore: trendScores.get(key)?.score, trendSignal: trendScores.get(key)?.signal })
    }
    for (const b of BUCKETS) m[b].sort((a, z) => a.symbol.localeCompare(z.symbol))
    return m
  }, [allocationPositions, transactions, insights, data.insights?.generatedAt])

  // Target weights (persisted). Default to current allocation on first visit.
  const target = data.targetAlloc ?? roundWeights(buckets)

  const update = (next: Record<string, number>) => {
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
  const [savedInputs, setSavedInputs, inputSaveError] = useReviewCache<Record<string, { contribution: number; mode: 'contribution' | 'rebalance'; wholeShares: boolean; account: string }>>('simonfire.allocation.inputs.v1', {})
  const savedInput = savedInputs[cacheScope]
  const requestedContribution = savedInput?.contribution ?? 2000
  const planMode = savedInput?.mode ?? 'contribution'
  const wholeShares = savedInput?.wholeShares ?? true
  const patchInput = (patch: Partial<NonNullable<typeof savedInput>>) => setSavedInputs((previous) => ({ ...previous, [cacheScope]: { ...(previous[cacheScope] ?? { contribution: 2000, mode: 'contribution', wholeShares: true, account: scope !== 'all' ? scope : data.accounts[0]?.id ?? '' }), ...patch } }))
  const setContribution = (contribution: number) => patchInput({ contribution })
  const setPlanMode = (mode: 'contribution' | 'rebalance') => patchInput({ mode })
  const setWholeShares = (wholeShares: boolean) => patchInput({ wholeShares })
  const sizing = data.incomePlan?.allocationSizing ?? 'priority'
  const setSizing = (allocationSizing: AllocationSizing) => setIncomePlan({ ...DEFAULT_INCOME_PLAN, ...data.incomePlan, allocationSizing })
  const chosenOrderAccount = savedInput?.account ?? (scope !== 'all' ? scope : data.accounts[0]?.id ?? '')
  const setOrderAccount = (account: string) => patchInput({ account })
  const eligibleOrderAccounts = data.accounts.filter((account) => scope === 'all' || account.id === scope)
  const orderAccount = scope !== 'all' ? scope : eligibleOrderAccounts.some((account) => account.id === chosenOrderAccount) ? chosenOrderAccount : eligibleOrderAccounts[0]?.id ?? ''
  const selectedOrderAccount = data.accounts.find((account) => account.id === orderAccount)
  const capacities = useMemo(() => data.accounts.filter((account) => scope === 'all' || account.id === scope).map((account) => {
    const positionValue = data.positions
      .filter((position) => position.accountId === account.id)
      .reduce((sum, position) => sum + position.shares * position.lastPrice, 0)
    return { account, capacity: marginCapacity(account, positionValue)! }
  }), [data.accounts, data.positions, scope])
  const expenseReserveEnabled = data.incomePlan?.allocationExpenseReserve !== false
  const expenseBudget = useMemo(() => contributionBudget(selectedOrderAccount,
    data.positions.filter((row) => row.accountId === orderAccount).reduce((sum, row) => sum + row.shares * row.lastPrice, 0),
    data.transactions, brokerageDate(), data.spendingExclusions), [selectedOrderAccount, orderAccount, data.positions, data.transactions, data.spendingExclusions])
  const capacity = expenseReserveEnabled ? expenseBudget.reserved : expenseBudget.current
  const contribution = expenseReserveEnabled ? Math.min(requestedContribution, capacity?.maxOrderSpend ?? 0) : requestedContribution
  const spending = expenseBudget.spending

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
  const savedProtectionReview = savedProtectionReviews[cacheScope]
  const protectionReview = savedProtectionReview?.context === protectionContextKey(scope, positions, data.accounts) ? savedProtectionReview.value : null
  const aiEvidence = useMemo(() => ({...buildAllocationEvidence(positions, data.insights, target, contribution, brokerageDate(), data.source ?? 'sample', aiHedge, { marginDebt: data.accounts.filter((a) => scope === 'all' || a.id === scope).reduce((sum, a) => sum + a.marginBalance, 0), netEquity: portfolioSummary(positions, data.accounts, scope, transactions).net }, evidenceClock), ...(protectionReview ? {protectionReview} : {})}), [protectionReview, positions, data.insights, target, contribution, data.source, aiHedge, scope, data.accounts, transactions, evidenceClock])
  const aiPlanKey = JSON.stringify({ scope, positions, insightDate: data.insights?.generatedAt, target, contribution, sizing, planMode, wholeShares, orderAccount, expenseReserveEnabled, evidence: aiEvidence })
  const shortlistCurrent = allocationShortlistIsCurrent(aiShortlist, aiPlanKey, evidenceClock)
  const baseOrderQueue = useMemo(() => allocationOrders(plan, tickersByBucket, wholeShares, sizing), [plan, tickersByBucket, wholeShares, sizing])
  const orderQueue = filterAllocationShortlist(baseOrderQueue, shortlistCurrent ? aiShortlist!.symbols : null)
  const projection = useMemo(() => allocationProjection(tickersByBucket, orderQueue), [tickersByBucket, orderQueue])
  const sellPlan = useMemo(() => {
    if (planMode !== 'rebalance' || !balanced) return []
    const postValue = total + contribution
    return BUCKETS.map((bucket) => ({ bucket, amount: Math.max(0, buckets[bucket].value - postValue * ((target[bucket] ?? 0) / 100)) })).filter((row) => row.amount > .5)
  }, [planMode, balanced, total, contribution, buckets, target])

  const driftRows = BUCKETS.map((b) => ({ bucket: b, current: buckets[b].weight * 100, target: target[b] ?? 0, drift: buckets[b].weight * 100 - (target[b] ?? 0) }))
  const largestDrift = [...driftRows].sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))[0]
  const annualIncomeDelta = total * (targetBlended - blendedYield)
  const plannedSpend = orderQueue.reduce((sum, item) => sum + item.spend, 0)
  const contributionOverCapacity = !!capacity && plannedSpend > capacity.maxOrderSpend + 0.005
  const cashRemaining = Math.max(0, contribution - plannedSpend)
  const classificationRows = positions.map((p) => ({ position: p, ...bucketClassification(p) }))
  const fallbackCount = classificationRows.filter((r) => r.method === 'Growth fallback').length



  const selectedCapacity = capacities.find((row) => row.account.id === orderAccount)?.capacity
  const reserveNote = !expenseReserveEnabled ? 'No bill reserve.' : spending ? `${usd(spending.monthlyAverage)} held back for a month of bills.` : 'Needs a completed month of transactions to estimate bills.'
  const tabs = [['targets', Target, 'Targets'], ['plan', Calculator, 'Buy plan'], ['orders', ShoppingCart, 'Orders']] as const

  return (
    <div>
      <PageHeader
        title="Allocation"
        subtitle="Set your target mix, plan buys, then review orders"
        right={tab === 'targets' ?
          <>
            <Button onClick={resetFromCurrent}><Wand2 size={15} /> Reset from current</Button>
            <Button onClick={clearAll}><Eraser size={15} /> Clear all</Button>
          </> : undefined
        }
      />

      <div className="mb-5 flex overflow-x-auto rounded-xl border border-border bg-surface/70 p-1">
        {tabs.map(([key, Icon, label], i) => <button key={key} onClick={() => setTab(key)} className={clsx('flex min-w-max flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors', tab === key ? 'bg-[#c7a96b]/15 text-[#e1c887]' : 'text-muted hover:bg-white/[0.03] hover:text-ink')}><span className="text-xs text-faint">{i + 1}</span><Icon size={15} />{label}{key === 'orders' && orderQueue.length > 0 && <span className="num rounded-md bg-white/[.06] px-1.5 text-xs">{orderQueue.length}</span>}</button>)}
      </div>

      {(shortlistSaveError || inputSaveError) && <p role="alert" className="mb-4 text-xs text-neg">This browser could not save allocation settings. Keep the page open and check browser storage.</p>}

      {tab === 'targets' && <>
      <div className="card p-5">
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          <SummaryMetric label="Portfolio" value={usd(total, { cents: false })} />
          <SummaryMetric label="Largest drift" value={!largestDrift || Math.abs(largestDrift.drift) < .05 ? 'On target' : `${largestDrift.bucket} ${largestDrift.drift > 0 ? '+' : ''}${largestDrift.drift.toFixed(1)}%`} tone={largestDrift && Math.abs(largestDrift.drift) > 2 ? 'warn' : undefined} />
          <SummaryMetric label="Yield now → at target" value={`${pct(blendedYield * 100)} → ${pct(targetBlended * 100)}`} />
          <SummaryMetric label="Income impact / yr" value={usd(annualIncomeDelta, { sign: true })} tone={annualIncomeDelta >= 0 ? 'positive' : 'warn'} />
        </div>
        <p className="mt-3 text-[11px] text-faint">Yield is an estimate from recent distributions on shares held today, excluding options.</p>
      </div>


      <div className="card mt-4 p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-lg font-semibold">Target mix</h3>
          <select aria-label="Preset mix" value="" onChange={(e) => { if (e.target.value) scenario(e.target.value as 'income' | 'growth' | 'defensive' | 'current') }} className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
            <option value="">Presets…</option><option value="income">Income focus</option><option value="growth">Growth focus</option><option value="defensive">Reduce leverage</option><option value="current">Current mix</option>
          </select>
          {!balanced && <Button onClick={normalizeTargets}><Scale size={14} /> Make 100%</Button>}
          <span className={clsx('num rounded-md px-2 py-1 text-sm font-semibold', balanced ? 'bg-pos/10 text-pos' : 'bg-[#38240f] text-[#f0a94a]')}>{targetTotal.toFixed(1)}%</span>
        </div>
        <div className="space-y-2">
          {BUCKETS.map((b) => {
            const s = buckets[b]
            const drift = s.weight * 100 - (target[b] ?? 0)
            const hold = Math.abs(drift) < .5
            return (
              <div key={b} className="flex flex-wrap items-center gap-4 rounded-xl border border-border-soft bg-surface-2/40 p-3">
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: BUCKET_COLOR[b] }} />
                <div className="min-w-[140px]">
                  <div className="font-semibold">{b}</div>
                  <div className="text-xs text-faint">{usd(s.value, { cents: false })} · {intfmt(s.count)} holdings</div>
                </div>
                <div className="w-16 text-right text-xs"><div className="text-faint">Now</div><div className="num font-semibold">{pct(s.weight * 100)}</div></div>
                <span className={clsx('w-28 rounded-md px-2 py-1 text-center text-xs font-medium', hold ? 'bg-white/[.04] text-faint' : drift > 0 ? 'bg-neg/10 text-neg' : 'bg-pos/10 text-pos')}>{hold ? 'On target' : drift > 0 ? `Over ${drift.toFixed(1)}%` : `Under ${Math.abs(drift).toFixed(1)}%`}</span>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => setLocked((prev) => { const next = new Set(prev); if (next.has(b)) next.delete(b); else next.add(b); return next })} className={clsx('grid h-8 w-8 place-items-center rounded-lg border', locked.has(b) ? 'border-[#c7a96b]/40 bg-[#c7a96b]/10 text-[#d8bd7a]' : 'border-border text-faint')} title={locked.has(b) ? 'Unlock target' : 'Lock target'}>{locked.has(b) ? <Lock size={13} /> : <Unlock size={13} />}</button>
                  <input type="range" min={0} max={100} step={0.5} value={target[b] ?? 0} onChange={(e) => setBucket(b, +e.target.value)} disabled={locked.has(b)} className="w-36" style={{ accentColor: BUCKET_COLOR[b] }} aria-label={`${b} target`} />
                  <div className="flex items-center rounded-lg border border-border bg-surface px-2">
                    <input type="number" min={0} max={100} step={0.5} value={target[b] ?? 0} onChange={(e) => setBucket(b, +e.target.value)} disabled={locked.has(b)} className="w-14 bg-transparent py-1.5 text-right text-sm outline-none" />
                    <span className="text-xs text-faint">%</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <FallbackCorrections rows={classificationRows.filter((r) => r.method === 'Growth fallback')} accounts={data.accounts} onSetBucket={setPositionBucket} />
        <div className="mt-4 flex justify-end"><Button variant="primary" onClick={() => setTab('plan')} disabled={!balanced}>Next: plan buys <ChevronRight size={14} /></Button></div>
      </div>

      <details className="card mt-4 p-0">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-5 text-sm font-semibold"><ListChecks size={16} className="text-brand" />Holding details · bucket assignments and trend signals<ChevronRight size={16} className="ml-auto text-faint" /></summary>
        <div className="space-y-4 border-t border-border-soft p-4">
          <ClassificationReview rows={classificationRows} fallbackCount={fallbackCount} accounts={data.accounts} />
          <RebalanceInsights insights={insights} accName={(id) => data.accounts.find((a) => a.id === id)?.name ?? id} hasData={!!data.insights} />
        </div>
      </details>
      </>}

      {tab === 'plan' && <>
      {!balanced && <div className="mb-4 rounded-xl border border-[#5a3a16] bg-[#38240f]/70 p-3 text-sm text-[#e7c88f]">Targets add up to {targetTotal.toFixed(1)}%. <button className="font-semibold underline" onClick={() => setTab('targets')}>Fix targets</button> to see a plan.</div>}
      <div className="card p-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs text-muted">Amount to invest
            <div className="mt-1 flex items-center rounded-lg border border-border bg-surface-2 px-3">
              <span className="text-faint">$</span>
              <input aria-label="Investment budget" type="number" min={0} step={100} value={requestedContribution} onChange={(e) => setContribution(Math.max(0, +e.target.value))} className="num w-28 bg-transparent py-2 pl-1 text-sm text-ink outline-none" />
              {selectedCapacity && !selectedCapacity.alreadyOverLimit && <button onClick={() => setContribution(Math.floor(selectedCapacity.maxOrderSpend * 100) / 100)} className="ml-1 text-xs font-semibold text-brand">Max</button>}
            </div>
          </label>
          <label className="text-xs text-muted">Account
            <select aria-label="Order account" value={orderAccount} onChange={(e) => setOrderAccount(e.target.value)} disabled={eligibleOrderAccounts.length < 2} className="mt-1 block rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink">
              {eligibleOrderAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
          <div className="text-xs text-muted">Goal
            <div className="mt-1 flex rounded-lg border border-border bg-surface-2 p-0.5">
              <button onClick={() => setPlanMode('contribution')} className={clsx('rounded-md px-3 py-1.5 text-sm', planMode === 'contribution' ? 'bg-[#c7a96b]/15 text-[#e1c887]' : 'text-muted')}>Add money</button>
              <button onClick={() => setPlanMode('rebalance')} className={clsx('rounded-md px-3 py-1.5 text-sm', planMode === 'rebalance' ? 'bg-[#c7a96b]/15 text-[#e1c887]' : 'text-muted')}>Rebalance</button>
            </div>
          </div>
          <label className="text-xs text-muted">Pick buys by
            <select aria-label="Purchase sizing" value={sizing} onChange={(event) => setSizing(event.target.value as AllocationSizing)} className="mt-1 block rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink"><option value="priority">Stronger trends first</option><option value="gaps">Fill holding gaps</option><option value="trend">Fill gaps + trend tilt</option><option value="equal">Equal dollars</option></select>
          </label>
          <div className="text-xs text-muted">Shares
            <div className="mt-1 flex rounded-lg border border-border bg-surface-2 p-0.5">
              <button onClick={() => setWholeShares(true)} className={clsx('rounded-md px-3 py-1.5 text-sm', wholeShares ? 'bg-surface text-ink' : 'text-muted')}>Whole</button>
              <button onClick={() => setWholeShares(false)} className={clsx('rounded-md px-3 py-1.5 text-sm', !wholeShares ? 'bg-surface text-ink' : 'text-muted')}>Fractional</button>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-soft pt-4 text-xs">
          <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={expenseReserveEnabled} onChange={(event) => setIncomePlan({ ...DEFAULT_INCOME_PLAN, ...data.incomePlan, allocationExpenseReserve: event.target.checked })} className="accent-[#c7a96b]" />Hold back a month of bills</label>
          <span className="text-faint">{reserveNote}</span>
          <span className={clsx('ml-auto', contribution < requestedContribution ? 'text-[#e7c88f]' : 'text-muted')}>Usable budget <strong className="num">{usd(contribution)}</strong>{capacity ? <> · limit <span className="num">{usd(capacity.maxOrderSpend)}</span></> : null}</span>
        </div>
        {capacity && (contributionOverCapacity || capacity.alreadyOverLimit) && <div className="mt-3 rounded-lg border border-[#5a2631] bg-[#33161d] px-3 py-2 text-xs font-semibold text-[#f2607a]">{capacity.alreadyOverLimit ? `${selectedOrderAccount?.name} is already below 50% equity, so no new buys fit.` : `This plan is over ${selectedOrderAccount?.name}'s limit by ${usd(plannedSpend - capacity.maxOrderSpend)}.`}</div>}
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-semibold text-muted">Account limits and bill estimate</summary>
          <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SummaryMetric label="Avg monthly expenses" value={spending ? usd(spending.monthlyAverage) : 'Unavailable'} />
            <SummaryMetric label="Bills & withdrawals / mo" value={spending ? usd(spending.livingSpending / spending.months) : '—'} />
            <SummaryMetric label="Interest & fees / mo" value={spending ? usd((spending.marginInterest + spending.fees) / spending.months) : '—'} />
            <SummaryMetric label="Requested budget" value={usd(requestedContribution)} />
          </div>
        {spending ? <p className="mt-3 text-muted">{spending.from} through {spending.to} · {spending.months} completed calendar month{spending.months === 1 ? '' : 's'} · {spending.transactionCount} expense transactions. Current and partial opening months are excluded. Months without expenses count as zero; missing imports can understate the average.</p> : <p className="mt-3 text-[#e7c88f]">A completed month of transaction history is needed. Automatic sizing remains at $0 until an average is available; import history or turn off the expense adjustment to model a manual budget.</p>}
        <p className="mt-2 text-faint">Bill payments and withdrawals count as spending; interest and fees are added separately. Purchases, transfers, and tax withholding are excluded. Your saved spending exclusions apply. Only expenses visible in this account are included.</p>
        {expenseBudget.reviewRows.length > 0 && <p className="mt-2 text-[#e7c88f]">{expenseBudget.reviewRows.length} outgoing transfer or unclassified transaction{expenseBudget.reviewRows.length === 1 ? '' : 's'} excluded from the estimate. Review them in Transactions; classify living expenses as Bill Payment or Withdrawal.</p>}
        {expenseReserveEnabled && spending && <p className="mt-2 text-[#e7c88f]">Reserve {usd(spending.monthlyAverage)} for the next month’s outflows. Purchases are capped at {usd(capacity?.maxOrderSpend ?? 0)} after this reserve and the 50% equity planning floor. This reserves borrowing room, not cash in a separate account. Future wages and dividends are not counted as available funding.</p>}
        {!expenseReserveEnabled && <p className="mt-2 text-[#e7c88f]">Expense adjustment is off. This scenario does not reserve room for upcoming bills.</p>}
          <p className="mt-2 text-faint">Limits keep each account at or above 50% equity using current debt, SMA and buying power. This is an app planning floor, not Schwab's maintenance requirement. Sync after a deposit posts.</p>
        {capacities.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-xl border border-border-soft">
            <div className="flex items-start gap-2 bg-surface-2/60 px-4 py-3">
              <CircleAlert size={16} className="mt-0.5 shrink-0 text-[#f0a94a]" />
              <div>
                <div className="text-sm font-semibold">50% Equity Planning Floor by Account</div>
                <div className="mt-0.5 text-xs text-faint">This app limit uses current debt, SMA, and buying power. It is not Schwab’s maintenance requirement, which varies by holding. Upcoming bills and interest are not reserved by this limit.</div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-t border-border-soft text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Account</th>
                    <th className="px-3 py-2 text-right font-medium">Current Equity %</th>
                    <th className="px-3 py-2 text-right font-medium">Planning Spend Limit</th>
                    <th className="px-3 py-2 text-right font-medium">After This Plan</th>
                    <th className="px-4 py-2 text-right font-medium">Use</th>
                  </tr>
                </thead>
                <tbody>
                  {capacities.map(({ account, capacity: accountCapacity }) => {
                    const selected = account.id === orderAccount
                    const over = plannedSpend > accountCapacity.maxOrderSpend + 0.005
                    const afterEquity = 1 - accountCapacity.projectedUsage(plannedSpend)
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
                            : account.isMargin ? pct(afterEquity * 100) : over ? `Over by ${usd(plannedSpend - accountCapacity.maxOrderSpend)}` : '100.00%'}
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
                  : `${selectedOrderAccount?.name} exceeds its planning limit by ${usd(plannedSpend - capacity.maxOrderSpend)}.`}
              </div>
            )}
          </div>
        )}
        </details>
      </div>

      <AiAllocationReview cacheScope={cacheScope} evidence={aiEvidence} planKey={aiPlanKey} shortlistActive={shortlistCurrent} onClearShortlist={() => setAiShortlist(null)} onUseShortlist={(symbols, expectedKey, expiresAt) => { if (expectedKey !== aiPlanKey || expiresAt <= Date.now()) return; setAiShortlist({ symbols, key: aiPlanKey, expiresAt }) }}/>
      {aiShortlist && !shortlistCurrent && <p className="mb-4 text-xs text-muted">The earlier AI shortlist was cleared because the plan changed.</p>}

      <div className="space-y-3">
          {planMode === 'rebalance' && sellPlan.length > 0 && <div className="rounded-xl border border-[#5a2631]/60 bg-[#33161d]/35 p-4"><div className="flex items-center gap-2"><TrendingDown size={15} className="text-neg"/><span className="font-semibold">Allocation-funded trims</span><span className="ml-auto text-xs text-faint">Review-only</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{sellPlan.map((row) => <div key={row.bucket} className="flex items-center justify-between rounded-lg bg-black/15 px-3 py-2 text-sm"><span>{row.bucket}</span><span className="num text-neg">−{usd(row.amount)}</span></div>)}</div><p className="mt-3 text-xs text-faint">These are bucket-level sale amounts required for an immediate rebalance. Choose tax lots and confirm tax consequences at Schwab; the app does not generate or submit these sells.</p></div>}
          {BUCKETS.map((b) => {
            const add = plan[b]
            const holdings = tickersByBucket[b]
            const holdingTarget = holdings.length ? (buckets[b].value + add) / holdings.length : 0
            const tickers = sizing === 'priority' ? [...holdings].sort((a, z) => Number(a.value >= holdingTarget) - Number(z.value >= holdingTarget) || compareAllocationPriority(a, z)) : holdings
            const nowW = buckets[b].weight * 100
            const tgtW = target[b] ?? 0
            const bucketOrders = orderQueue.filter((row) => row.bucket === b)
            const buying = new Set(bucketOrders.filter((row) => row.spend > 0).map((row) => row.symbol))
            const shown = showAllHoldings ? tickers : tickers.filter((t) => buying.has(t.symbol))
            const hidden = tickers.filter((t) => !buying.has(t.symbol)).length
            return (
              <div key={b} className="overflow-hidden rounded-xl border border-border-soft">
                <div className="flex flex-wrap items-center gap-3 bg-surface-2/50 px-4 py-3">
                  <span className="h-3 w-3 rounded-sm" style={{ background: BUCKET_COLOR[b] }} />
                  <span className="font-semibold">{b}</span>
                  <span className="text-xs text-faint">{pct(nowW)} → {pct(tgtW)}</span>
                  <span className={clsx('num ml-auto text-sm font-semibold', add > 0.5 ? 'text-pos' : 'text-faint')}>
                    {add > 0.5 ? `+${usd(add)}` : 'On target'}
                  </span>
                  {sizing === 'priority' && add > 0.5 && <span className="text-xs text-faint">{usd(bucketOrders.reduce((sum, row) => sum + row.spend, 0))} assigned</span>}
                </div>
                {add > 0.5 && shown.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead>
                        <tr className="border-b border-border-soft text-left text-xs text-muted">
                          <th className="px-4 py-2 font-medium">Ticker</th>
                          <th className="px-4 py-2 text-right font-medium">Buy $</th>
                          <th className="px-4 py-2 text-right font-medium">Shares</th>
                          <th className="px-4 py-2 text-right font-medium">Price</th>
                          <th className="px-4 py-2 text-right font-medium">After plan</th>
                          {sizing === 'priority' && <th className="px-4 py-2 text-right font-medium">Room to target</th>}
                          <th className="px-4 py-2 font-medium">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((t) => {
                          const order = bucketOrders.find((row) => row.symbol === t.symbol)
                          const shares = order?.shares ?? 0
                          const spend = order?.spend ?? 0
                          return (
                            <tr key={t.symbol} className="border-b border-border-soft last:border-0">
                              <td className="px-4 py-2">
                                <span className="font-semibold">{t.symbol}</span>
                                <span className="ml-2 text-xs text-faint">{t.name}</span>
                              </td>
                              <td className="num px-4 py-2 text-right text-pos">+{usd(spend)}</td>
                              <td className="num px-4 py-2 text-right text-muted">{wholeShares ? shares : shares.toFixed(3)}</td>
                              <td className="num px-4 py-2 text-right">{usd(t.price)}</td>
                              <td className="num px-4 py-2 text-right text-muted">{pct(((t.value + spend) / Math.max(projection.valueAfter, 1)) * 100)}</td>
                              {sizing === 'priority' && <td className="num px-4 py-2 text-right text-muted">{usd(Math.max(0, holdingTarget - t.value))}</td>}
                              <td className="px-4 py-2 text-xs text-faint">{order?.reason ?? (sizing === 'priority' ? `${allocationPriorityReason(t, holdingTarget - t.value)}${holdingTarget > t.value && (t.trendSignal === 'strong' || t.trendSignal === 'healthy') ? '; no buy fits remaining budget' : ''}` : 'No buy within this budget and sizing rule')}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {add > 0.5 && hidden > 0 && <button onClick={() => setShowAllHoldings((v) => !v)} className="w-full border-t border-border-soft px-4 py-2 text-left text-xs text-muted hover:text-ink">{showAllHoldings ? `Hide ${hidden} holding${hidden === 1 ? '' : 's'} with no buy` : `${hidden} more holding${hidden === 1 ? '' : 's'} not getting money · show`}</button>}
                {add > 0.5 && !tickers.length && <p className="px-4 py-3 text-xs text-faint">No eligible holdings in this bucket. {usd(add)} remains unallocated.</p>}
              </div>
            )
          })}
      </div>

      <details className="mt-4 rounded-xl border border-border-soft p-4 text-xs text-faint">
        <summary className="cursor-pointer font-semibold text-muted">How this plan works</summary>
        <div className="mt-3 space-y-2 leading-5"><p>Your bucket targets allocate the budget first. {sizing === 'priority' ? 'Fresh strong or healthy trends receive money in score order, capped at each holding’s target gap.' : sizing === 'gaps' ? 'Money fills gaps toward an equal share within each bucket.' : sizing === 'trend' ? 'Money fills holding gaps with a modest trend tilt, without exceeding those gaps.' : 'Each holding in a bucket receives an equal dollar budget.'}</p><p>{usd(plannedSpend)} assigned across {orderQueue.length} buys. {usd(cashRemaining)} remains unassigned because of prices, rounding, eligibility, or target limits.</p><p>Signals require all three moving averages and a snapshot no more than seven days old. They measure price trends and exclude distributions. Broker preview validates the actual order.</p></div>
        <p className="mt-2">
          {sizing !== 'equal' ? 'Buy budgets fill gaps toward an equal-weight mix within each bucket; larger holdings can receive no new dollars.' : 'Buy budgets are split evenly across each bucket’s holdings.'} Share quantities round down to stay within each budget. Projections include these buys only, before any proposed sales.
        </p>
        {sizing === 'trend' && <p className="mt-2">Trend scores tilt gap weights by up to ±20% in Growth and Leveraged, and ±5% in income buckets. Holdings stay capped at their target gaps. Missing, incomplete, or older-than-seven-day signals are neutral. Price trends do not include distributions.</p>}
        {sizing === 'priority' && <p className="mt-2">Strong and healthy trends receive dollars in score order within each bucket. Ties share dollars by their size gaps. Each holding is capped at an equal share of its bucket’s value plus contribution. Neutral, caution, weak, missing, or older-than-seven-day signals receive no buys. Unused funds remain unallocated. This ranks price trends, not business quality or total return; distributions are not included in these signals.</p>}
      </details>

      <PlanReview contribution={contribution} account={selectedOrderAccount?.name ?? 'No account'} orderCount={orderQueue.length} plannedSpend={plannedSpend} cashRemaining={cashRemaining} yieldBefore={blendedYield} yieldAfter={projection.yieldAfter} capacity={capacity} overCapacity={contributionOverCapacity} onContinue={() => setTab('orders')} balanced={balanced} />
      </>}

      {tab === 'orders' && <>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border-soft p-3 text-xs text-muted"><span>{orderQueue.length} buys · {usd(plannedSpend)} in {selectedOrderAccount?.name ?? 'no account'}</span><button className="ml-auto font-semibold text-brand" onClick={() => setTab('plan')}>Edit plan</button></div>
      <OrderQueue
        items={orderQueue}
        wholeShares={wholeShares}
        accounts={eligibleOrderAccounts}
        orderAccount={orderAccount}
        setOrderAccount={setOrderAccount}
        live={data.source === 'live'}
        capacity={capacity}
      />
      </>}
    </div>
  )
}


function PlanReview({ contribution, account, orderCount, plannedSpend, cashRemaining, yieldBefore, yieldAfter, capacity, overCapacity, balanced, onContinue }: { contribution: number; account: string; orderCount: number; plannedSpend: number; cashRemaining: number; yieldBefore: number; yieldAfter: number; capacity: MarginCapacity | null; overCapacity: boolean; balanced: boolean; onContinue?: () => void }) {
  const projectedEquity = capacity ? (1 - capacity.projectedUsage(plannedSpend)) * 100 : null
  const fundingGap = Math.max(0, plannedSpend - contribution)
  const warnings = [!balanced && 'Targets do not total 100%.', !capacity && 'Select a synced order account.', overCapacity && 'Proposed buys exceed the account planning limit.', orderCount === 0 && 'No orders fit the current budget and sizing rules.'].filter(Boolean)
  return <div className="card mt-4 p-5">
    <div className="flex items-center gap-2"><ShieldCheck size={17} className="text-brand"/><h3 className="font-semibold">Final Plan Review</h3>{warnings.length === 0 && <span className="ml-auto rounded-md bg-pos/10 px-2 py-1 text-xs text-pos">Ready for review</span>}</div>
    <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <SummaryMetric label="Investment budget" value={usd(contribution)} />
      <SummaryMetric label="Order account" value={account} />
      <SummaryMetric label="Proposed orders" value={String(orderCount)} />
      <SummaryMetric label="Planned exposure" value={usd(plannedSpend)} />
      <SummaryMetric label="Unallocated budget" value={usd(cashRemaining)} />
      <SummaryMetric label="Estimated yield after buys" value={`${pct(yieldBefore * 100)} → ${pct(yieldAfter * 100)}`} />
      <SummaryMetric label="Projected equity after plan & reserve" value={projectedEquity == null ? 'Unavailable' : pct(projectedEquity)} tone={projectedEquity != null && projectedEquity < 50 ? 'warn' : undefined} />
      <SummaryMetric label="Planning spend limit" value={capacity ? usd(capacity.maxOrderSpend) : '—'} />
    </div>
    {fundingGap > 0.005 && <p className="mt-3 text-xs text-[#e7c88f]">This rebalance needs {usd(fundingGap)} beyond the contribution. Proposed sales have not been executed; confirm funding before placing buys.</p>}
    {warnings.length > 0 && <div className="mt-4 rounded-xl border border-[#5a3a16] bg-[#38240f]/70 p-3 text-xs text-[#e7c88f]">{warnings.join(' ')}</div>}
    {onContinue && <div className="mt-4 flex justify-end"><Button variant="primary" onClick={onContinue} disabled={warnings.length > 0}>Review order queue</Button></div>}
  </div>
}

function ClassificationReview({ rows, fallbackCount, accounts: _accounts }: { rows: Array<{ position: Position; bucket: Bucket; method: ReturnType<typeof bucketClassification>['method'] }>; fallbackCount: number; accounts: Account[] }) {
  return <div className="card p-0"><div className="flex items-start gap-3 p-5"><ListChecks size={18} className="mt-0.5 text-brand"/><div><h3 className="font-semibold">Classification Review</h3><p className="mt-1 text-xs text-faint">Verify how each holding entered its allocation bucket. Growth fallbacks deserve manual review because no explicit ticker or name rule matched.</p></div><span className={clsx('ml-auto rounded-md px-2 py-1 text-xs', fallbackCount ? 'bg-[#38240f] text-[#e7c88f]' : 'bg-pos/10 text-pos')}>{fallbackCount} fallback</span></div><div className="max-h-[430px] overflow-auto"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-y border-border-soft text-left text-xs text-muted"><th className="px-5 py-2.5">Holding</th><th className="px-4 py-2.5">Account</th><th className="px-4 py-2.5">Bucket</th><th className="px-5 py-2.5">Classification source</th></tr></thead><tbody>{rows.map((r) => <tr key={r.position.id} className="border-b border-border-soft"><td className="px-5 py-3"><span className="font-semibold">{r.position.symbol}</span><span className="ml-2 text-xs text-faint">{r.position.name}</span></td><td className="px-4 py-3 text-xs text-muted">{r.position.accountId}</td><td className="px-4 py-3"><span className="rounded-md px-2 py-1 text-xs font-medium" style={{ color: BUCKET_COLOR[r.bucket], backgroundColor: `${BUCKET_COLOR[r.bucket]}15` }}>{r.bucket}</span></td><td className="px-5 py-3"><span className={clsx('text-xs', r.method === 'Growth fallback' ? 'text-[#e7c88f]' : 'text-muted')}>{r.method}</span></td></tr>)}</tbody></table></div></div>
}

function FallbackCorrections({ rows, accounts, onSetBucket }: { rows: Array<{ position: Position; bucket: Bucket }>; accounts: Account[]; onSetBucket: (accountId: string, symbol: string, bucket: Bucket) => void }) {
  if (!rows.length) return null
  return <details className="mt-4 rounded-xl border border-[#5a3a16] bg-[#38240f]/40"><summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm text-[#e7c88f]"><CircleAlert size={15}/><span><strong>{rows.length} holding{rows.length === 1 ? '' : 's'}</strong> defaulted to Growth. Pick the right bucket.</span><ChevronRight size={15} className="ml-auto"/></summary><div className="space-y-2 border-t border-[#5a3a16] p-3">{rows.map(({ position }) => <div key={position.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2/40 px-3 py-2"><div className="min-w-[160px] flex-1"><span className="font-semibold">{position.symbol}</span><span className="ml-2 text-xs text-faint">{accounts.find((a) => a.id === position.accountId)?.name ?? position.accountId}</span></div>{BUCKETS.map((bucket) => <button key={bucket} onClick={() => onSetBucket(position.accountId, position.symbol, bucket)} className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-white/[.04]" style={{ borderColor: `${BUCKET_COLOR[bucket]}35`, color: BUCKET_COLOR[bucket] }}>{bucket}</button>)}</div>)}</div></details>
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
        <span className={clsx('rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide', live ? 'bg-pos/10 text-pos' : 'bg-[#c7a96b]/10 text-[#d8bd7a]')}>{live ? 'Broker holding orders' : 'Planning only'}</span>
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
