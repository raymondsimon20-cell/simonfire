import { Fragment, useMemo, useState } from 'react'
import { Search, ArrowUpRight, ArrowDownRight, RefreshCcw, ArrowLeftRight, ChevronDown, Plus, X, Tags, Trash2 } from 'lucide-react'
import { useScoped, useStore } from '../lib/store'
import { ledgerKpis, groupByMonth } from '../lib/calc'
import { usd, num, shortDate, monthLabel } from '../lib/format'
import { KpiCard, PageHeader, Badge, Button } from '../components/ui'
import { TransactionDrawer } from '../components/TransactionDrawer'
import type { Transaction, TxnType } from '../lib/types'
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
  const [selected, setSelected] = useState<Transaction | null>(null)

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

      <RulesPanel presetContains={search} matchCount={filtered.length} />

      <div className="card mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          Date:
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-border bg-surface-2 px-2 py-2 text-sm outline-none [color-scheme:dark]" />
          <span className="text-faint">–</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-border bg-surface-2 px-2 py-2 text-sm outline-none [color-scheme:dark]" />
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none">
          <option value="all">Category</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbol" className="w-32 rounded-lg border border-border bg-surface-2 py-2 pl-8 pr-3 text-sm outline-none" />
        </span>
        <span className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search transactions…" className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-8 pr-3 text-sm outline-none" />
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Inflows" value={usd(kpis.totalInflows, { sign: true })} valueClass="text-pos" sub={`${kpis.inflowCount.toLocaleString()} transactions`} icon={<ArrowUpRight size={20} />} tile="green" />
        <KpiCard label="Total Expenses" value={usd(-kpis.totalExpenses, { sign: true })} valueClass="text-neg" sub={`${kpis.expenseCount.toLocaleString()} transactions`} icon={<ArrowDownRight size={20} />} tile="orange" info="Bills, fees, interest, withdrawals." />
        <KpiCard label="Capital Deployed" value={usd(-kpis.capitalDeployed, { sign: true })} valueClass="text-[#b18aff]" sub={`${kpis.capitalCount.toLocaleString()} transactions`} icon={<RefreshCcw size={20} />} tile="purple" info="Cash used to buy positions." />
        <KpiCard label="Net Cash Movement" value={usd(kpis.netCashMovement, { sign: true })} valueClass={kpis.netCashMovement >= 0 ? 'text-pos' : 'text-neg'} sub={`${kpis.totalCount.toLocaleString()} transactions total`} icon={<ArrowLeftRight size={20} />} tile="blue" />
      </div>

      <div className="card mt-4 overflow-x-auto p-0">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-border-soft text-left text-xs text-muted">
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
                    className="cursor-pointer border-b border-border-soft bg-surface-2/50"
                    onClick={() => setCollapsed((c) => ({ ...c, [g.ym]: !c[g.ym] }))}
                  >
                    <td className="px-4 py-3 font-semibold" colSpan={4}>
                      <span className="flex items-center gap-2">
                        <ChevronDown size={15} className={clsx('transition-transform', isCollapsed && '-rotate-90')} />
                        {monthLabel(g.ym)} <span className="text-faint">({g.count})</span>
                      </span>
                    </td>
                    <td className="px-4 py-3" />
                    <td className="num px-4 py-3 text-right text-xs">
                      <span className="text-pos">{usd(g.inflows, { sign: true })}</span>{' '}
                      <span className="text-neg">{usd(-g.expenses, { sign: true })}</span>{' '}
                      <span className="text-[#b18aff]">{usd(-g.deployed, { sign: true })}</span>
                    </td>
                    <td className="num px-4 py-3 text-right text-xs" colSpan={2}>
                      <span className="text-muted">Net </span>
                      <span className={g.net >= 0 ? 'text-pos' : 'text-neg'}>{usd(g.net, { sign: true })}</span>
                    </td>
                  </tr>
                  {!isCollapsed &&
                    g.rows.slice(0, 300).map((t) => (
                      <LedgerRow key={t.id} t={t} account={accName(t.accountId)} onOpen={setSelected} />
                    ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <TransactionDrawer txn={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function RulesPanel({ presetContains, matchCount }: { presetContains: string; matchCount: number }) {
  const { data, addRule, updateRule, removeRule } = useStore()
  const rules = data.tagRules ?? []
  const [open, setOpen] = useState(false)
  const [contains, setContains] = useState('')
  const [tag, setTag] = useState('')
  const [setType, setSetType] = useState('')

  const add = () => {
    const c = contains.trim()
    const t = tag.trim()
    if (!c || (!t && !setType)) return
    addRule({ contains: c, tag: t, setType: (setType || undefined) as TxnType | undefined, enabled: true })
    setContains('')
    setTag('')
    setSetType('')
  }

  return (
    <div className="card mb-4 p-0">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-5 py-3.5 text-left">
        <Tags size={17} className="text-brand" />
        <span className="font-semibold">Tag Rules</span>
        <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-faint">{rules.length}</span>
        <span className="text-xs text-faint">auto-apply to existing &amp; future transactions</span>
        <ChevronDown size={16} className={clsx('ml-auto text-faint transition-transform', !open && '-rotate-90')} />
      </button>

      {open && (
        <div className="border-t border-border-soft p-5">
          {/* Add rule */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted">
              <div className="mb-1">Description contains</div>
              <input
                value={contains}
                onChange={(e) => setContains(e.target.value)}
                placeholder="e.g. BEST EGG"
                className="w-48 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-brand"
              />
            </label>
            <label className="text-xs text-muted">
              <div className="mb-1">Apply tag</div>
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="e.g. Loan payment"
                className="w-40 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-brand"
              />
            </label>
            <label className="text-xs text-muted">
              <div className="mb-1">Set category (optional)</div>
              <select value={setType} onChange={(e) => setSetType(e.target.value)} className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none">
                <option value="">— leave as is —</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <Button variant="primary" onClick={add}><Plus size={15} /> Add rule</Button>
            {presetContains.trim() && (
              <button
                onClick={() => setContains(presetContains.trim())}
                className="text-xs text-brand hover:underline"
                title={`Use your current search (${matchCount} matching now)`}
              >
                Use search “{presetContains.trim()}” ({matchCount})
              </button>
            )}
          </div>

          {/* Existing rules */}
          {rules.length > 0 && (
            <div className="mt-4 space-y-2">
              {rules.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border-soft bg-surface-2/40 px-3 py-2 text-sm">
                  <input type="checkbox" checked={r.enabled} onChange={(e) => updateRule(r.id, { enabled: e.target.checked })} className="h-4 w-4 accent-[#3fd88a]" />
                  <span className="text-muted">contains</span>
                  <span className="rounded-md bg-surface px-2 py-0.5 font-mono text-xs">{r.contains}</span>
                  <span className="text-faint">→</span>
                  {r.tag && <span className="rounded-md bg-[#123024] px-2 py-0.5 text-xs font-medium text-[#3fd88a]">{r.tag}</span>}
                  {r.setType && <span className="text-xs text-muted">set <Badge>{r.setType}</Badge></span>}
                  <button onClick={() => removeRule(r.id)} className="ml-auto text-faint hover:text-neg"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-faint">
            Rules match on the transaction description (case-insensitive) and apply everywhere the tag or category shows — automatically, on every sync.
          </p>
        </div>
      )}
    </div>
  )
}

function LedgerRow({
  t,
  account,
  onOpen,
}: {
  t: Transaction
  account: string
  onOpen: (t: Transaction) => void
}) {
  const { addTag, removeTag } = useStore()
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')

  const commit = () => {
    if (val.trim()) addTag(t.id, val.trim())
    setVal('')
    setEditing(false)
  }

  return (
    <tr
      onClick={() => onOpen(t)}
      className="cursor-pointer border-b border-border-soft hover:bg-surface-2/40"
    >
      <td className="whitespace-nowrap px-4 py-3 text-muted">{shortDate(t.date)}</td>
      <td className="px-4 py-3 text-xs text-muted">{account}</td>
      <td className="px-4 py-3"><Badge>{t.type}</Badge></td>
      <td className="px-4 py-3 font-semibold">{t.symbol ?? '—'}</td>
      <td className="max-w-[280px] truncate px-4 py-3 text-muted">{t.description}</td>
      <td className={clsx('num px-4 py-3 text-right font-medium', t.amount > 0 ? 'text-pos' : t.amount < 0 ? 'text-neg' : 'text-faint')}>
        {t.amount === 0 ? usd(0) : usd(t.amount, { sign: true })}
      </td>
      <td className="num px-4 py-3 text-right">{num(t.units)}</td>
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-1">
          {t.tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-muted">
              {tag}
              <button onClick={() => removeTag(t.id, tag)}>
                <X size={11} className="hover:text-neg" />
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
              className="w-32 rounded-md border border-brand bg-surface-2 px-2 py-1 text-xs outline-none"
            />
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="grid h-5 w-5 place-items-center rounded-md text-faint hover:bg-surface-2 hover:text-ink"
            >
              <Plus size={13} />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
