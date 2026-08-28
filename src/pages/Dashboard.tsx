import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  DollarSign,
  TrendingDown,
  Percent,
  Layers,
  Wallet,
  Clock,
  ArrowUpRight,
  Building2,
  ChevronRight,
  RefreshCw,
  Briefcase,
  ShieldCheck,
} from 'lucide-react'
import { useStore, useScoped } from '../lib/store'
import { portfolioSummary, positionMetrics } from '../lib/calc'
import { twrForScope } from '../lib/twr'
import { schwabStatus, schwabSync } from '../lib/api'
import { usd, pct, intfmt, relTime, posNeg, shortDate } from '../lib/format'
import { KpiCard, Badge } from '../components/ui'
import { PositionDrawer } from '../components/PositionDrawer'
import { TransactionDrawer } from '../components/TransactionDrawer'
import type { Account, Position, Transaction } from '../lib/types'
import clsx from 'clsx'
import { BucketBadge } from '../components/HoldingCell'
import { bucketOf } from '../lib/buckets'
import { BUCKETS, BUCKET_COLOR } from '../lib/buckets'
import { useToast } from '../components/Toast'

export default function Dashboard() {
  const { data, applyImport, syncAll } = useStore()
  const { positions, accounts, transactions, scope, lastSyncAt } = useScoped()
  const navigate = useNavigate()
  const s = portfolioSummary(positions, accounts, scope, transactions)
  const twr = twrForScope(data.twr, scope, transactions)

  const [selectedPos, setSelectedPos] = useState<Position | null>(null)
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null)
  const [syncing, setSyncing] = useState(false)
  const { push } = useToast()

  const syncNow = async () => {
    setSyncing(true)
    try {
      const st = await schwabStatus()
      if (st.connected) {
        const r = await schwabSync()
        if (r.ok && r.payload) { applyImport(r.payload, 'replace', 'live'); push('Account synchronized', 'success') }
        else { push('Sync failed', 'error', r.error || 'Your data was not changed'); return }
      } else {
        syncAll(); push('Sample prices refreshed', 'info')
      }
    } finally {
      setSyncing(false)
    }
  }

  // Top positions (by market value) across the current scope.
  const topPositions = useMemo(() => {
    const rows = positions.map((p) => ({ p, m: positionMetrics(p) }))
    rows.sort((a, b) => b.m.value - a.m.value)
    return rows.slice(0, 8)
  }, [positions])

  const totals = useMemo(() => {
    const m = positions.map(positionMetrics)
    const value = m.reduce((a, x) => a + x.value, 0)
    const day = m.reduce((a, x) => a + x.dayChange, 0)
    const gain = m.reduce((a, x) => a + x.totalGain, 0)
    const cost = m.reduce((a, x) => a + x.costBasis, 0)
    const prev = value - day
    return {
      value,
      day,
      dayPct: prev ? day / prev : 0,
      gain,
      gainPct: cost ? gain / cost : 0,
    }
  }, [positions])

  const recentTxns = useMemo(() => transactions.slice(0, 8), [transactions])

  return (
    <div>
      <PortfolioHero net={s.net} gross={s.gross} dayChange={s.dayChange} dayPct={s.dayChangePct} series={(scope === 'all' ? data.twr?.all : data.twr?.byAccount[scope]) ?? []} lastSyncAt={lastSyncAt} />

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Gross Portfolio Value" value={usd(s.gross)} icon={<BarChart3 size={20} />} tile="green" />
        <KpiCard label="Margin Used" value={usd(s.marginUsed)} icon={<TrendingDown size={20} />} tile="red" />
        <KpiCard label="Equity %" value={pct(s.equityPct * 100)} icon={<Percent size={20} />} tile="orange" />
      </div>

      <div className="card mt-4 grid grid-cols-1 divide-y divide-border-soft p-0 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <SubStat icon={<Layers size={18} />} label="Unique Positions" value={intfmt(s.uniquePositions)} />
        <SubStat icon={<Wallet size={18} />} label="Available Cash (incl. unsettled)" value={usd(s.availableCash)} />
        <SubStat icon={<Clock size={18} />} label="Last Sync" value={relTime(lastSyncAt)} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MoveCard label="Day Change" amount={s.dayChange} pctv={s.dayChangePct * 100} />
        <MoveCard label="Total Gain" amount={s.totalGain} pctv={s.totalGainPct * 100} />
        <MoveCard label="Total Return" amount={s.totalReturn} pctv={s.totalReturnPct * 100} note="Dollar-weighted — Schwab investment change: gains + income − fees" />
        <TwrCard twr={twr} />
      </div>

      {/* Your Accounts ------------------------------------------------------ */}
      <div className="mt-10 mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Your Accounts</h2>
        <Link to="/connections" className="flex items-center gap-1 text-sm font-medium text-brand hover:underline">
          Manage Connections <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data.accounts.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            positions={data.positions}
            transactions={data.transactions}
            lastSyncAt={data.lastSyncAt}
            syncing={syncing}
            onSync={syncNow}
            onOpen={() => {
              navigate(`/account/${a.id}`)
            }}
          />
        ))}
      </div>

      {/* Top Positions + Recent Transactions -------------------------------- */}
      <div className="mt-8 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Top Positions */}
        <div className="card overflow-hidden p-0">
          <div className="flex items-center justify-between px-5 py-4">
            <h3 className="text-lg font-semibold">Top Positions</h3>
            <div className="flex items-center gap-4">
              <span className="hidden items-center gap-1.5 text-xs text-faint sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-pos" /> Prices as of {relTime(lastSyncAt)}
              </span>
              <Link to="/positions" className="flex items-center gap-1 text-sm font-medium text-brand hover:underline">
                View All <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-y border-border-soft text-left text-xs text-muted">
                  <th className="px-5 py-2.5 font-medium">Holding</th>
                  <th className="px-4 py-2.5 text-right font-medium">Day Chg $</th>
                  <th className="px-4 py-2.5 text-right font-medium">Day Chg %</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total Gain $</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total Gain %</th>
                  <th className="px-5 py-2.5 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border-soft bg-surface-2/40 font-semibold">
                  <td className="px-5 py-3">Portfolio Total</td>
                  <td className={clsx('num px-4 py-3 text-right', posNeg(totals.day))}>{usd(totals.day, { sign: true })}</td>
                  <td className={clsx('num px-4 py-3 text-right', posNeg(totals.day))}>{pct(totals.dayPct * 100, { sign: true })}</td>
                  <td className={clsx('num px-4 py-3 text-right', posNeg(totals.gain))}>{usd(totals.gain, { sign: true })}</td>
                  <td className={clsx('num px-4 py-3 text-right', posNeg(totals.gain))}>{pct(totals.gainPct * 100, { sign: true })}</td>
                  <td className="num px-5 py-3 text-right">{usd(totals.value)}</td>
                </tr>
                {topPositions.map(({ p, m }) => (
                  <tr
                    key={p.id}
                    onClick={() => setSelectedPos(p)}
                    className="cursor-pointer border-b border-border-soft last:border-0 hover:bg-surface-2/40"
                  >
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-2 font-semibold"><span>{p.symbol}</span><BucketBadge bucket={bucketOf(p)} /></span>
                    </td>
                    <td className={clsx('num px-4 py-3 text-right', posNeg(m.dayChange))}>{usd(m.dayChange, { sign: true })}</td>
                    <td className={clsx('num px-4 py-3 text-right', posNeg(m.dayChange))}>{pct(m.dayChangePct * 100, { sign: true })}</td>
                    <td className={clsx('num px-4 py-3 text-right', posNeg(m.totalGain))}>{usd(m.totalGain, { sign: true })}</td>
                    <td className={clsx('num px-4 py-3 text-right', posNeg(m.totalGain))}>{pct(m.totalGainPct * 100, { sign: true })}</td>
                    <td className="num px-5 py-3 text-right font-semibold">{usd(m.value)}</td>
                  </tr>
                ))}
                {topPositions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted">
                      No positions in this account.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="card overflow-hidden p-0">
          <div className="flex items-center justify-between px-5 py-4">
            <h3 className="text-lg font-semibold">Recent Transactions</h3>
            <Link to="/transactions" className="flex items-center gap-1 text-sm font-medium text-brand hover:underline">
              View All <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-y border-border-soft text-left text-xs text-muted">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Symbol</th>
                  <th className="px-4 py-2.5 text-right font-medium">Strike</th>
                  <th className="px-4 py-2.5 text-right font-medium">Exp</th>
                  <th className="px-5 py-2.5 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {recentTxns.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedTxn(t)}
                    className="cursor-pointer border-b border-border-soft last:border-0 hover:bg-surface-2/40"
                  >
                    <td className="px-5 py-3 text-xs text-muted">{shortDate(t.date)}</td>
                    <td className="px-4 py-3"><Badge>{t.type}</Badge></td>
                    <td className="px-4 py-3 font-semibold">{t.symbol ?? '—'}</td>
                    <td className="num px-4 py-3 text-right text-muted">{t.strike ? usd(t.strike) : '–'}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted">{t.exp ? shortDate(t.exp) : '–'}</td>
                    <td className="max-w-[240px] truncate px-5 py-3 text-xs text-muted">{t.description}</td>
                  </tr>
                ))}
                {recentTxns.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted">
                      No transactions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <PositionDrawer position={selectedPos} onClose={() => setSelectedPos(null)} />
      <TransactionDrawer txn={selectedTxn} onClose={() => setSelectedTxn(null)} />
    </div>
  )
}

