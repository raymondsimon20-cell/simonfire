import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Wallet, TrendingUp, Percent, LineChart } from 'lucide-react'
import { useScoped } from '../lib/store'
import { availableMonths, monthClose, portfolioSummary } from '../lib/calc'
import { usd, pct, monthLabel } from '../lib/format'
import { KpiCard, PageHeader, Card } from '../components/ui'
import { Waterfall } from '../components/Charts'
import clsx from 'clsx'

export default function MonthClose() {
  const { positions, accounts, transactions, scope } = useScoped()
  const months = useMemo(() => availableMonths(transactions), [transactions])
  const [idx, setIdx] = useState(0) // 0 = most recent

  const summary = useMemo(
    () => portfolioSummary(positions, accounts, scope, transactions),
    [positions, accounts, scope, transactions],
  )
  const ym = months[idx] ?? months[0]
  const isCurrent = idx === 0
  const mc = useMemo(
    () => monthClose(accounts, transactions, scope, ym, summary),
    [positions, accounts, transactions, scope, ym, summary],
  )

  return (
    <div>
      <PageHeader
        title="Month Close"
        subtitle="Did your equity grow? Monthly reconciliation and equity tracking"
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIdx((i) => Math.min(i + 1, months.length - 1))}
              disabled={idx >= months.length - 1}
              className="grid h-9 w-9 place-items-center rounded-lg border border-[--color-border] bg-[--color-surface-2] disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="min-w-[150px] rounded-lg border border-[--color-border] bg-[--color-surface-2] px-3 py-2 text-center text-sm font-medium">
              {monthLabel(ym)} {isCurrent && <span className="text-[--color-faint]">(MTD)</span>}
            </div>
            <button
              onClick={() => setIdx((i) => Math.max(i - 1, 0))}
              disabled={idx <= 0}
              className="grid h-9 w-9 place-items-center rounded-lg border border-[--color-border] bg-[--color-surface-2] disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Closing Equity" value={usd(mc.closing)} icon={<Wallet size={20} />} tile="blue" />
        <KpiCard
          label="Net Change"
          value={usd(mc.netChange, { sign: true })}
          valueClass={mc.netChange >= 0 ? 'text-[--color-pos]' : 'text-[--color-neg]'}
          icon={<TrendingUp size={20} />}
          tile="green"
        />
        <KpiCard label="Equity %" value={pct(mc.equityPct * 100)} icon={<Percent size={20} />} tile="orange" />
        <KpiCard
          label="Market & Other"
          value={usd(mc.marketOther, { sign: true })}
          valueClass={mc.marketOther >= 0 ? 'text-[--color-pos]' : 'text-[--color-neg]'}
          icon={<LineChart size={20} />}
          tile="teal"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-4 text-lg font-semibold">Balance Sheet</div>
          <Row label="Assets" value={usd(mc.assets)} valueClass="text-[--color-pos]" />
          <Row label="Liabilities (Margin)" value={`(${usd(mc.liabilities)})`} valueClass="text-[--color-neg]" />
          <div className="my-3 h-px bg-[--color-border-soft]" />
          <Row label="Net Equity" value={usd(mc.netEquity)} bold />
          <Row label="Equity %" value={pct(mc.equityPct * 100)} valueClass="text-[--color-tile-orange] text-[#f0a94a]" />
        </Card>

        <Card>
          <div className="mb-4 text-lg font-semibold">Equity Change Bridge</div>
          <Waterfall steps={mc.bridge} height={300} />
        </Card>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  valueClass,
  bold,
}: {
  label: string
  value: string
  valueClass?: string
  bold?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className={clsx('text-sm', bold ? 'font-semibold' : 'text-[--color-muted]')}>{label}</span>
      <span className={clsx('num text-sm', bold ? 'font-semibold text-base' : '', valueClass)}>{value}</span>
    </div>
  )
}
