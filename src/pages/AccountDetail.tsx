import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import {
  ArrowLeft,
  RefreshCw,
  Building2,
  BarChart3,
  Wallet,
  HandCoins,
  PiggyBank,
  TrendingUp,
  AlertCircle,
  Calendar,
} from 'lucide-react'
import { useStore } from '../lib/store'
import { portfolioSummary, positionMetrics, monthClose, availableMonths } from '../lib/calc'
import { schwabStatus, schwabSync } from '../lib/api'
import { usd, pct, num, intfmt, relTime, monthLabel, posNeg } from '../lib/format'
import { Badge } from '../components/ui'
import { PositionDrawer } from '../components/PositionDrawer'
import { TransactionDrawer } from '../components/TransactionDrawer'
import type { Position, Transaction } from '../lib/types'
import clsx from 'clsx'

type Tab = 'positions' | 'transactions' | 'balance'

export default function AccountDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data, applyImport, syncAll } = useStore()
  const [tab, setTab] = useState<Tab>('positions')
  const [selectedPos, setSelectedPos] = useState<Position | null>(null)
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null)
  const [syncing, setSyncing] = useState(false)

  const account = data.accounts.find((a) => a.id === id)

  const acctPositions = useMemo(
    () => data.positions.filter((p) => p.accountId === id),
    [data.positions, id],
  )
  const acctTxns = useMemo(
    () => data.transactions.filter((t) => t.accountId === id),
    [data.transactions, id],
  )

  const summary = useMemo(
    () => (account ? portfolioSummary(acctPositions, [account], account.id, acctTxns) : null),
    [account, acctPositions, acctTxns],
  )

  const syncNow = async () => {
    setSyncing(true)
    try {
      const st = await schwabStatus()
      if (st.connected) {
        const r = await schwabSync()
        if (r.ok && r.payload) applyImport(r.payload, 'replace', 'live')
        else syncAll()
      } else {
        syncAll()
      }
    } finally {
      setSyncing(false)
    }
  }

  if (!account || !summary) {
    return (
      <div className="grid place-items-center py-24 text-center">
        <div className="mb-3 text-muted">That account could not be found.</div>
        <button
          onClick={() => navigate('/')}
          className="rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm hover:bg-[#1c2740]"
        >
          Back to Dashboard
        </button>
      </div>
    )
  }

  const isMargin = account.isMargin
  const netEquity = account.equity ?? summary.net
  const gpv = summary.gross
  // Cash available to withdraw (incl. margin): broker value if present, else the
  // amount that keeps equity ≥ 50% of gross for a margin account, or settled cash.
  const availWithdraw =
    account.availableFunds ?? (isMargin ? Math.max(0, netEquity - 0.5 * gpv) : account.cash)
  const safeToSpend = account.availableFunds ?? availWithdraw
  const buyingPower = account.buyingPower ?? (isMargin ? availWithdraw * 2 : account.cash)
  const broker = account.equity != null // came from a live sync

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{account.name}</h1>
          <p className="mt-1 text-sm text-muted">{account.broker} · {account.type} Account</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3.5 py-2 text-sm font-medium hover:bg-[#1c2740]"
          >
            <ArrowLeft size={15} /> Back
          </button>
          <button
            onClick={syncNow}
            className="flex items-center gap-2 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-[#2f74e6]"
          >
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} /> Sync
          </button>
        </div>
      </div>

      {/* Account identity card */}
      <div className="card flex items-center gap-4 p-5">
        <div className="grid h-12 w-12 place-items-center rounded-xl bg-tile-blue text-[#5aa2ff]">
          <Building2 size={22} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">{account.name}</span>
            <span className="rounded-md bg-tile-green px-1.5 py-0.5 text-[10px] font-medium text-pos">
              {account.broker}
            </span>
            {isMargin && (
              <span className="rounded-md bg-[#3a1a12] px-1.5 py-0.5 text-[10px] font-medium text-[#f0a94a]">
                Margin
              </span>
            )}
          </div>
          <div className="text-sm text-faint">
            {account.broker} • {account.fullName}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-faint">
            <Calendar size={12} /> Last synced: {relTime(data.lastSyncAt)}
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi icon={<BarChart3 size={16} />} label="Net Equity" value={usd(netEquity)} />
        <Kpi icon={<TrendingUp size={16} />} label="Gross Portfolio Value" value={usd(gpv)} />
        <Kpi icon={<Wallet size={16} />} label="Available Cash" value={usd(account.cash)} info />
        <Kpi
          icon={<HandCoins size={16} />}
          label="Available to Withdraw (incl. margin)"
          value={usd(availWithdraw)}
          info
          tag={broker ? undefined : 'Estimated'}
        />
        <Kpi
          icon={<PiggyBank size={16} />}
          label="Safe to Spend (≥ 50%)"
          value={usd(safeToSpend)}
          info
          tag="Estimated"
        />
        <Kpi
          icon={<TrendingUp size={16} />}
          label="Buying Power"
          value={usd(buyingPower)}
          info
          tag={broker ? undefined : 'Estimated'}
        />
        <Kpi
          icon={<AlertCircle size={16} />}
          label="Margin Used"
          value={usd(account.marginBalance)}
          info
          tag={isMargin ? 'Estimated' : undefined}
          valueClass={account.marginBalance > 0 ? 'text-neg' : undefined}
        />
      </div>

      {/* Tabs */}
      <div className="mt-6 inline-flex rounded-xl border border-border-soft bg-surface p-1">
        {(
          [
            ['positions', 'Positions'],
            ['transactions', 'Transactions'],
            ['balance', 'Balance History'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              tab === key ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'positions' && (
        <PositionsTab positions={acctPositions} onSelect={setSelectedPos} />
      )}
      {tab === 'transactions' && (
        <TransactionsTab transactions={acctTxns} onSelect={setSelectedTxn} />
      )}
      {tab === 'balance' && (
        <BalanceHistoryTab account={account} txns={acctTxns} summary={summary} />
      )}

      <PositionDrawer position={selectedPos} onClose={() => setSelectedPos(null)} />
      <TransactionDrawer txn={selectedTxn} onClose={() => setSelectedTxn(null)} />
    </div>
  )
}

function Kpi({
  icon,
  label,
  value,
  info,
  tag,
  valueClass,
}: {
  icon: React.ReactNode
  label: string
  value: string
  info?: boolean
  tag?: string
  valueClass?: string
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <span className="text-faint">{icon}</span>
          <span className="leading-tight">{label}</span>
        </div>
        {info && (
          <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-border text-[9px] text-faint">
            i
          </span>
        )}
      </div>
      <div className={clsx('num mt-3 text-xl font-semibold', valueClass)}>{value}</div>
      {tag && (
        <span className="mt-2 inline-block rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-faint">
          {tag}
        </span>
      )}
    </div>
  )
}

function PositionsTab({
  positions,
  onSelect,
}: {
  positions: Position[]
  onSelect: (p: Position) => void
}) {
  const rows = useMemo(() => {
    const r = positions.map((p) => ({ p, m: positionMetrics(p) }))
    const total = r.reduce((s, x) => s + x.m.value, 0)
    return r
      .map((x) => ({ ...x, weight: total ? x.m.value / total : 0 }))
      .sort((a, b) => b.m.value - a.m.value)
  }, [positions])

  const totals = useMemo(() => {
    const m = positions.map(positionMetrics)
    return {
      value: m.reduce((s, x) => s + x.value, 0),
      dayChange: m.reduce((s, x) => s + x.dayChange, 0),
      totalGain: m.reduce((s, x) => s + x.totalGain, 0),
      totalReturn: m.reduce((s, x) => s + x.totalReturn, 0),
      cost: m.reduce((s, x) => s + x.costBasis, 0),
    }
  }, [positions])

  return (
    <div className="card mt-4 overflow-x-auto p-0">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="border-b border-border-soft text-left text-xs text-muted">
            <th className="px-4 py-3 font-medium">Holding</th>
            <th className="px-4 py-3 text-right font-medium">Shares / Contracts</th>
            <th className="px-4 py-3 text-right font-medium">Price</th>
            <th className="px-4 py-3 text-right font-medium">Day Chg $</th>
            <th className="px-4 py-3 text-right font-medium">Day Chg %</th>
            <th className="px-4 py-3 text-right font-medium">Total Gain $</th>
            <th className="px-4 py-3 text-right font-medium">Total Gain %</th>
            <th className="px-4 py-3 text-right font-medium">Total Return $</th>
            <th className="px-4 py-3 text-right font-medium">Total Return %</th>
            <th className="px-4 py-3 text-right font-medium">Value</th>
            <th className="px-4 py-3 text-right font-medium">% Portfolio</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border-soft bg-surface-2/40 font-semibold">
            <td className="px-4 py-3" colSpan={3}>Portfolio Total</td>
            <td className={clsx('num px-4 py-3 text-right', posNeg(totals.dayChange))}>{usd(totals.dayChange, { sign: true })}</td>
            <td className={clsx('num px-4 py-3 text-right', posNeg(totals.dayChange))}>{pct((totals.dayChange / (totals.value - totals.dayChange)) * 100, { sign: true })}</td>
            <td className={clsx('num px-4 py-3 text-right', posNeg(totals.totalGain))}>{usd(totals.totalGain, { sign: true })}</td>
            <td className={clsx('num px-4 py-3 text-right', posNeg(totals.totalGain))}>{pct((totals.totalGain / totals.cost) * 100, { sign: true })}</td>
            <td className={clsx('num px-4 py-3 text-right', posNeg(totals.totalReturn))}>{usd(totals.totalReturn, { sign: true })}</td>
            <td className={clsx('num px-4 py-3 text-right', posNeg(totals.totalReturn))}>{pct((totals.totalReturn / totals.cost) * 100, { sign: true })}</td>
            <td className="num px-4 py-3 text-right">{usd(totals.value)}</td>
            <td className="num px-4 py-3 text-right">100%</td>
          </tr>
          {rows.map(({ p, m, weight }) => (
            <tr
              key={p.id}
              onClick={() => onSelect(p)}
              className="cursor-pointer border-b border-border-soft last:border-0 hover:bg-surface-2/40"
            >
              <td className="px-4 py-3">
                <div className="font-semibold">{p.symbol}</div>
                <div className="max-w-[180px] truncate text-xs text-faint">{p.name}</div>
              </td>
              <td className="num px-4 py-3 text-right">{num(p.shares)}</td>
              <td className="num px-4 py-3 text-right">{usd(p.lastPrice)}</td>
              <td className={clsx('num px-4 py-3 text-right', posNeg(m.dayChange))}>{usd(m.dayChange, { sign: true })}</td>
              <td className={clsx('num px-4 py-3 text-right', posNeg(m.dayChange))}>{pct(m.dayChangePct * 100, { sign: true })}</td>
              <td className={clsx('num px-4 py-3 text-right', posNeg(m.totalGain))}>{usd(m.totalGain, { sign: true })}</td>
              <td className={clsx('num px-4 py-3 text-right', posNeg(m.totalGain))}>{pct(m.totalGainPct * 100, { sign: true })}</td>
              <td className={clsx('num px-4 py-3 text-right', posNeg(m.totalReturn))}>{usd(m.totalReturn, { sign: true })}</td>
              <td className={clsx('num px-4 py-3 text-right', posNeg(m.totalReturn))}>{pct(m.totalReturnPct * 100, { sign: true })}</td>
              <td className="num px-4 py-3 text-right font-semibold">{usd(m.value)}</td>
              <td className="num px-4 py-3 text-right text-muted">{pct(weight * 100)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={11} className="px-4 py-10 text-center text-sm text-muted">
                No positions in this account.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function TransactionsTab({
  transactions,
  onSelect,
}: {
  transactions: Transaction[]
  onSelect: (t: Transaction) => void
}) {
  return (
    <div className="card mt-4 overflow-x-auto p-0">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-border-soft text-left text-xs text-muted">
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Symbol</th>
            <th className="px-4 py-3 font-medium">Description</th>
            <th className="px-4 py-3 text-right font-medium">Amount</th>
            <th className="px-4 py-3 text-right font-medium">Units</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr
              key={t.id}
              onClick={() => onSelect(t)}
              className="cursor-pointer border-b border-border-soft last:border-0 hover:bg-surface-2/40"
            >
              <td className="px-4 py-3 text-xs text-muted">{new Date(t.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
              <td className="px-4 py-3"><Badge>{t.type}</Badge></td>
              <td className="px-4 py-3 font-semibold">{t.symbol ?? '—'}</td>
              <td className="max-w-[320px] truncate px-4 py-3 text-xs text-muted">{t.description}</td>
              <td className={clsx('num px-4 py-3 text-right', t.amount === 0 ? 'text-muted' : posNeg(t.amount))}>
                {t.amount === 0 ? usd(0) : usd(t.amount, { sign: true })}
              </td>
              <td className="num px-4 py-3 text-right text-muted">{t.units ? num(t.units) : '—'}</td>
            </tr>
          ))}
          {transactions.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted">
                No transactions in this account.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function BalanceHistoryTab({
  account,
  txns,
  summary,
}: {
  account: import('../lib/types').Account
  txns: Transaction[]
  summary: import('../lib/calc').PortfolioSummary
}) {
  const series = useMemo(() => {
    const months = availableMonths(txns) // desc
    if (months.length === 0) return []
    const pts = months
      .slice(0, 14)
      .map((ym) => {
        const mc = monthClose([account], txns, account.id, ym, summary)
        return { month: monthLabel(ym).replace(/ 20/, " '"), equity: +mc.netEquity.toFixed(2) }
      })
      .reverse()
    return pts
  }, [account, txns, summary])

  const first = series[0]?.equity ?? 0
  const last = series[series.length - 1]?.equity ?? summary.net
  const change = last - first

  return (
    <div className="card mt-4 p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">Balance History</h3>
        <div className="text-sm">
          <span className="num font-semibold">{usd(last)}</span>{' '}
          <span className={clsx('num', posNeg(change))}>
            ({usd(change, { sign: true })})
          </span>
        </div>
      </div>
      <p className="mb-4 text-xs text-faint">Estimated month-end net equity, reconciled from cash flows.</p>
      {series.length >= 2 ? (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d17d" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#34d17d" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1b2432" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#5c6a80', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#1b2432' }} />
              <YAxis
                tick={{ fill: '#5c6a80', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v.toFixed(0)}`)}
              />
              <Tooltip
                content={({ active, payload, label }: any) =>
                  active && payload?.length ? (
                    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-xl">
                      <div className="mb-0.5 text-muted">{label}</div>
                      <div className="num font-semibold">{usd(payload[0].value)}</div>
                    </div>
                  ) : null
                }
              />
              <Area type="monotone" dataKey="equity" stroke="#34d17d" strokeWidth={2} fill="url(#eq)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="grid place-items-center py-16 text-sm text-muted">
          Not enough history yet — balance history builds up as transactions accumulate.
        </div>
      )}
      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg border border-border-soft bg-surface-2/40 p-3">
          <div className="text-xs text-muted">Unique Positions</div>
          <div className="num mt-1 font-semibold">{intfmt(summary.uniquePositions)}</div>
        </div>
        <div className="rounded-lg border border-border-soft bg-surface-2/40 p-3">
          <div className="text-xs text-muted">Equity %</div>
          <div className="num mt-1 font-semibold">{pct(summary.equityPct * 100)}</div>
        </div>
        <div className="rounded-lg border border-border-soft bg-surface-2/40 p-3">
          <div className="text-xs text-muted">Available Cash</div>
          <div className="num mt-1 font-semibold">{usd(summary.availableCash)}</div>
        </div>
      </div>
    </div>
  )
}