function PortfolioHero({ net, gross, dayChange, dayPct, series, lastSyncAt }: { net: number; gross: number; dayChange: number; dayPct: number; series: { date: string; value: number }[]; lastSyncAt: string }) {
  const [range, setRange] = useState<'1M' | '3M' | 'YTD' | '1Y' | 'ALL'>('1Y')
  const visible = useMemo(() => {
    if (!series.length || range === 'ALL') return series
    const end = new Date(series[series.length - 1].date + 'T00:00:00')
    const start = new Date(end)
    if (range === '1M') start.setMonth(start.getMonth() - 1)
    if (range === '3M') start.setMonth(start.getMonth() - 3)
    if (range === '1Y') start.setFullYear(start.getFullYear() - 1)
    if (range === 'YTD') start.setMonth(0, 1)
    return series.filter((p) => new Date(p.date + 'T00:00:00') >= start)
  }, [series, range])
  const values = visible.map((p) => p.value)
  const lo = Math.min(...values, net || 0)
  const hi = Math.max(...values, net || 1)
  const points = visible.map((p, i) => `${visible.length <= 1 ? 0 : (i / (visible.length - 1)) * 600},${150 - ((p.value - lo) / Math.max(hi - lo, 1)) * 125}`).join(' ')
  const startValue = visible[0]?.value ?? net
  const periodMove = net - startValue
  return (
    <section className="relative overflow-hidden rounded-[24px] border border-[#c7a96b]/15 bg-[linear-gradient(135deg,#141820_0%,#0c1016_62%,#17140d_100%)] p-6 shadow-[0_24px_80px_rgba(0,0,0,.28)] sm:p-8">
      <div className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-[#c7a96b]/10 blur-3xl" />
      <div className="relative grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#cbb77f]"><ShieldCheck size={13} /> Consolidated portfolio</div>
          <div className="mt-4 text-sm text-muted">Net portfolio value</div>
          <div className="num mt-1 text-[clamp(2.3rem,5vw,4.2rem)] font-medium tracking-[-0.06em] text-white">{usd(net)}</div>
          <div className="mt-3 flex flex-wrap items-center gap-3"><span className={clsx('num rounded-full px-2.5 py-1 text-xs font-medium', dayChange >= 0 ? 'bg-pos/10 text-pos' : 'bg-neg/10 text-neg')}>{usd(dayChange, { sign: true })} · {pct(dayPct * 100, { sign: true })} today</span><span className="text-xs text-faint">Gross {usd(gross)} · synced {relTime(lastSyncAt)}</span></div>
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between"><div><div className="text-xs text-muted">Period movement</div><div className={clsx('num mt-0.5 text-sm font-medium', posNeg(periodMove))}>{usd(periodMove, { sign: true })}</div></div><div className="flex rounded-lg border border-white/[0.06] bg-black/20 p-0.5">{(['1M','3M','YTD','1Y','ALL'] as const).map((r) => <button key={r} onClick={() => setRange(r)} className={clsx('rounded-md px-2 py-1 text-[10px] font-medium', range === r ? 'bg-[#c7a96b]/18 text-[#e1c887]' : 'text-faint hover:text-ink')}>{r}</button>)}</div></div>
          <div className="h-[155px] w-full"><svg viewBox="0 0 600 155" preserveAspectRatio="none" className="h-full w-full overflow-visible"><defs><linearGradient id="hero-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c7a96b" stopOpacity=".28"/><stop offset="1" stopColor="#c7a96b" stopOpacity="0"/></linearGradient></defs>{points && <><polygon points={`0,155 ${points} 600,155`} fill="url(#hero-area)"/><polyline points={points} fill="none" stroke="#d8bd7a" strokeWidth="2" vectorEffect="non-scaling-stroke"/></>}</svg></div>
        </div>
      </div>
    </section>
  )
}

// ---- Account card matching the paycheck2portfolio layout ----
function AccountCard({
  account,
  positions,
  transactions,
  lastSyncAt,
  syncing,
  onSync,
  onOpen,
}: {
  account: Account
  positions: Position[]
  transactions: Transaction[]
  lastSyncAt: string
  syncing: boolean
  onSync: () => void
  onOpen: () => void
}) {
  const acctPositions = positions.filter((p) => p.accountId === account.id)
  const acctTxns = transactions.filter((t) => t.accountId === account.id)
  const summary = portfolioSummary(acctPositions, [account], account.id, acctTxns)
  const equityColor = summary.equityPct >= 0.999 ? 'text-ink' : 'text-[#f0a94a]'
  const allocation = BUCKETS.map((bucket) => ({ bucket, value: acctPositions.filter((p) => bucketOf(p) === bucket).reduce((sum, p) => sum + p.shares * p.lastPrice, 0) }))
  const allocationTotal = allocation.reduce((sum, b) => sum + b.value, 0)

  return (
    <div
      onClick={onOpen}
      className="card group cursor-pointer p-5 transition-colors hover:border-border"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-tile-blue text-[#5aa2ff]">
            <Building2 size={18} />
          </div>
          <div className="min-w-0">
            <div className="font-semibold leading-tight">{account.broker}</div>
            <div className="max-w-[190px] truncate text-xs text-faint">{account.fullName}</div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-md bg-tile-green px-1.5 py-0.5 text-[10px] font-medium text-pos">{account.broker}</span>
          {account.isMargin && (
            <span className="rounded-md bg-[#3a1a12] px-1.5 py-0.5 text-[10px] font-medium text-[#f0a94a]">Margin</span>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
        {account.isMargin ? (
          <>
            <Metric icon={<DollarSign size={12} />} label="Net Equity" value={usd(summary.net)} />
            <Metric icon={<Percent size={12} />} label="Equity %" value={pct(summary.equityPct * 100)} valueClass={equityColor} />
            <Metric icon={<BarChart3 size={12} />} label="Gross Portfolio Value" value={usd(summary.gross)} />
            <Metric icon={<TrendingDown size={12} />} label="Margin Used" value={usd(summary.marginUsed)} valueClass="text-neg" />
          </>
        ) : (
          <>
            <Metric icon={<DollarSign size={12} />} label="Total Value" value={usd(summary.gross)} />
            <Metric icon={<Percent size={12} />} label="Equity %" value={pct(summary.equityPct * 100)} valueClass={equityColor} />
            <Metric icon={<Layers size={12} />} label="Positions" value={intfmt(summary.uniquePositions)} />
          </>
        )}
      </div>

      <div className="mt-5 flex h-1.5 overflow-hidden rounded-full bg-white/[0.04]" title="Account allocation by portfolio bucket">
        {allocation.filter((b) => b.value > 0).map((b) => <span key={b.bucket} style={{ width: `${allocationTotal ? (b.value / allocationTotal) * 100 : 0}%`, backgroundColor: BUCKET_COLOR[b.bucket] }} />)}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-border-soft pt-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
          {account.isMargin && (
            <span className="flex items-center gap-1">
              <Briefcase size={12} /> {intfmt(summary.uniquePositions)} pos
            </span>
          )}
          <span className="flex items-center gap-1">
            <Wallet size={12} /> {usd(summary.availableCash)}
          </span>
          <span className="flex items-center gap-1">
            <Clock size={12} className="text-pos" /> {relTime(lastSyncAt)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-faint">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSync()
            }}
            title="Sync account"
            className="grid h-7 w-7 place-items-center rounded-md hover:bg-surface-2 hover:text-ink"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          </button>
          <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
        </div>
      </div>
    </div>
  )
}

function Metric({
  icon,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-xs text-muted">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={clsx('num mt-1 text-lg font-semibold', valueClass)}>{value}</div>
    </div>
  )
}

function SubStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 p-5">
      <div className="grid h-10 w-10 place-items-center rounded-lg bg-surface-2 text-muted">{icon}</div>
      <div>
        <div className="text-xs text-muted">{label}</div>
        <div className="num text-lg font-semibold">{value}</div>
      </div>
    </div>
  )
}

function MoveCard({ label, amount, pctv, note }: { label: string; amount: number; pctv: number; note?: string }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className={clsx('num mt-1 text-2xl font-semibold', posNeg(amount))}>{usd(amount, { sign: true })}</div>
      <div className={clsx('text-sm', posNeg(pctv))}>{pct(pctv, { sign: true })}</div>
      {note && <div className="mt-1 text-xs text-faint">{note}</div>}
    </div>
  )
}

