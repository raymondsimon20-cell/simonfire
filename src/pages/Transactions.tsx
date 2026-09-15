import { useDeferredValue, useMemo, useState } from 'react'
import { Plus, Download, Search, ChevronRight, Trash2, BookmarkPlus } from 'lucide-react'
import { useScoped, useStore } from '../lib/store'
import { TXN_TYPES } from '../lib/seed'
import { usd, num, shortDate } from '../lib/format'
import { PageHeader, Button, Badge } from '../components/ui'
import { AddContributionModal } from '../components/AddContributionModal'
import { downloadCsv } from '../lib/csv'
import clsx from 'clsx'
import { TransactionDrawer } from '../components/TransactionDrawer'
import type { Transaction } from '../lib/types'
import { usePersistentState } from '../lib/persistent-state'
import { dateRangeStart, localISODate } from '../lib/date-range'
import { duplicateTransactionIds, isClosingSale } from '../lib/transaction-review'
import { SourceBadge } from '../components/SourceBadge'
import { useConfirmDialog } from '../components/ConfirmDialog'

export default function Transactions() {
  const { data, deleteTransaction, archiveTransactions, restoreTransaction, dateRange, setSavedTransactionViews } = useStore()
  const { transactions, accounts } = useScoped()
  const [modal, setModal] = useState(false)
  const [type, setType] = usePersistentState('simonfire.transactions.type', 'all')
  const [symbol, setSymbol] = usePersistentState('simonfire.transactions.symbol', '')
  const [from, setFrom] = usePersistentState('simonfire.transactions.from', '')
  const [to, setTo] = usePersistentState('simonfire.transactions.to', '')
  const [showTotals, setShowTotals] = useState(false)
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [review, setReview] = usePersistentState('simonfire.transactions.review', 'all')
  const savedViews = data.savedTransactionViews ?? []
  const setSavedViews = setSavedTransactionViews
  const [visibleCount, setVisibleCount] = useState(200)
  const deferredSymbol = useDeferredValue(symbol)
  const [activeView, setActiveView] = useState<number | null>(null)
  const dialogs = useConfirmDialog()

  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? ''

  const duplicateIds = useMemo(() => duplicateTransactionIds(transactions), [transactions])
  const missingPlCount = useMemo(() => transactions.filter((transaction) => isClosingSale(transaction) && transaction.pl == null).length, [transactions])

  const filtered = useMemo(
    () =>
      transactions.filter((t) => {
        if (type !== 'all' && t.type !== type) return false
        if (deferredSymbol && !(t.symbol ?? '').toLowerCase().includes(deferredSymbol.toLowerCase())) return false
        if (review === 'missing-pl' && !(isClosingSale(t) && t.pl == null)) return false
        if (review === 'duplicates' && !duplicateIds.has(t.id)) return false
        const globalFrom = dateRangeStart(dateRange)
        if ((from || globalFrom) && t.date < (from || globalFrom)) return false
        if ((to || localISODate()) && t.date > (to || localISODate())) return false
        return true
      }),
    [transactions, type, deferredSymbol, review, duplicateIds, from, to, dateRange],
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
  const archiveOne = async (event: React.MouseEvent, id: string) => { event.stopPropagation(); if (await dialogs.confirm('Archive transaction', 'Archive this transaction? It remains available in Archived transactions below.', 'Archive')) deleteTransaction(id) }

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
            Totals by Type <span className="text-faint">({totalsByType.length} types)</span>
          </span>
          <span className="text-xs text-faint">Filtered rows</span>
        </button>
        {showTotals && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {totalsByType.map(([t, v]) => (
              <div key={t} className="rounded-xl border border-border-soft p-3">
                <Badge>{t}</Badge>
                <div className={clsx('num mt-2 text-sm font-semibold', v.amount >= 0 ? 'text-pos' : 'text-neg')}>
                  {usd(v.amount, { sign: true })}
                </div>
                <div className="text-xs text-faint">{v.count} txns</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card mb-4 flex flex-wrap items-center gap-3">
        <select aria-label="Saved transaction views" value={activeView ?? ''} onChange={(event) => { const index = Number(event.target.value); const view = savedViews[index]; if (!view) { setActiveView(null); return } setActiveView(index); setType(view.type); setSymbol(view.symbol); setFrom(view.from); setTo(view.to); setReview(view.review) }} className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink"><option value="">Saved views</option>{savedViews.map((view, index) => <option key={`${view.name}-${index}`} value={index}>{view.name}</option>)}</select>
        <Button onClick={async () => { const name = await dialogs.prompt('Save transaction view', 'Save the current filters for quick access.', 'View name'); if (name) { setSavedViews([...savedViews, { name, type, symbol, from, to, review }]); setActiveView(savedViews.length) } }}><BookmarkPlus size={14}/> Save view</Button>
        {activeView != null && <div className="flex items-center gap-2 text-[10px]"><button onClick={async () => { const name = await dialogs.prompt('Rename saved view', 'Choose a clearer name for this filter set.', 'View name', savedViews[activeView].name); if (name) setSavedViews(savedViews.map((view, index) => index === activeView ? { ...view, name } : view)) }} className="text-brand">Rename</button><button onClick={() => { if (activeView <= 0) return; const next = [...savedViews]; [next[activeView - 1], next[activeView]] = [next[activeView], next[activeView - 1]]; setSavedViews(next); setActiveView(activeView - 1) }} disabled={activeView === 0} className="text-muted disabled:opacity-30">↑</button><button onClick={() => { if (activeView >= savedViews.length - 1) return; const next = [...savedViews]; [next[activeView + 1], next[activeView]] = [next[activeView], next[activeView + 1]]; setSavedViews(next); setActiveView(activeView + 1) }} disabled={activeView === savedViews.length - 1} className="text-muted disabled:opacity-30">↓</button><button onClick={async () => { if (await dialogs.confirm('Delete saved view', `Delete “${savedViews[activeView].name}”?`, 'Delete')) { setSavedViews(savedViews.filter((_, index) => index !== activeView)); setActiveView(null) } }} className="text-neg">Delete</button></div>}
        <label className="flex items-center gap-2 text-sm text-muted">
          Type:
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none"
          >
            <option value="all">All Types</option>
            {TXN_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">Review:<select value={review} onChange={(event) => setReview(event.target.value)} className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none"><option value="all">All records</option><option value="missing-pl">Sales missing P/L ({missingPlCount})</option><option value="duplicates">Potential duplicates ({duplicateIds.size})</option></select></label>
        <label className="flex items-center gap-2 text-sm text-muted">
          Symbol:
          <span className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="Search symbol…"
              className="w-40 rounded-lg border border-border bg-surface-2 py-2 pl-8 pr-3 text-sm outline-none"
            />
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          Date:
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-2 py-2 text-sm outline-none [color-scheme:dark]"
          />
          <span className="text-faint">–</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-2 py-2 text-sm outline-none [color-scheme:dark]"
          />
        </label>
        {review === 'duplicates' && duplicateIds.size > 0 && <Button onClick={async () => { if (await dialogs.confirm('Archive duplicate records', `${duplicateIds.size} potential duplicate record${duplicateIds.size === 1 ? '' : 's'} will be archived. One copy remains and archived records can be restored.`, 'Archive duplicates')) archiveTransactions([...duplicateIds]) }}><Trash2 size={14}/> Archive shown duplicates</Button>}
        <span className="ml-auto text-xs text-faint">{filtered.length} transactions</span>
      </div>

      <div className="card hidden overflow-x-auto p-0 md:block">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border-soft text-left text-xs text-muted">
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
            {filtered.slice(0, visibleCount).map((t) => (
              <tr key={t.id} onClick={() => setSelectedTransaction(t)} className="group cursor-pointer border-b border-border-soft hover:bg-surface-2/40">
                <td className="whitespace-nowrap px-4 py-3 text-muted">{shortDate(t.date)}</td>
                <td className="px-4 py-3"><Badge>{t.type}</Badge></td>
                <td className="px-4 py-3 font-semibold"><span className="flex items-center gap-1.5">{t.symbol ?? '—'}<SourceBadge source={t.dataSource === 'csv' ? 'csv' : t.dataSource === 'manual' ? 'manual' : 'api'}/></span></td>
                <td className="num px-4 py-3 text-right text-faint">{t.strike ?? '-'}</td>
                <td className="num px-4 py-3 text-right text-faint">{t.exp ?? '-'}</td>
                <td className="px-4 py-3 text-xs text-muted">{accName(t.accountId)}</td>
                <td className="max-w-[260px] truncate px-4 py-3 text-muted">{t.description}{duplicateIds.has(t.id) && <span className="ml-2 rounded bg-[#c7a96b]/10 px-1.5 py-0.5 text-[10px] text-[#e1c887]" title="Same account, date, type, symbol, amount, units, and normalized description as an earlier record">Potential duplicate</span>}</td>
                <td className={clsx('num px-4 py-3 text-right font-medium', t.amount > 0 ? 'text-pos' : t.amount < 0 ? 'text-neg' : 'text-faint')}>
                  {t.amount === 0 ? usd(0) : usd(t.amount, { sign: true })}
                </td>
                <td className="num px-4 py-3 text-right">{num(t.units)}</td>
                <td className="num px-4 py-3 text-right text-faint">{t.fee ? usd(t.fee) : '-'}</td>
                <td className={clsx('num px-4 py-3 text-right', t.pl != null ? (t.pl >= 0 ? 'text-pos' : 'text-neg') : 'text-faint')}>
                  {t.pl != null ? <span title={t.plEstimated ? 'Estimated from available trade history and average cost; not a tax-lot figure' : undefined}>{t.plEstimated ? '≈' : ''}{usd(t.pl, { sign: true })}</span> : '-'}
                </td>
                <td className="px-2 py-3">
                  <button
                    onClick={(event) => { void archiveOne(event, t.id) }}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    title="Delete"
                  >
                    <Trash2 size={14} className="text-faint hover:text-neg" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > visibleCount && (
          <div className="p-3 text-center text-xs text-faint">
            Showing {visibleCount} of {filtered.length}. <button onClick={() => setVisibleCount((value) => value + 200)} className="font-semibold text-brand">Load 200 more</button>
          </div>
        )}
      </div>
      <div className="space-y-2 md:hidden">{filtered.slice(0, 400).map((t) => <button key={t.id} onClick={() => setSelectedTransaction(t)} className="card w-full p-4 text-left"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><strong>{t.symbol ?? t.type}</strong><SourceBadge source={t.dataSource === 'csv' ? 'csv' : t.dataSource === 'manual' ? 'manual' : 'api'}/></div><div className="mt-1 text-xs text-faint">{shortDate(t.date)} · {accName(t.accountId)}</div></div><span className={clsx('num text-sm font-semibold', t.amount >= 0 ? 'text-pos' : 'text-neg')}>{usd(t.amount, { sign: true })}</span></div><div className="mt-2 truncate text-xs text-muted">{t.description}</div>{isClosingSale(t) && <div className="mt-2 flex justify-between text-xs"><span className="text-faint">Realized P/L</span><span className={t.pl == null ? 'text-[#e1c887]' : t.pl >= 0 ? 'text-pos' : 'text-neg'}>{t.pl == null ? 'Needs cost basis' : usd(t.pl, { sign: true })}</span></div>}</button>)}</div>

      {(data.archivedTransactions?.length ?? 0) > 0 && <div className="card mt-4"><button onClick={() => setShowArchived((value) => !value)} className="flex w-full items-center justify-between text-sm font-semibold"><span>Archived transactions ({data.archivedTransactions!.length})</span><ChevronRight size={15} className={showArchived ? 'rotate-90' : ''}/></button>{showArchived && <div className="mt-3 divide-y divide-border-soft">{data.archivedTransactions!.map((transaction) => <div key={transaction.id} className="flex items-center gap-3 py-2 text-xs"><span className="text-faint">{transaction.date}</span><span className="min-w-0 flex-1 truncate">{transaction.description}</span><span className="num">{usd(transaction.amount)}</span><button onClick={() => restoreTransaction(transaction.id)} className="font-semibold text-brand">Restore</button></div>)}</div>}</div>}
      <AddContributionModal open={modal} onClose={() => setModal(false)} />
      <TransactionDrawer txn={selectedTransaction} onClose={() => setSelectedTransaction(null)} />
    </div>
  )
}
