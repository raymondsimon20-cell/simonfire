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
import { portfolioSummary, positionMetrics, investmentReturn, monthClose, availableMonths } from '../lib/calc'
import { twrForScope } from '../lib/twr'
import { schwabStatus, schwabSync } from '../lib/api'
import { usd, pct, num, relTime, monthLabel, posNeg } from '../lib/format'
import { Badge } from '../components/ui'
import { PositionDrawer } from '../components/PositionDrawer'
import { TransactionDrawer } from '../components/TransactionDrawer'
import { HoldingCell, displayPrice, displayShares } from '../components/HoldingCell'
import type { Position, Transaction } from '../lib/types'
import clsx from 'clsx'
import { useToast } from '../components/Toast'

type Tab = 'positions' | 'transactions' | 'balance'

export default function AccountDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data, applyImport, syncAll } = useStore()
  const [tab, setTab] = useState<Tab>('positions')
  const [selectedPos, setSelectedPos] = useState<Position | null>(null)
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null)
  const [syncing, setSyncing] = useState(false)
  const { push } = useToast()

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
        if (r.ok && r.payload) { applyImport(r.payload, 'replace', 'live'); push('Account synchronized', 'success') }
        else { push('Sync failed', 'error', r.error || 'Your data was not changed'); return }
      } else {
        syncAll(); push('Sample prices refreshed', 'info')
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
        <PositionsTab positions={acctPositions} transactions={acctTxns} onSelect={setSelectedPos} />
      )}
      {tab === 'transactions' && (
        <TransactionsTab transactions={acctTxns} onSelect={setSelectedTxn} />
      )}
      {tab === 'balance' && (
        <BalanceHistoryTab account={account} positions={acctPositions} txns={acctTxns} summary={summary} />
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
  transactions,
  onSelect,
}: {
  positions: Position[]
  transactions: Transaction[]
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
      totalReturn: investmentReturn(positions, transactions).investmentChange,
      cost: m.reduce((s, x) => s + x.costBasis, 0),
    }
  }, [positions, transactions])

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
              <td className="px-4 py-3"><HoldingCell p={p} /></td>
              <td className="num px-4 py-3 text-right">{num(displayShares(p))}</td>
              <td className="num px-4 py-3 text-right">{usd(displayPrice(p))}</td>
              <td className={clsx('num px-4 py-3 text-right', p.isOption ? 'text-faint' : posNeg(m.dayChange))}>{p.isOption ? '—' : usd(m.dayChange, { sign: true })}</td>
              <td className={clsx('num px-4 py-3 text-right', p.isOption ? 'text-faint' : posNeg(m.dayChange))}>{p.isOption ? '—' : pct(m.dayChangePct * 100, { sign: true })}</td>
              <td className={clsx('num px-4 py-3 text-right', posNeg(m.totalGain))}>{usd(m.totalGain, { sign: true })}</td>
              <td className={clsx('num px-4 py-3 text-right', p.isOption ? 'text-faint' : posNeg(m.totalGain))}>{p.isOption ? '—' : pct(m.totalGainPct * 100, { sign: true })}</td>
              <td className={clsx('num px-4 py-3 text-right', p.isOption ? 'text-faint' : posNeg(m.totalReturn))}>{p.isOption ? '—' : usd(m.totalReturn, { sign: true })}</td>
              <td className={clsx('num px-4 py-3 text-right', p.isOption ? 'text-faint' : posNeg(m.totalReturn))}>{p.isOption ? '—' : pct(m.totalReturnPct * 100, { sign: true })}</td>
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
  positions,
  txns,
  summary,
}: {
  account: import('../lib/types').Account
  positions: Position[]
  txns: Transaction[]
  summary: import('../lib/calc').PortfolioSummary
}) {
  const { data } = useStore()
  const rb = useMemo(() => investmentReturn(positions, txns), [positions, txns])
  const twr = useMemo(() => twrForScope(data.twr, account.id, txns), [data.twr, account.id, txns])

  const series = useMemo(() => {
    const monthsAsc = availableMonths(txns).slice(0, 14).reverse()
    let cum = rb.beginningValue
    return monthsAsc.map((ym) => {
      const flows = txns.filter((t) => t.date.slice(0, 7) === ym)
      const net = flows.reduce(
        (s, t) =>
          s +
          (t.type === 'Contribution'
            ? Math.max(0, t.amount)
            : t.type === 'Withdrawal' || t.type === 'Bill Payment'
              ? -Math.abs(t.amount)
              : 0),
        0,
      )
      cum += net
      const mc = monthClose([account], txns, account.id, ym, summary)
      return {
        month: monthLabel(ym).replace(/ 20/, " '"),
        value: +mc.netEquity.toFixed(2),
        contrib: +cum.toFixed(2),
      }
    })
  }, [account, txns, summary, rb.beginningValue])

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold">Value vs. Net Contributions</h3>
          <div className="text-sm text-muted">
            Investments {rb.investmentChange >= 0 ? 'earned' : 'lost'}{' '}
            <span className={clsx('num font-semibold', posNeg(rb.investmentChange))}>
              {usd(rb.investmentChange, { sign: true })}
            </span>{' '}
            excluding net contributions
          </div>
        </div>
        {series.length >= 2 ? (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d17d" stopOpacity={0.3} />
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
                        <div className="mb-1 text-muted">{label}</div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-[#34d17d]">Value</span>
                          <span className="num font-semibold">{usd(payload.find((p: any) => p.dataKey === 'value')?.value ?? 0)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-faint">Net contributions</span>
                          <span className="num">{usd(payload.find((p: any) => p.dataKey === 'contrib')?.value ?? 0)}</span>
                        </div>
                      </div>
                    ) : null
                  }
                />
                <Area type="monotone" dataKey="value" stroke="#34d17d" strokeWidth={2} fill="url(#eq)" />
                <Area type="monotone" dataKey="contrib" stroke="#8a97ad" strokeWidth={1.5} strokeDasharray="5 4" fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="grid place-items-center py-16 text-sm text-muted">
            Not enough history yet — this builds up as transactions accumulate.
          </div>
        )}
        <div className="mt-2 flex items-center gap-5 text-xs text-faint">
          <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded bg-[#34d17d]" /> Value</span>
          <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t border-dashed border-[#8a97ad]" /> Net contributions</span>
        </div>
      </div>

      {/* Schwab-style Investment Change breakdown */}
      <div className="card p-5">
        <BreakdownRow label="Beginning Value" value={rb.beginningValue} bold />
        <Divider />
        <BreakdownRow label="Net Contributions (This Period)" value={rb.netContributions} bold color />
        <BreakdownRow label="Contributions" value={rb.contributions} indent />
        <BreakdownRow label="Withdrawals" value={-rb.withdrawals} indent />
        <Divider />
        <BreakdownRow label="Investment Change" value={rb.investmentChange} bold color />
        <BreakdownRow label="Investment Gain / Loss" value={rb.investmentGainLoss} indent color />
        <BreakdownRow label="Income (dividends & interest)" value={rb.income} indent color />
        <BreakdownRow label="Fees & Expenses" value={-rb.fees} indent color />
        <Divider />
        <BreakdownRow label="Ending Value" value={rb.endingValue} bold />
        <BreakdownRow label="Market Value" value={rb.endingValue} indent />
        <Divider />
        <div className="flex items-center justify-between py-1">
          <span className="flex items-center gap-1.5 text-sm text-muted">
            Time-Weighted Return
            <span
              className="cursor-help text-faint"
              title="Investment performance with your deposit/withdrawal timing removed — the fund-manager metric. The Investment Change above is dollar-weighted (timing included); this is not. Option premium is neutralised (no historical option prices)."
            >
              ⓘ
            </span>
          </span>
          {twr.ok ? (
            <span className="text-sm">
              <span className={clsx('num font-semibold', posNeg(twr.twrPct))}>{pct(twr.twrPct * 100, { sign: true })}</span>
              <span className={clsx('num ml-2 text-xs', posNeg(twr.annualizedPct))}>
                {pct(twr.annualizedPct * 100, { sign: true })} ann.
              </span>
            </span>
          ) : (
            <span className="text-sm text-faint">— sync to build</span>
          )}
        </div>
      </div>
    </div>
  )
}

function Divider() {
  return <div className="my-2 border-t border-border-soft" />
}

function BreakdownRow({
  label,
  value,
  bold,
  indent,
  color,
}: {
  label: string
  value: number
  bold?: boolean
  indent?: boolean
  color?: boolean
}) {
  return (
    <div className={clsx('flex items-center justify-between py-1.5', indent && 'pl-4')}>
      <span className={clsx(bold ? 'font-semibold' : 'text-sm text-muted')}>{label}</span>
      <span
        className={clsx(
          'num',
          bold ? 'text-base font-semibold' : 'text-sm',
          color ? posNeg(value) : indent ? 'text-muted' : '',
        )}
      >
        {color || indent ? usd(value, { sign: true }) : usd(value)}
      </span>
    </div>
  )
}
