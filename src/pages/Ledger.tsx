import { Fragment, useMemo, useState } from 'react'
import { Search, ArrowUpRight, ArrowDownRight, RefreshCcw, ArrowLeftRight, ChevronDown, Plus, X } from 'lucide-react'
import { useScoped, useStore } from '../lib/store'
import { ledgerKpis, groupByMonth } from '../lib/calc'
import { usd, num, shortDate, monthLabel } from '../lib/format'
import { KpiCard, PageHeader, Badge } from '../components/ui'
import type { Transaction } from '../lib/types'
import clsx from 'clsx'

const CATEGORIES = ['Dividend', 'Interest', 'Contribution', 'Withdrawal', 'Bill Payment', 'Fee', 'Buy', 'Sell', 'Other']

export default function Ledger() {
  const { transactions, accounts } = useScoped()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [category, setCategory] = useState('all')
  const [symbol, setSymbol] = useState('')
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? ''

  const filtered = useMemo(
    () =>
      transactions.filter((t) => {
        if (category !== 'all' && t.type !== category) return false
        if (symbol && !(t.symbol ?? '').toLowerCase().includes(symbol.toLowerCase())) return false
        if (from && t.date < from) return false
        if (to && t.date > to) return false
        if (search && !t.description.toLowerCase().includes(search.toLowerCase())) return false
        return true
      }),
    [transactions, category, symbol, from, to, search],
  )

  const kpis = useMemo(() => ledgerKpis(filtered), [filtered])
  const groups = useMemo(() => groupByMonth(filtered), [filtered])

  return (
    <div>
      <PageHeader title="Ledger" subtitle="Complete transaction ledger" />

      <div className="card mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-[--color-muted]">
          Date:
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-[--color-border] bg-[--color-surface-2] px-2 py-2 text-sm outline-none [color-scheme:dark]" />
          <span className="text-[--color-faint]">–</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-[--color-border] bg-[--color-surface-2] px-2 py-2 text-sm outline-none [color-scheme:dark]" />
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-[--color-border] bg-[--color-surface-2] px-3 py-2 text-sm text-[--color-ink] outline-none">
          <option value="all">Category</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[--color-faint]" />
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbol" className="w-32 rounded-lg border border-[--color-border] bg-[--color-surface-2] py-2 pl-8 pr-3 text-sm outline-none" />
        </span>
        <span className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[--color-faint]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search transactions…" className="w-full rounded-lg border border-[--color-border] bg-[--color-surface-2] py-2 pl-8 pr-3 text-sm outline-none" />
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Inflows" value={usd(kpis.totalInflows, { sign: true })} valueClass="text-[--color-pos]" sub={`${kpis.inflowCount.toLocaleString()} transactions`} icon={<ArrowUpRight size={20} />} tile="green" />
        <KpiCard label="Total Expenses" value={usd(-kpis.totalExpenses, { sign: true })} valueClass="text-[--color-neg]" sub={`${kpis.expenseCount.toLocaleString()} transactions`} icon={<ArrowDownRight size={20} />} tile="orange" info="Bills, fees, interest, withdrawals." />
        <KpiCard label="Capital Deployed" value={usd(-kpis.capitalDeployed, { sign: true })} valueClass="text-[#b18aff]" sub={`${kpis.capitalCount.toLocaleString()} transactions`} icon={<RefreshCcw size={20} />} tile="purple" info="Cash used to buy positions." />
        <KpiCard label="Net Cash Movement" value={usd(kpis.netCashMovement, { sign: true })} valueClass={kpis.netCashMovement >= 0 ? 'text-[--color-pos]' : 'text-[--color-neg]'} sub={`${kpis.totalCount.toLocaleString()} transactions total`} icon={<ArrowLeftRight size={20} />} tile="blue" />
      </div>

      <div className="card mt-4 overflow-x-auto p-0">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-[--color-border-soft] text-left text-xs text-[--color-muted]">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Symbol</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 text-right font-medium">Cash Impact</th>
              <th className="px-4 py-3 text-right font-medium">Units</th>
              <th className="px-4 py-3 font-medium">Tags</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const isCollapsed = collapsed[g.ym]
              return (
                <Fragment key={g.ym}>
                  <tr
                    className="cursor-pointer border-b border-[--color-border-soft] bg-[--color-surface-2]/50"
                    onClick={() => setCollapsed((c) => ({ ...c, [g.ym]: !c[g.ym] }))}
                  >
                    <td className="px-4 py-3 font-semibold" colSpan={4}>
                      <span className="flex items-center gap-2">
                        <ChevronDown size={15} className={clsx('transition-transform', isCollapsed && '-rotate-90')} />
                        {monthLabel(g.ym)} <span className="text-[--color-faint]">({g.count})</span>
                      </span>
                    </td>
                    <td className="px-4 py-3" />
                    <td className="num px-4 py-3 text-right text-xs">
                      <span className="text-[--color-pos]">{usd(g.inflows, { sign: true })}</span>{' '}
                      <span className="text-[--color-neg]">{usd(-g.expenses, { sign: true })}</span>{' '}
                      <span className="text-[#b18aff]">{usd(-g.deployed, { sign: true })}</span>
                    </td>
                    <td className="num px-4 py-3 text-right text-xs" colSpan={2}>
                      <span className="text-[--color-muted]">Net </span>
                      <span className={g.net >= 0 ? 'text-[--color-pos]' : 'text-[--color-neg]'}>{usd(g.net, { sign: true })}</span>
                    </td>
                  </tr>
                  {!isCollapsed &&
                    g.rows.slice(0, 300).map((t) => (
                      <LedgerRow key={t.id} t={t} account={accName(t.accountId)} />
                    ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LedgerRow({ t, account }: { t: Transaction; account: string }) {
  const { addTag, removeTag } = useStore()
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')

  const commit = () => {
    if (val.trim()) addTag(t.id, val.trim())
    setVal('')
    setEditing(false)
  }

  return (
    <tr className="border-b border-[--color-border-soft] hover:bg-[--color-surface-2]/40">
      <td className="whitespace-nowrap px-4 py-3 text-[--color-muted]">{shortDate(t.date)}</td>
      <td className="px-4 py-3 text-xs text-[--color-muted]">{account}</td>
      <td className="px-4 py-3"><Badge>{t.type}</Badge></td>
      <td className="px-4 py-3 font-semibold">{t.symbol ?? '—'}</td>
      <td className="max-w-[280px] truncate px-4 py-3 text-[--color-muted]">{t.description}</td>
      <td className={clsx('num px-4 py-3 text-right font-medium', t.amount > 0 ? 'text-[--color-pos]' : t.amount < 0 ? 'text-[--color-neg]' : 'text-[--color-faint]')}>
        {t.amount === 0 ? usd(0) : usd(t.amount, { sign: true })}
      </td>
      <td className="num px-4 py-3 text-right">{num(t.units)}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1">
          {t.tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-[--color-surface-2] px-1.5 py-0.5 text-xs text-[--color-muted]">
              {tag}
              <button onClick={() => removeTag(t.id, tag)}>
                <X size={11} className="hover:text-[--color-neg]" />
              </button>
            </span>
          ))}
          {editing ? (
            <input
              autoFocus
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') {
                  setVal('')
                  setEditing(false)
                }
              }}
              placeholder="Search or create…"
              className="w-32 rounded-md border border-[--color-brand] bg-[--color-surface-2] px-2 py-1 text-xs outline-none"
            />
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="grid h-5 w-5 place-items-center rounded-md text-[--color-faint] hover:bg-[--color-surface-2] hover:text-[--color-ink]"
            >
              <Plus size={13} />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
