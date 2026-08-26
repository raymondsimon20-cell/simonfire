import { useMemo, useState } from 'react'
import { Plus, Download, Search, ChevronRight, Trash2 } from 'lucide-react'
import { useScoped, useStore } from '../lib/store'
import { TXN_TYPES } from '../lib/seed'
import { usd, num, shortDate } from '../lib/format'
import { PageHeader, Button, Badge } from '../components/ui'
import { AddContributionModal } from '../components/AddContributionModal'
import { downloadCsv } from '../lib/csv'
import clsx from 'clsx'

export default function Transactions() {
  const { deleteTransaction } = useStore()
  const { transactions, accounts } = useScoped()
  const [modal, setModal] = useState(false)
  const [type, setType] = useState('all')
  const [symbol, setSymbol] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [showTotals, setShowTotals] = useState(false)

  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? ''

  const filtered = useMemo(
    () =>
      transactions.filter((t) => {
        if (type !== 'all' && t.type !== type) return false
        if (symbol && !(t.symbol ?? '').toLowerCase().includes(symbol.toLowerCase())) return false
        if (from && t.date < from) return false
        if (to && t.date > to) return false
        return true
      }),
    [transactions, type, symbol, from, to],
  )

  const totalsByType = useMemo(() => {
    const m = new Map<string, { count: number; amount: number }>()
    for (const t of filtered) {
      const e = m.get(t.type) ?? { count: 0, amount: 0 }
      e.count++
      e.amount += t.amount
      m.set(t.type, e)
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count)
  }, [filtered])

  const exportCsv = () => {
    downloadCsv('transactions.csv', [
      ['Date', 'Type', 'Symbol', 'Strike', 'Exp', 'Account', 'Description', 'Amount', 'Units', 'Fee', 'P/L'],
      ...filtered.map((t) => [
        t.date,
        t.type,
        t.symbol ?? '',
        t.strike ?? '',
        t.exp ?? '',
        accName(t.accountId),
        t.description,
        t.amount.toFixed(2),
        t.units.toFixed(4),
        t.fee?.toFixed(2) ?? '',
        t.pl?.toFixed(2) ?? '',
      ]),
    ])
  }

  return (
    <div>
      <PageHeader
        title="Transactions"
        subtitle="All transactions across your accounts"
        right={
          <>
            <Button variant="primary" onClick={() => setModal(true)}>
              <Plus size={15} /> Add Contribution
            </Button>
            <Button onClick={exportCsv}>
              <Download size={15} /> Export CSV
            </Button>
          </>
        }
      />

      <div className="card mb-4">
        <button
          onClick={() => setShowTotals((s) => !s)}
          className="flex w-full items-center justify-between"
        >
          <span className="flex items-center gap-2 font-semibold">
            <ChevronRight
              size={16}
              className={clsx('transition-transform', showTotals && 'rotate-90')}
            />
            Totals by Type <span className="text-[--color-faint]">({totalsByType.length} types)</span>
          </span>
          <span className="text-xs text-[--color-faint]">Filtered rows</span>
        </button>
        {showTotals && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {totalsByType.map(([t, v]) => (
              <div key={t} className="rounded-xl border border-[--color-border-soft] p-3">
                <Badge>{t}</Badge>
                <div className={clsx('num mt-2 text-sm font-semibold', v.amount >= 0 ? 'text-[--color-pos]' : 'text-[--color-neg]')}>
                  {usd(v.amount, { sign: true })}
                </div>
                <div className="text-xs text-[--color-faint]">{v.count} txns</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-[--color-muted]">
          Type:
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-lg border border-[--color-border] bg-[--color-surface-2] px-3 py-2 text-sm text-[--color-ink] outline-none"
          >
            <option value="all">All Types</option>
            {TXN_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-[--color-muted]">
          Symbol:
          <span className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[--color-faint]" />
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="Search symbol…"
              className="w-40 rounded-lg border border-[--color-border] bg-[--color-surface-2] py-2 pl-8 pr-3 text-sm outline-none"
            />
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm text-[--color-muted]">
          Date:
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-[--color-border] bg-[--color-surface-2] px-2 py-2 text-sm outline-none [color-scheme:dark]"
          />
          <span className="text-[--color-faint]">–</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-[--color-border] bg-[--color-surface-2] px-2 py-2 text-sm outline-none [color-scheme:dark]"
          />
        </label>
        <span className="ml-auto text-xs text-[--color-faint]">{filtered.length} transactions</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-[--color-border-soft] text-left text-xs text-[--color-muted]">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Symbol</th>
              <th className="px-4 py-3 text-right font-medium">Strike</th>
              <th className="px-4 py-3 text-right font-medium">Exp</th>
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 text-right font-medium">Units</th>
              <th className="px-4 py-3 text-right font-medium">Fee</th>
              <th className="px-4 py-3 text-right font-medium">P/L</th>
              <th className="px-2 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 400).map((t) => (
              <tr key={t.id} className="group border-b border-[--color-border-soft] hover:bg-[--color-surface-2]/40">
                <td className="whitespace-nowrap px-4 py-3 text-[--color-muted]">{shortDate(t.date)}</td>
                <td className="px-4 py-3"><Badge>{t.type}</Badge></td>
                <td className="px-4 py-3 font-semibold">{t.symbol ?? '—'}</td>
                <td className="num px-4 py-3 text-right text-[--color-faint]">{t.strike ?? '-'}</td>
                <td className="num px-4 py-3 text-right text-[--color-faint]">{t.exp ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-[--color-muted]">{accName(t.accountId)}</td>
                <td className="max-w-[260px] truncate px-4 py-3 text-[--color-muted]">{t.description}</td>
                <td className={clsx('num px-4 py-3 text-right font-medium', t.amount > 0 ? 'text-[--color-pos]' : t.amount < 0 ? 'text-[--color-neg]' : 'text-[--color-faint]')}>
                  {t.amount === 0 ? usd(0) : usd(t.amount, { sign: true })}
                </td>
                <td className="num px-4 py-3 text-right">{num(t.units)}</td>
                <td className="num px-4 py-3 text-right text-[--color-faint]">{t.fee ? usd(t.fee) : '-'}</td>
                <td className={clsx('num px-4 py-3 text-right', t.pl != null ? (t.pl >= 0 ? 'text-[--color-pos]' : 'text-[--color-neg]') : 'text-[--color-faint]')}>
                  {t.pl != null ? usd(t.pl, { sign: true }) : '-'}
                </td>
                <td className="px-2 py-3">
                  <button
                    onClick={() => deleteTransaction(t.id)}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    title="Delete"
                  >
                    <Trash2 size={14} className="text-[--color-faint] hover:text-[--color-neg]" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 400 && (
          <div className="p-3 text-center text-xs text-[--color-faint]">
            Showing first 400 of {filtered.length}. Narrow filters to see more.
          </div>
        )}
      </div>

      <AddContributionModal open={modal} onClose={() => setModal(false)} />
    </div>
  )
}
