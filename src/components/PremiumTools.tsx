import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bell, CheckCircle2, Command, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../lib/store'
import { isClosingSale } from '../lib/transaction-review'
import { Modal } from './Modal'

const pages = [
  ['Today', '/'], ['Positions', '/positions'], ['Transactions', '/transactions'], ['Dividends', '/dividends'], ['Cash Flow', '/cash-flow'], ['Historical Value', '/history'], ['Allocation & Puts', '/allocation'], ['Reports', '/reports'], ['Data Quality', '/data-quality'], ['Connections', '/connections'],
]

export function PremiumTools() {
  const { data } = useStore()
  const navigate = useNavigate()
  const [palette, setPalette] = useState(false)
  const [notifications, setNotifications] = useState(false)
  const [query, setQuery] = useState('')
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' || event.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes((event.target as HTMLElement).tagName)) { event.preventDefault(); setPalette(true) }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [])
  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pageItems = pages.map(([label, to]) => ({ label, detail: 'Page', to }))
    const positions = data.positions.map((row) => ({ label: row.symbol, detail: `${row.name} · Position`, to: '/positions' }))
    const transactions = data.transactions.slice(0, 300).map((row) => ({ label: row.symbol ?? row.type, detail: `${row.date} · ${row.description}`, to: '/transactions' }))
    return [...pageItems, ...positions, ...transactions].filter((item) => !q || `${item.label} ${item.detail}`.toLowerCase().includes(q)).slice(0, 30)
  }, [data.positions, data.transactions, query])
  const alerts = useMemo(() => {
    const result: { label: string; detail: string; to: string }[] = []
    const missingPl = data.transactions.filter((row) => isClosingSale(row) && row.pl == null).length
    const unassigned = data.transactions.filter((row) => row.type === 'Dividend' && !row.symbol).length
    const failed = data.connections.filter((row) => row.status === 'Error').length
    const puts = (data.hedgeRolls ?? []).filter((row) => row.status === 'active' && row.rollDate <= data.lastSyncAt.slice(0, 10)).length
    if (missingPl) result.push({ label: `${missingPl} sales missing P/L`, detail: 'Upload realized gain/loss or enter cost basis.', to: '/data-quality' })
    if (unassigned) result.push({ label: `${unassigned} dividends unassigned`, detail: 'Assign symbols to improve projections.', to: '/dividends' })
    if (puts) result.push({ label: `${puts} protective puts need roll review`, detail: 'Review current value and recommendation.', to: '/allocation' })
    if (failed) result.push({ label: `${failed} connection errors`, detail: 'Reconnect Schwab to restore sync.', to: '/connections' })
    if ((data.lastSyncChanges?.csvConflicts ?? 0) > 0) result.push({ label: `${data.lastSyncChanges!.csvConflicts} API/CSV differences`, detail: 'CSV values won during the last reconciliation.', to: '/data-quality' })
    return result
  }, [data])
  const go = (to: string) => { setPalette(false); setNotifications(false); setQuery(''); navigate(to) }
  return <>
    <div className="flex items-center gap-1.5"><button onClick={() => setPalette(true)} aria-label="Open command palette" title="Search (⌘K)" className="grid h-8 w-8 place-items-center rounded-lg border border-border text-faint hover:text-ink"><Command size={14}/></button><button onClick={() => setNotifications(true)} aria-label={`${alerts.length} notifications`} title="Notifications" className="relative grid h-8 w-8 place-items-center rounded-lg border border-border text-faint hover:text-ink"><Bell size={14}/>{alerts.length > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#e1c887] px-1 text-[9px] font-bold text-black">{alerts.length}</span>}</button></div>
    <Modal open={palette} onClose={() => setPalette(false)} title="Search SimonFIRE" subtitle="Pages, holdings, transactions, and actions · ⌘K or /" width="max-w-xl"><div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint"/><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search anything…" className="w-full rounded-xl border border-border bg-surface-2 py-3 pl-10 pr-3 text-sm outline-none focus:border-brand"/></div><div className="mt-3 max-h-80 overflow-auto divide-y divide-border-soft">{items.map((item, index) => <button key={`${item.to}-${item.label}-${index}`} onClick={() => go(item.to)} className="flex w-full items-center justify-between gap-3 px-2 py-3 text-left hover:bg-surface-2"><span className="truncate text-sm font-medium">{item.label}</span><span className="max-w-[60%] truncate text-xs text-faint">{item.detail}</span></button>)}{!items.length && <div className="py-8 text-center text-sm text-faint">No matching pages or records.</div>}</div></Modal>
    <Modal open={notifications} onClose={() => setNotifications(false)} title="Notifications" subtitle="Only items that may require action" width="max-w-lg"><div className="space-y-2">{alerts.map((alert) => <button key={alert.label} onClick={() => go(alert.to)} className="flex w-full items-start gap-3 rounded-xl border border-border-soft p-3 text-left hover:bg-surface-2"><AlertTriangle size={16} className="mt-0.5 text-[#e1c887]"/><span><strong className="block text-sm">{alert.label}</strong><span className="text-xs text-faint">{alert.detail}</span></span></button>)}{!alerts.length && <div className="flex items-center gap-2 py-8 text-center text-sm text-pos"><CheckCircle2 size={17}/> You’re caught up. No action is needed.</div>}</div></Modal>
  </>
}
