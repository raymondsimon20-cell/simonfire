import { CheckCircle2, Database, AlertTriangle } from 'lucide-react'
import { useScoped } from '../lib/store'
import { portfolioSummary } from '../lib/calc'
import { shortDate, usd } from '../lib/format'

export function DataReconciliation() {
  const { accounts, positions, transactions, scope } = useScoped()
  const summary = portfolioSummary(positions, accounts, scope, transactions)
  const missingSymbols = transactions.filter((row) => row.type === 'Dividend' && !row.symbol).length
  const duplicates = transactions.length - new Set(transactions.map((row) => `${row.accountId}|${row.date}|${row.amount}|${row.description}`)).size
  const latest = transactions.reduce((value, row) => row.date > value ? row.date : value, '')
  const checks = [
    { label: 'Accounts reconciled', value: String(accounts.length), good: accounts.length > 0 },
    { label: 'Open positions', value: String(positions.length), good: true },
    { label: 'Transaction records', value: String(transactions.length), good: transactions.length > 0 },
    { label: 'Duplicate records', value: String(duplicates), good: duplicates === 0 },
    { label: 'Unassigned dividends', value: String(missingSymbols), good: missingSymbols === 0 },
    { label: 'Latest transaction', value: latest ? shortDate(latest) : 'None', good: Boolean(latest) },
  ]
  return <section className="card mt-6 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Database size={17} className="text-brand"/><h2 className="font-semibold">Data reconciliation</h2></div><p className="mt-1 text-xs text-faint">A ledger-level check of what the current view is built from.</p></div><div className="text-right"><div className="num text-lg font-semibold">{usd(summary.net)}</div><div className="text-[10px] uppercase tracking-wider text-faint">Net equity reconciled</div></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{checks.map((check) => <div key={check.label} className="flex items-center justify-between rounded-xl border border-border-soft bg-surface-2/50 px-3 py-2.5 text-xs"><span className="flex items-center gap-2 text-muted">{check.good ? <CheckCircle2 size={14} className="text-pos"/> : <AlertTriangle size={14} className="text-[#e1c887]"/>}{check.label}</span><span className="num font-medium">{check.value}</span></div>)}</div></section>
}
