import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { useScoped } from '../lib/store'
import { portfolioSummary } from '../lib/calc'
import { shortDate, usd } from '../lib/format'
import { Link } from 'react-router-dom'
import { isClosingSale } from '../lib/transaction-review'

export function DataReconciliation() {
  const { accounts, positions, transactions, scope } = useScoped()
  const summary = portfolioSummary(positions, accounts, scope, transactions)
  const missingSymbols = transactions.filter((row) => row.type === 'Dividend' && !row.symbol).length
  const duplicates = transactions.length - new Set(transactions.map((row) => `${row.accountId}|${row.date}|${row.amount}|${row.description}`)).size
  const latest = transactions.reduce((value, row) => row.date > value ? row.date : value, '')
  const missingPl = transactions.filter((row) => isClosingSale(row) && row.pl == null).length
  const exceptions = duplicates + missingSymbols + missingPl
  const checks = [
    { label: 'Accounts reconciled', value: String(accounts.length), good: accounts.length > 0 },
    { label: 'Open positions', value: String(positions.length), good: true },
    { label: 'Transaction records', value: String(transactions.length), good: transactions.length > 0 },
    { label: 'Duplicate records', value: String(duplicates), good: duplicates === 0 },
    { label: 'Unassigned dividends', value: String(missingSymbols), good: missingSymbols === 0 },
    { label: 'Sales missing P/L', value: String(missingPl), good: missingPl === 0 },
    { label: 'Latest transaction', value: latest ? shortDate(latest) : 'None', good: Boolean(latest) },
  ]
  if (!exceptions) return <section className="card mt-6 flex items-center gap-3 p-4"><CheckCircle2 size={17} className="text-pos"/><div className="flex-1"><div className="text-sm font-semibold">Data checks passed</div><div className="text-xs text-faint">No duplicates, unassigned dividends, or closing sales missing P/L.</div></div><Link to="/data-quality" className="text-xs font-semibold text-brand">View sources</Link></section>
  return <section className="card mt-6 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><AlertTriangle size={17} className="text-[#e1c887]"/><h2 className="font-semibold">{exceptions} item{exceptions === 1 ? '' : 's'} need attention</h2></div><p className="mt-1 text-xs text-faint">Resolve these to improve calculation confidence.</p></div><Link to="/data-quality" className="text-xs font-semibold text-brand">Open reconciliation center →</Link></div><div className="mt-4 grid gap-2 sm:grid-cols-3">{checks.filter((check) => !check.good).map((check) => <div key={check.label} className="flex items-center justify-between rounded-xl border border-border-soft bg-surface-2/50 px-3 py-2.5 text-xs"><span className="flex items-center gap-2 text-muted"><AlertTriangle size={14} className="text-[#e1c887]"/>{check.label}</span><span className="num font-medium">{check.value}</span></div>)}</div><div className="mt-3 text-right text-[10px] text-faint">Net equity {usd(summary.net)} · records through {latest ? shortDate(latest) : 'none'}</div></section>
}
