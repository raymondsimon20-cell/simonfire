import { useEffect, useMemo, useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { Target, Wand2, Eraser, Percent, Calculator, Activity, TrendingDown, Copy, Check, ClipboardList, ShieldCheck, LoaderCircle, ListChecks, CircleAlert } from 'lucide-react'
import { useScoped, useStore } from '../lib/store'
import { bucketOf, bucketStats, BUCKETS, BUCKET_COLOR, type Bucket } from '../lib/buckets'
import { normTicker } from '../lib/plan'
import { buildInsights, SIGNAL_STYLE, ACTION_STYLE, type HoldingInsight } from '../lib/insights'
import { usd, pct, intfmt } from '../lib/format'
import { PageHeader, Button } from '../components/ui'
import { Modal } from '../components/Modal'
import { schwabOrderStatus, schwabPlaceOrder, schwabPreviewOrder, type EquityOrder } from '../lib/api'
import { marginCapacity, type MarginCapacity } from '../lib/margin'
import clsx from 'clsx'

const roundWeights = (buckets: Record<Bucket, { weight: number }>): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const b of BUCKETS) out[b] = +(buckets[b].weight * 100).toFixed(1)
  return out
}

export default function Allocation() {
  const { positions, transactions } = useScoped()
  const { data, setTargetAlloc } = useStore()

  const stats = useMemo(() => bucketStats(positions, transactions), [positions, transactions])
  const { buckets, total, blendedYield } = stats

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
  const setBucket = (b: Bucket, v: number) => update({ ...target, [b]: Math.max(0, Math.min(100, v)) })
  const resetFromCurrent = () => update(roundWeights(buckets))
  const clearAll = () => update({ Growth: 0, CEFs: 0, 'High Yield': 0, Leveraged: 0 })

  const targetTotal = BUCKETS.reduce((s, b) => s + (target[b] ?? 0), 0)
  const balanced = Math.abs(targetTotal - 100) < 0.05

  const targetBlended = BUCKETS.reduce((s, b) => s + ((target[b] ?? 0) / 100) * buckets[b].yield, 0)

  // ---- Rebalance calculator ----
  const [contribution, setContribution] = useState(2000)
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
    const newTotal = total + contribution
    const desired = BUCKETS.map((b) => {
      const targetValue = newTotal * ((target[b] ?? 0) / 100)
      return { b, add: Math.max(0, targetValue - buckets[b].value) }
    })
    const sumDesired = desired.reduce((s, d) => s + d.add, 0)
    const addByBucket: Record<Bucket, number> = { Growth: 0, CEFs: 0, 'High Yield': 0, Leveraged: 0 }
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
  }, [total, contribution, target, buckets])

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

      {/* Blended yield */}
      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#f0a94a]">
          <Percent size={16} /> Estimated Blended Yield
        </div>
        <div className="flex items-center gap-4">
          <div>
            <div className="text-xs text-muted">CURRENT</div>
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
          Current yield is trailing-12-month distributions over market value. At-target mix applies each bucket's current yield to your target allocation; it is an estimate, not a forward yield forecast.
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
                  <input
                    type="range" min={0} max={100} step={0.5} value={target[b] ?? 0}
                    onChange={(e) => setBucket(b, +e.target.value)}
                    className="w-40 accent-[color:var(--tw)]"
                    style={{ accentColor: BUCKET_COLOR[b] }}
                  />
                  <div className="flex items-center rounded-lg border border-border bg-surface px-2">
                    <input
                      type="number" min={0} max={100} step={0.5} value={target[b] ?? 0}
                      onChange={(e) => setBucket(b, +e.target.value)}
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

      {/* Rebalance calculator */}
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

      {/* Order Queue — review & place */}
      <OrderQueue
        items={orderQueue}
        wholeShares={wholeShares}
        accounts={data.accounts}
        orderAccount={orderAccount}
        setOrderAccount={setOrderAccount}
        live={data.source === 'live'}
        capacity={capacity}
      />

      {/* Rebalance Insights (50/100/200 SMA) */}
      <RebalanceInsights insights={insights} accName={(id) => data.accounts.find((a) => a.id === id)?.name ?? id} hasData={!!data.insights} />
    </div>
  )
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
