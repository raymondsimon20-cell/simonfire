import { useMemo, useState } from 'react'
import { AlertTriangle, Download, Trash2, X, RotateCcw, Plus, Check, Table, ClipboardList } from 'lucide-react'
import { useStore } from '../lib/store'
import { positionMetrics } from '../lib/calc'
import { usd, num, intfmt, posNeg } from '../lib/format'
import { PageHeader, Button, KpiCard } from '../components/ui'
import { DEFAULT_KEEP, DEFAULT_PLAN, normTicker, keepSetOf } from '../lib/plan'
import { downloadCsv } from '../lib/csv'
import clsx from 'clsx'

export default function Rebalance() {
  const { data, sellPosition, sellOffPlan, setKeepList, unsell } = useStore()
  const [newTicker, setNewTicker] = useState('')
  const [view, setView] = useState<'table' | 'ticket'>('table')
  const [placed, setPlaced] = useState<Set<string>>(new Set())
  const togglePlaced = (id: string) =>
    setPlaced((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const keepList = data.keepList ?? DEFAULT_KEEP
  const keepSet = useMemo(() => keepSetOf(keepList), [keepList])
  const accName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? id

  const { offPlan, onPlanCount, totalLiquidate } = useMemo(() => {
    const rows = data.positions.map((p) => ({ p, m: positionMetrics(p) }))
    const off = rows.filter((x) => !keepSet.has(normTicker(x.p.symbol)))
    off.sort((a, b) => Math.abs(b.m.value) - Math.abs(a.m.value))
    return {
      offPlan: off,
      onPlanCount: rows.length - off.length,
      totalLiquidate: off.reduce((s, x) => s + x.m.value, 0),
    }
  }, [data.positions, keepSet])

  const held = useMemo(() => new Set(data.positions.map((p) => normTicker(p.symbol))), [data.positions])

  const exportSellList = () => {
    const header = ['Symbol', 'Account', 'Shares', 'Price', 'Market Value']
    const body = offPlan.map((x) => [
      x.p.symbol,
      accName(x.p.accountId),
      x.p.shares,
      x.p.lastPrice.toFixed(2),
      x.m.value.toFixed(2),
    ])
    downloadCsv('off-plan-sell-list.csv', [header, ...body])
  }

  const sellAll = () => {
    if (offPlan.length === 0) return
    if (confirm(`Mark all ${offPlan.length} off-plan holdings as sold? This records the sales in your tracker (it does not place orders at Schwab).`))
      sellOffPlan(keepSet)
  }

  const removeKeep = (t: string) => setKeepList(keepList.filter((k) => normTicker(k) !== normTicker(t)))
  const addKeep = () => {
    const t = newTicker.trim().toUpperCase()
    if (!t) return
    if (!keepList.some((k) => normTicker(k) === normTicker(t))) setKeepList([...keepList, t])
    setNewTicker('')
  }

  return (
    <div>
      <PageHeader
        title="Rebalance to Plan"
        subtitle="Hold only your target funds — sell everything off-plan"
        right={
          <>
            <Button onClick={exportSellList}>
              <Download size={15} /> Export sell list
            </Button>
            <Button variant="primary" onClick={sellAll}>
              <Trash2 size={15} /> Sell all off-plan ({offPlan.length})
            </Button>
          </>
        }
      />

      {/* Disclaimer */}
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-[#3a2a12] bg-[#241a0c] p-4 text-sm">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[#f0a94a]" />
        <div className="text-[#e7c88f]">
          <span className="font-semibold">Tracker only.</span> Marking a holding “sold” records the
          sale here and removes it from your tracker (it stays out even after a live sync). It does
          <span className="font-semibold"> not</span> place an order at Schwab — execute the actual
          trades in your brokerage.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="On-Plan Holdings (keep)" value={intfmt(onPlanCount)} tile="green" />
        <KpiCard label="Off-Plan Holdings (to sell)" value={intfmt(offPlan.length)} tile="red" />
        <KpiCard label="Value to Liquidate" value={usd(totalLiquidate)} tile="orange" />
      </div>

      {/* Off-plan table */}
      <div className="card mt-4 overflow-hidden p-0">
        <div className="flex items-center justify-between px-5 py-4">
          <h3 className="text-lg font-semibold">Off-Plan Holdings</h3>
          <div className="flex items-center rounded-lg border border-border bg-surface-2 p-0.5 text-xs">
            <button onClick={() => setView('table')} className={clsx('flex items-center gap-1.5 rounded-md px-3 py-1.5', view === 'table' ? 'bg-surface text-ink' : 'text-muted')}>
              <Table size={13} /> Table
            </button>
            <button onClick={() => setView('ticket')} className={clsx('flex items-center gap-1.5 rounded-md px-3 py-1.5', view === 'ticket' ? 'bg-surface text-ink' : 'text-muted')}>
              <ClipboardList size={13} /> Order ticket
            </button>
          </div>
        </div>
        {view === 'table' && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-y border-border-soft text-left text-xs text-muted">
                <th className="px-5 py-2.5 font-medium">Holding</th>
                <th className="px-4 py-2.5 font-medium">Account</th>
                <th className="px-4 py-2.5 text-right font-medium">Shares</th>
                <th className="px-4 py-2.5 text-right font-medium">Price</th>
                <th className="px-4 py-2.5 text-right font-medium">Total Gain</th>
                <th className="px-4 py-2.5 text-right font-medium">Market Value</th>
                <th className="px-5 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {offPlan.map(({ p, m }) => (
                <tr key={p.id} className="border-b border-border-soft last:border-0 hover:bg-surface-2/40">
                  <td className="px-5 py-3">
                    <div className="font-semibold">{p.symbol}</div>
                    <div className="max-w-[220px] truncate text-xs text-faint">{p.name}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{accName(p.accountId)}</td>
                  <td className="num px-4 py-3 text-right">{num(p.shares)}</td>
                  <td className="num px-4 py-3 text-right">{usd(p.lastPrice)}</td>
                  <td className={clsx('num px-4 py-3 text-right', posNeg(m.totalGain))}>{usd(m.totalGain, { sign: true })}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{usd(m.value)}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => sellPosition(p.accountId, p.symbol)}
                      className="rounded-lg border border-[#5a1f2a] bg-[#33161d] px-3 py-1.5 text-xs font-medium text-[#f2607a] hover:bg-[#43202a]"
                    >
                      Mark sold
                    </button>
                  </td>
                </tr>
              ))}
              {offPlan.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-muted">
                    Every holding is on your target plan. Nothing to sell. 🎯
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}

        {view === 'ticket' && (
          <div className="border-t border-border-soft p-5">
            <p className="mb-4 text-xs text-faint">
              Sell orders grouped by account. Place each at your broker and check it off — {placed.size} of {offPlan.length} placed.
            </p>
            {offPlan.length === 0 && (
              <div className="py-6 text-center text-sm text-muted">Nothing off-plan. 🎯</div>
            )}
            <div className="space-y-5">
              {data.accounts
                .map((a) => ({ a, rows: offPlan.filter((x) => x.p.accountId === a.id) }))
                .filter((g) => g.rows.length > 0)
                .map(({ a, rows }) => (
                  <div key={a.id}>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold">{a.name} <span className="text-xs font-normal text-faint">····{a.mask}</span></div>
                      <div className="text-xs text-faint">{rows.length} orders · {usd(rows.reduce((s, x) => s + x.m.value, 0))}</div>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-border-soft">
                      {rows.map(({ p, m }) => (
                        <label key={p.id} className="flex cursor-pointer items-center gap-3 border-b border-border-soft px-4 py-2.5 text-sm last:border-0 hover:bg-surface-2/40">
                          <input type="checkbox" checked={placed.has(p.id)} onChange={() => togglePlaced(p.id)} className="h-4 w-4 accent-[#3fd88a]" />
                          <span className={clsx('rounded px-1.5 py-0.5 text-[10px] font-semibold', 'bg-[#33161d] text-[#f2607a]')}>SELL</span>
                          <span className="num font-semibold">{num(p.shares)}</span>
                          <span className="font-semibold">{p.symbol}</span>
                          <span className="text-xs text-faint">@ market</span>
                          <span className={clsx('num ml-auto', placed.has(p.id) && 'text-faint line-through')}>≈ {usd(m.value)}</span>
                          <button
                            onClick={(e) => { e.preventDefault(); sellPosition(p.accountId, p.symbol) }}
                            className="rounded-md border border-[#5a1f2a] bg-[#33161d] px-2 py-1 text-[11px] font-medium text-[#f2607a] hover:bg-[#43202a]"
                          >
                            Mark sold
                          </button>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Recently sold */}
      {(data.soldSymbols?.length ?? 0) > 0 && (
        <div className="card mt-4 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Marked Sold ({data.soldSymbols!.length})</h3>
            <span className="text-xs text-faint">Kept out of the tracker on every sync</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.soldSymbols!.map((key) => {
              const [accId, sym] = key.split('|')
              return (
                <span key={key} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-xs">
                  <span className="font-semibold">{sym}</span>
                  <span className="text-faint">{accName(accId)}</span>
                  <button onClick={() => unsell(accId, sym)} title="Undo (re-appears on next sync)" className="text-faint hover:text-ink">
                    <RotateCcw size={12} />
                  </button>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Target plan editor */}
      <div className="card mt-4 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Target Plan</h3>
          <button
            onClick={() => setKeepList(DEFAULT_KEEP)}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-ink"
          >
            <RotateCcw size={12} /> Reset to default
          </button>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <input
            value={newTicker}
            onChange={(e) => setNewTicker(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addKeep()}
            placeholder="Add ticker to keep…"
            className="w-48 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm uppercase outline-none focus:border-brand"
          />
          <Button onClick={addKeep}>
            <Plus size={15} /> Add
          </Button>
        </div>

        <div className="space-y-5">
          {DEFAULT_PLAN.map((bucket) => (
            <div key={bucket.name}>
              <div className="mb-2 text-sm font-semibold text-muted">{bucket.name}</div>
              <div className="flex flex-wrap gap-2">
                {bucket.tickers
                  .filter((t) => keepList.some((k) => normTicker(k) === normTicker(t)))
                  .map((t) => (
                    <TickerChip key={t} t={t} held={held.has(normTicker(t))} onRemove={() => removeKeep(t)} />
                  ))}
              </div>
            </div>
          ))}
          {/* Any custom-added tickers not in the default buckets */}
          {(() => {
            const extra = keepList.filter(
              (k) => !DEFAULT_PLAN.some((b) => b.tickers.some((t) => normTicker(t) === normTicker(k))),
            )
            if (extra.length === 0) return null
            return (
              <div>
                <div className="mb-2 text-sm font-semibold text-muted">Added</div>
                <div className="flex flex-wrap gap-2">
                  {extra.map((t) => (
                    <TickerChip key={t} t={t} held={held.has(normTicker(t))} onRemove={() => removeKeep(t)} />
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

function TickerChip({ t, held, onRemove }: { t: string; held: boolean; onRemove: () => void }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs',
        held ? 'border-[#1e6b45] bg-[#123024] text-[#3fd88a]' : 'border-border bg-surface-2 text-muted',
      )}
      title={held ? 'Currently held' : 'On plan, not currently held'}
    >
      {held && <Check size={11} />}
      <span className="font-semibold">{t}</span>
      <button onClick={onRemove} className="text-faint hover:text-ink">
        <X size={12} />
      </button>
    </span>
  )
}
