import { Link } from 'react-router-dom'
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
} from 'lucide-react'
import { useStore, useScoped } from '../lib/store'
import { portfolioSummary } from '../lib/calc'
import { usd, pct, intfmt, relTime, posNeg } from '../lib/format'
import { KpiCard, PageHeader } from '../components/ui'

export default function Dashboard() {
  const { data } = useStore()
  const { positions, accounts, transactions, scope, lastSyncAt } = useScoped()
  const s = portfolioSummary(positions, accounts, scope, transactions)
  const shownAccounts = accounts.filter((a) => scope === 'all' || a.id === scope)

  return (
    <div>
      <PageHeader title="Portfolio Dashboard" subtitle="Overview of your investment accounts" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Gross Portfolio Value"
          value={usd(s.gross)}
          icon={<BarChart3 size={20} />}
          tile="green"
        />
        <KpiCard
          label="Net Portfolio Value"
          value={usd(s.net)}
          icon={<DollarSign size={20} />}
          tile="blue"
        />
        <KpiCard
          label="Margin Used"
          value={usd(s.marginUsed)}
          icon={<TrendingDown size={20} />}
          tile="red"
        />
        <KpiCard
          label="Equity %"
          value={pct(s.equityPct * 100)}
          icon={<Percent size={20} />}
          tile="orange"
        />
      </div>

      <div className="card mt-4 grid grid-cols-1 divide-y divide-[--color-border-soft] p-0 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <SubStat icon={<Layers size={18} />} label="Unique Positions" value={intfmt(s.uniquePositions)} />
        <SubStat
          icon={<Wallet size={18} />}
          label="Available Cash (incl. unsettled)"
          value={usd(s.availableCash)}
        />
        <SubStat icon={<Clock size={18} />} label="Last Sync" value={relTime(lastSyncAt)} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <MoveCard label="Day Change" amount={s.dayChange} pctv={s.dayChangePct * 100} />
        <MoveCard label="Total Gain" amount={s.totalGain} pctv={s.totalGainPct * 100} />
        <MoveCard
          label="Total Return"
          amount={s.totalReturn}
          pctv={s.totalReturnPct * 100}
          note="incl. dividends & realized"
        />
      </div>

      <div className="mt-10 mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Your Accounts</h2>
        <Link
          to="/connections"
          className="flex items-center gap-1 text-sm font-medium text-[--color-brand] hover:underline"
        >
          Manage Connections <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {shownAccounts.map((a) => {
          const val = data.positions
            .filter((p) => p.accountId === a.id)
            .reduce((sum, p) => sum + p.shares * p.lastPrice, 0)
          return (
            <div key={a.id} className="card flex items-center gap-4 p-5">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#10233f] text-[#5aa2ff]">
                <Building2 size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{a.broker}</span>
                  {a.isMargin && (
                    <span className="rounded-md bg-[#3a1a12] px-1.5 py-0.5 text-[10px] font-medium text-[#f0a94a]">
                      Margin
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-[--color-faint]">{a.fullName}</div>
              </div>
              <div className="num text-right text-sm font-semibold">{usd(val)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SubStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3 p-5">
      <div className="grid h-10 w-10 place-items-center rounded-lg bg-[--color-surface-2] text-[--color-muted]">
        {icon}
      </div>
      <div>
        <div className="text-xs text-[--color-muted]">{label}</div>
        <div className="num text-lg font-semibold">{value}</div>
      </div>
    </div>
  )
}

function MoveCard({
  label,
  amount,
  pctv,
  note,
}: {
  label: string
  amount: number
  pctv: number
  note?: string
}) {
  return (
    <div className="card p-5">
      <div className="text-sm text-[--color-muted]">{label}</div>
      <div className={`num mt-1 text-2xl font-semibold ${posNeg(amount)}`}>
        {usd(amount, { sign: true })}
      </div>
      <div className={`text-sm ${posNeg(pctv)}`}>{pct(pctv, { sign: true })}</div>
      {note && <div className="mt-1 text-xs text-[--color-faint]">{note}</div>}
    </div>
  )
}
