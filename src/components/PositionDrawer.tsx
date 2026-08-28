import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  BarChart3,
  DollarSign,
  Calendar,
  TrendingUp,
  TrendingDown,
  Landmark,
  Building2,
  ListChecks,
  Info,
} from 'lucide-react'
import type { Position } from '../lib/types'
import { useStore } from '../lib/store'
import { positionMetrics } from '../lib/calc'
import { usd, pct, num, posNeg } from '../lib/format'
import clsx from 'clsx'
import { BucketBadge } from './HoldingCell'
import { bucketOf } from '../lib/buckets'

type Mode = 'Auto' | 'On' | 'Off'

function Stat({
  icon,
  label,
  value,
  valueClass,
  chevron,
}: {
  icon: React.ReactNode
  label: React.ReactNode
  value: React.ReactNode
  valueClass?: string
  chevron?: boolean
}) {
  return (
    <div className="rounded-xl border border-border-soft bg-surface-2/50 p-3.5">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {icon}
        <span>{label}</span>
        {chevron && <span className="text-faint">›</span>}
      </div>
      <div className={clsx('num mt-1.5 text-lg font-semibold', valueClass)}>{value}</div>
    </div>
  )
}

export function PositionDrawer({
  position,
  onClose,
}: {
  position: Position | null
  onClose: () => void
}) {
  const { data } = useStore()
  const [mode, setMode] = useState<Mode>('Auto')

  useEffect(() => {
    if (!position) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [position, onClose])

  const detail = useMemo(() => {
    if (!position) return null
    const m = positionMetrics(position)
    const account = data.accounts.find((a) => a.id === position.accountId)
    const related = data.transactions.filter(
      (t) => t.accountId === position.accountId && t.symbol === position.symbol,
    )
    const realized = related
      .filter((t) => t.type === 'Sell')
      .reduce((s, t) => s + (t.pl ?? 0), 0)
    const includeIncome = mode !== 'Off'
    const income = includeIncome ? position.dividendsReceived : 0
    const realizedShown = includeIncome ? realized : 0
    const totalReturn = m.totalGain + income + realizedShown
    const totalReturnPct = m.costBasis ? totalReturn / m.costBasis : 0
    return { m, account, txnCount: related.length, dividends: income, realized: realizedShown, totalReturn, totalReturnPct }
  }, [position, data, mode])

  const open = !!position && !!detail
  const p = position

  return createPortal(
    <>
      <div
        className={clsx(
          'fixed inset-0 z-[90] bg-black/60 transition-opacity',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />
      <aside
        className={clsx(
          'fixed right-0 top-0 z-[100] flex h-full w-full max-w-[440px] flex-col overflow-y-auto border-l border-border bg-surface shadow-2xl transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {p && detail && (
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold">{p.symbol}</h2>
                <BucketBadge bucket={bucketOf(p)} />
                <span
                  className={clsx(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    detail.m.dayChange >= 0 ? 'bg-[#123024] text-[#3fd88a]' : 'bg-[#33161d] text-[#f2607a]',
                  )}
                >
                  {pct(detail.m.dayChangePct * 100, { sign: true })}
                </span>
              </div>
              <button onClick={onClose} className="text-faint hover:text-ink">
                <X size={22} />
              </button>
            </div>
            <div className="mt-1 text-xs text-faint">{p.name}</div>

            {/* Position Summary */}
            <Section title="Position Summary" />
            <div className="grid grid-cols-2 gap-3">
              <Stat icon={<BarChart3 size={13} />} label="Shares" value={num(p.shares)} />
              <Stat icon={<DollarSign size={13} />} label="Price" value={usd(p.lastPrice)} />
              <div className="col-span-2">
                <Stat icon={<Calendar size={13} />} label="Market Value" value={usd(detail.m.value)} />
              </div>
            </div>

            {/* Today's Change */}
            <Section title="Today's Change" />
            <div className="grid grid-cols-2 gap-3">
              <Stat
                icon={detail.m.dayChange >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                label="Change ($)"
                value={usd(detail.m.dayChange, { sign: true })}
                valueClass={posNeg(detail.m.dayChange)}
              />
              <Stat
                icon={detail.m.dayChange >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                label="Change (%)"
                value={pct(detail.m.dayChangePct * 100, { sign: true })}
                valueClass={posNeg(detail.m.dayChange)}
              />
            </div>

            {/* Cost Basis & Unrealized Gain */}
            <Section title="Cost Basis & Unrealized Gain" />
            <div className="grid grid-cols-2 gap-3">
              <Stat icon={<DollarSign size={13} />} label="Cost Basis" value={usd(detail.m.costBasis)} />
              <Stat icon={<DollarSign size={13} />} label="Avg Cost/Share" value={usd(p.avgCost)} />
              <Stat
                icon={detail.m.totalGain >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                label="Unrealized Gain ($)"
                value={usd(detail.m.totalGain, { sign: true })}
                valueClass={posNeg(detail.m.totalGain)}
              />
              <Stat
                icon={detail.m.totalGain >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                label="Unrealized Gain (%)"
                value={pct(detail.m.totalGainPct * 100, { sign: true })}
                valueClass={posNeg(detail.m.totalGain)}
              />
            </div>

            {/* Income & Total Return */}
            <div className="mb-3 mt-7 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-muted">
                Income &amp; Total Return
                <Info size={13} className="text-faint" />
              </div>
              <div className="flex gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5 text-xs">
                {(['Auto', 'On', 'Off'] as Mode[]).map((mo) => (
                  <button
                    key={mo}
                    onClick={() => setMode(mo)}
                    className={clsx(
                      'rounded-md px-2.5 py-1 font-medium',
                      mode === mo ? 'bg-brand text-white' : 'text-muted',
                    )}
                  >
                    {mo}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat icon={<DollarSign size={13} />} label="Cash Dividends" chevron value={usd(detail.dividends)} valueClass="text-pos" />
              <Stat icon={<DollarSign size={13} />} label="Realized Gain" value={usd(detail.realized, { sign: true })} valueClass={detail.realized >= 0 ? 'text-pos' : 'text-neg'} />
              <Stat
                icon={detail.totalReturn >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                label="Total Return ($)"
                value={usd(detail.totalReturn, { sign: true })}
                valueClass={posNeg(detail.totalReturn)}
              />
              <Stat
                icon={detail.totalReturn >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                label="Total Return (%)"
                value={pct(detail.totalReturnPct * 100, { sign: true })}
                valueClass={posNeg(detail.totalReturn)}
              />
            </div>

            {/* Account Information */}
            <Section title="Account Information" />
            <div className="space-y-2">
              <InfoRow icon={<Landmark size={15} />} label="Account" value={detail.account?.name ?? '—'} />
              <InfoRow icon={<Building2 size={15} />} label="Institution" value={detail.account?.broker ?? '—'} />
              <InfoRow icon={<ListChecks size={15} />} label="Transaction Count" value={`${detail.txnCount} transactions`} />
            </div>
          </div>
        )}
      </aside>
    </>,
    document.body,
  )
}

function Section({ title }: { title: string }) {
  return <div className="mb-3 mt-7 text-sm font-semibold text-muted">{title}</div>
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border-soft bg-surface-2/50 px-4 py-3">
      <span className="text-faint">{icon}</span>
      <div>
        <div className="text-xs text-faint">{label}</div>
        <div className="text-sm font-medium">{value}</div>
      </div>
    </div>
  )
}