function TwrCard({ twr }: { twr: ReturnType<typeof twrForScope> }) {
  const pctv = twr.twrPct * 100
  const ann = twr.annualizedPct * 100
  return (
    <div className="card p-5">
      <div className="flex items-center gap-1.5 text-sm text-muted">
        Time-Weighted Return
        <span
          className="cursor-help text-faint"
          title="How your investments performed, independent of when you added or withdrew money — the metric funds report and benchmark against. Deposits, withdrawals, bill payments, and option premium are neutralised so timing doesn't flatter or hide the result. Contrast with Total Return, which is a dollar figure that IS affected by your deposit timing."
        >
          ⓘ
        </span>
      </div>
      {twr.ok ? (
        <>
          <div className={clsx('num mt-1 text-2xl font-semibold', posNeg(pctv))}>{pct(pctv, { sign: true })}</div>
          <div className={clsx('text-sm', posNeg(ann))}>{pct(ann, { sign: true })} annualized</div>
          <div className="mt-1 text-xs text-faint">Investment performance, timing removed</div>
        </>
      ) : (
        <>
          <div className="num mt-1 text-2xl font-semibold text-faint">—</div>
          <div className="mt-1 text-xs text-faint">Sync a connected account to build the value history</div>
        </>
      )}
    </div>
  )
}
