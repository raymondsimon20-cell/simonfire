import { ChevronRight, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../lib/store'
import { relTime, usd } from '../lib/format'

export function SyncChanges() {
  const { data } = useStore()
  const [open, setOpen] = useState(false)
  const changes = data.lastSyncChanges
  if (!changes) return null
  return <section className="card mb-6 overflow-hidden p-0"><button onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-3 p-4 text-left"><RefreshCw size={16} className="text-pos"/><span className="flex-1"><strong className="block text-sm">What changed in the last sync?</strong><span className="text-xs text-faint">{changes.newTransactions} new records · {changes.newDividends} dividends · portfolio movement {usd(changes.valueChange, { sign: true })}</span></span><span className="text-xs text-faint">{relTime(changes.at)}</span><ChevronRight size={15} className={open ? 'rotate-90' : ''}/></button>{open && <div className="grid gap-3 border-t border-border-soft p-4 text-xs sm:grid-cols-4"><Fact label="New transactions" value={String(changes.newTransactions)}/><Fact label="New dividends" value={String(changes.newDividends)}/><Fact label="Positions added / removed" value={`${changes.addedPositions.length} / ${changes.removedPositions.length}`}/><Fact label="Transactions through" value={changes.latestTransactionDate || 'None'}/>{(changes.addedPositions.length > 0 || changes.removedPositions.length > 0) && <div className="sm:col-span-4 text-faint">Added: {changes.addedPositions.join(', ') || 'none'} · Removed: {changes.removedPositions.join(', ') || 'none'}</div>}</div>}</section>
}
function Fact({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-surface-2 p-3"><div className="text-faint">{label}</div><div className="num mt-1 font-semibold">{value}</div></div> }
