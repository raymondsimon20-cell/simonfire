import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  X,
  Calendar,
  Landmark,
  Building2,
  DollarSign,
  BarChart3,
  Wallet,
  TrendingUp,
  ExternalLink,
} from 'lucide-react'
import type { Transaction } from '../lib/types'
import { useStore } from '../lib/store'
import { portfolioSummary } from '../lib/calc'
import { usd, num, shortDate, posNeg } from '../lib/format'
import { Badge } from './ui'
import clsx from 'clsx'

function Tile({
  icon,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  valueClass?: string
}) {
  return (
    <div className="rounded-xl border border-border-soft bg-surface-2/50 p-3.5">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {icon}
        <span>{label}</span>
      </div>
      <div className={clsx('num mt-1.5 text-base font-semibold', valueClass)}>{value}</div>
    </div>
  )
}

export function TransactionDrawer({
  txn,
  onClose,
}: {
  txn: Transaction | null
  onClose: () => void
}) {
  const { data } = useStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (!txn) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [txn, onClose])

  const detail = useMemo(() => {
    if (!txn) return null
    const account = data.accounts.find((a) => a.id === txn.accountId)
    const summary = portfolioSummary(data.positions, data.accounts, 'all', data.transactions)
    const holding = txn.symbol
      ? data.positions.find((p) => p.accountId === txn.accountId && p.symbol === txn.symbol)
      : undefined
    const qty = holding?.shares ?? 0
    const value = holding ? holding.shares * holding.lastPrice : 0
    return { account, summary, qty, value }
  }, [txn, data])

  const open = !!txn && !!detail

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
        {txn && detail && (
          <div className="p-6">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-lg font-bold leading-snug">{txn.description}</h2>
              <button onClick={onClose} className="text-faint hover:text-ink">
                <X size={22} />
              </button>
            </div>

            <div className="mb-3 mt-7 text-sm font-semibold text-muted">Transaction Details</div>
            <div className="grid grid-cols-2 gap-3">
              <Tile icon={<Calendar size={13} />} label="Trade Date" value={shortDate(txn.date)} />
              <Tile icon={<Calendar size={13} />} label="Settlement Date" value={shortDate(txn.date)} />
              <Tile icon={<Landmark size={13} />} label="Account" value={detail.account?.name ?? '—'} />
              <Tile icon={<Building2 size={13} />} label="Institution" value={detail.account?.broker ?? '—'} />
            </div>
            <div className="mt-3">
              <Badge>{txn.type}</Badge>
            </div>

            <div className="mb-3 mt-7 text-sm font-semibold text-muted">Financials</div>
            <div className="space-y-3">
              <Tile
                icon={<DollarSign size={13} />}
                label="Cash Impact"
                value={txn.amount === 0 ? usd(0) : usd(txn.amount, { sign: true })}
                valueClass={txn.amount > 0 ? 'text-pos' : txn.amount < 0 ? 'text-neg' : ''}
              />
              {txn.symbol && <Tile icon={<BarChart3 size={13} />} label="Symbol" value={txn.symbol} />}
              {txn.units !== 0 && <Tile icon={<BarChart3 size={13} />} label="Units" value={num(txn.units)} />}
            </div>

            <div className="mb-3 mt-7 text-sm font-semibold text-muted">Snapshot Reference</div>
            <div className="grid grid-cols-2 gap-3">
              <Tile icon={<BarChart3 size={13} />} label="GPV on Date" value={usd(detail.summary.gross, { cents: false })} />
              <Tile icon={<Wallet size={13} />} label="Net Equity" value={usd(detail.summary.net, { cents: false })} />
              <Tile icon={<DollarSign size={13} />} label="Cash Balance" value={usd(detail.account?.cash ?? 0)} />
              {txn.symbol && <Tile icon={<BarChart3 size={13} />} label={`${txn.symbol} Qty`} value={num(detail.qty)} />}
              {txn.symbol && (
                <div className="col-span-2">
                  <Tile icon={<TrendingUp size={13} />} label={`${txn.symbol} Value`} value={usd(detail.value)} valueClass={posNeg(detail.value)} />
                </div>
              )}
            </div>

            <button
              onClick={() => {
                onClose()
                navigate('/transactions')
              }}
              className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 py-3 text-sm font-medium hover:bg-[#1c2740]"
            >
              <ExternalLink size={15} /> View in Transactions
            </button>
          </div>
        )}
      </aside>
    </>,
    document.body,
  )
}
