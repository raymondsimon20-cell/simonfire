import { useEffect, useState, type ReactNode } from 'react'
import { ArrowUpRight, Clock3, ShieldCheck, Sparkles, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { MonthlyBalanceSnapshot, SnapshotStatus } from '../lib/types'
import { shortDate, usd } from '../lib/format'
import { coverageGap, historySource, type StatementMonth } from '../lib/statement-history'
import { brokerageDate } from '../lib/balance-snapshots'

export function HistoryBadge({ row }: { row: StatementMonth }) {
  const automatic = row.statements.some((item) => item.source === 'Automatic snapshot')
  const partial = !row.complete || (row.monthEnd === false && row.month < brokerageDate().slice(0, 7))
  const gap = coverageGap(row)
  return <span title={gap || undefined} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-medium tracking-wide ${partial ? 'border-amber-300/20 bg-amber-300/5 text-amber-200' : automatic ? 'border-sky-300/20 bg-sky-300/5 text-sky-200' : 'border-[#c7a96b]/25 bg-[#c7a96b]/10 text-[#e1c887]'}`}>
    {automatic ? <Clock3 size={11}/> : <ShieldCheck size={11}/>}{partial ? row.missingAccounts.length && row.statements.length ? `${row.statements.length} of ${row.statements.length + row.missingAccounts.length} accounts` : 'Partial coverage' : historySource(row)}
  </span>
}

export function SnapshotStatusBar({ snapshots, status }: { snapshots: MonthlyBalanceSnapshot[]; status?: SnapshotStatus }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer) }, [])
  const latest = snapshots.map((row) => row.latest.capturedAt).sort().at(-1)
  const stale = latest && now - new Date(latest).getTime() > 36 * 3600_000
  const attention = status?.state === 'error' || status?.state === 'reconnect' || stale
  const title = status?.state === 'reconnect' ? 'Reconnect Schwab to resume snapshots' : attention ? 'Snapshot capture needs attention' : latest ? 'Automatic tracking' : 'Ready for automatic tracking'
  const detail = status?.state === 'reconnect' ? 'Saved history is retained.' : status?.state === 'error' ? 'The last capture failed. Saved history is retained.' : stale ? `Last saved ${shortDate(latest!)}. Sync to refresh.` : latest ? `Last saved ${shortDate(latest)} · nightly and on sync${status?.state === 'partial' ? ' · transaction review needed' : ''}` : 'Connect or sync Schwab to save your first balance.'
  return <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[.06] bg-white/[.015] px-4 py-3">
    <div className="flex items-center gap-3"><span className={`h-1.5 w-1.5 rounded-full ${attention ? 'bg-amber-300' : latest ? 'bg-emerald-400 shadow-[0_0_10px_#34d39955]' : 'bg-slate-500'}`}/><div><p className="text-xs font-medium text-ink">{title}</p><p className="mt-0.5 text-[11px] text-faint">{detail}</p></div></div>
    <Link to="/connections" className="inline-flex items-center gap-1 text-[11px] text-muted transition-colors hover:text-brand">{attention || !latest ? 'Manage connection' : 'Connection details'}<ArrowUpRight size={12}/></Link>
  </div>
}

export function BalanceOverview({ equity, label, date, profit, funding, estimated, note, badge }: {
  equity?: number; label: string; date: string; profit?: number; funding?: number; estimated?: boolean; note: string; badge?: ReactNode
}) {
  return <section className="relative mb-5 overflow-hidden rounded-2xl border border-[#c7a96b]/20 bg-[radial-gradient(ellipse_at_top_right,rgba(199,169,107,0.10),transparent_65%),linear-gradient(135deg,#151b23,#0d1219)] p-5 sm:p-7">
    <div className="absolute right-[-70px] top-[-100px] h-80 w-80 rounded-full border border-[#c7a96b]/[.06]" aria-hidden="true"/>
    <div className="relative grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:gap-10">
      <div>
        <div className="mb-5 flex flex-wrap items-center gap-3"><span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[.18em] text-[#c7a96b]"><Wallet size={13}/>{label}</span>{badge}</div>
        <div className="num text-[38px] font-medium leading-none tracking-[-.055em] text-[#f4eee1] sm:text-5xl">{equity == null ? '—' : usd(equity)}</div>
        <p className="mt-3 text-xs text-muted">{date}</p>
      </div>
      <div className="grid grid-cols-2 gap-5 border-t border-white/[.07] pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-1">
        <div><div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[.1em] text-muted"><Sparkles size={12}/>Investment result</div><div className={`num text-xl tracking-[-.035em] sm:text-2xl ${profit == null ? 'text-faint' : profit >= 0 ? 'text-pos' : 'text-neg'}`}>{profit == null ? '—' : usd(profit, { sign: true })}</div><p className="mt-2 text-[11px] leading-relaxed text-faint">{estimated ? 'Estimated · ' : ''}After deposits & withdrawals</p></div>
        <div><div className="mb-3 text-[10px] uppercase tracking-[.1em] text-muted">Net funding</div><div className="num text-xl tracking-[-.035em] text-ink sm:text-2xl">{funding == null ? '—' : usd(funding, { sign: true })}</div><p className="mt-2 text-[11px] leading-relaxed text-faint">Deposits less withdrawals</p></div>
        <p className="col-span-2 border-t border-white/[.06] pt-3 text-[11px] leading-relaxed text-muted">{note}</p>
      </div>
    </div>
  </section>
}
