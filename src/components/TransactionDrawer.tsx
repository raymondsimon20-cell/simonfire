import { useEffect, useMemo, useRef, useState } from 'react'
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
  ChevronDown,
  Check,
  Pencil,
} from 'lucide-react'
import type { Transaction, TxnType } from '../lib/types'
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

const TYPE_OPTIONS: TxnType[] = [
  'Buy',
  'Sell',
  'Dividend',
  'Interest',
  'Contribution',
  'Withdrawal',
  'Bill Payment',
  'Transfer',
  'Fee',
  'Tax Withholding',
  'Corporate Action',
  'Other',
]

// Editable category: changing it also creates/updates a direction-scoped rule,
// so the classification survives Schwab replacing transaction IDs during sync.
function CategoryEditor({ txn }: { txn: Transaction }) {
  const { updateTransaction } = useStore()
  const [open, setOpen] = useState(false)
  const [localType, setLocalType] = useState<TxnType>(txn.type)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => setLocalType(txn.type), [txn.id, txn.type])
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md hover:opacity-90"
        title="Change category"
      >
        <Badge>{localType}</Badge>
        <Pencil size={12} className="text-faint" />
        <ChevronDown size={13} className="text-faint" />
      </button>
      {open && (
        <div className="absolute left-0 z-[110] mt-1.5 w-48 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          <div className="border-b border-border-soft px-3 py-2 text-xs font-medium text-faint">
            Change category · saved for future syncs
          </div>
          {TYPE_OPTIONS.map((t) => (
            <button
              key={t}
              onClick={() => {
                setLocalType(t)
                updateTransaction(txn.id, { type: t })
                setOpen(false)
              }}
              className={clsx(
                'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-2',
                t === localType ? 'text-ink' : 'text-muted',
              )}
            >
              {t}
              {t === localType && <Check size={14} className="text-brand" />}
            </button>
          ))}
        </div>
      )}
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
              <CategoryEditor txn={txn} />
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
