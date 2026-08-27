import { useEffect, useMemo, useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { Target, Wand2, Eraser, Percent, Calculator, Activity, TrendingDown, Copy, Check, ClipboardList, ShieldCheck, LoaderCircle } from 'lucide-react'
import { useScoped, useStore } from '../lib/store'
import { bucketOf, bucketStats, BUCKETS, BUCKET_COLOR, type Bucket } from '../lib/buckets'
import { normTicker } from '../lib/plan'
import { buildInsights, SIGNAL_STYLE, ACTION_STYLE, type HoldingInsight } from '../lib/insights'
import { usd, pct, intfmt } from '../lib/format'
import { PageHeader, Button } from '../components/ui'
import { Modal } from '../components/Modal'
import { schwabOrderStatus, schwabPlaceOrder, schwabPreviewOrder, type EquityOrder } from '../lib/api'
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
            <div className="text-xs text-muted">TARGET</div>
            <div className="num text-2xl font-bold text-pos">{pct(targetBlended * 100)}</div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {BUCKETS.map((b) => (
              <span key={b} className="rounded-md px-2 py-1 text-xs font-medium" style={{ background: BUCKET_COLOR[b] + '22', color: BUCKET_COLOR[b] }}>
                {b} {pct(((target[b] ?? 0) / 100) * buckets[b].yield * 100)}
              </span>
            ))}
          </div>
        </div>
        <p className="mt-3 text-xs text-faint">
          Yield is trailing-12-month distributions over market value. Target yield weights each bucket's current yield by your target allocation.
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
}: {
  items: { symbol: string; name: string; bucket: Bucket; price: number; shares: number; spend: number }[]
  wholeShares: boolean
  accounts: { id: string; name: string; mask: string }[]
  orderAccount: string
  setOrderAccount: (id: string) => void
  live: boolean
}) {
  const [placed, setPlaced] = useState<Set<string>>(new Set())
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
  const accName = accounts.find((a) => a.id === orderAccount)?.name ?? 'your account'

  const togglePlaced = (k: string) =>
    setPlaced((prev) => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k)
      else n.add(k)
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
        Buys from the calculator above, queued for review. Each live order must be previewed and confirmed individually. Market orders can fill at a different price than shown.
      </p>

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
                <input type="checkbox" checked={placed.has(k)} onChange={() => togglePlaced(k)} className="h-4 w-4 accent-[#3fd88a]" />
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
