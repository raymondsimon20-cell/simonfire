import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { RefreshCw, ChevronDown, Layers, Clock, RotateCcw, Zap, FlaskConical } from 'lucide-react'
import { useStore } from '../lib/store'
import { schwabStatus, schwabSync } from '../lib/api'
import { relTime } from '../lib/format'
import clsx from 'clsx'

// Header badge showing whether the data is live, imported, or the built-in sample.
function SourceBadge({ source, syncing }: { source?: string; syncing?: boolean }) {
  if (syncing)
    return (
      <span className="hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted sm:flex">
        <RefreshCw size={11} className="animate-spin" /> Syncing…
      </span>
    )
  if (source === 'live')
    return (
      <span className="hidden items-center gap-1.5 rounded-full bg-[#123024] px-2.5 py-1 text-xs font-medium text-[#3fd88a] sm:flex">
        <Zap size={11} /> Live · Schwab
      </span>
    )
  if (source === 'imported')
    return (
      <span className="hidden items-center gap-1.5 rounded-full bg-[#10233f] px-2.5 py-1 text-xs font-medium text-[#5aa2ff] sm:flex">
        Imported
      </span>
    )
  return (
    <span className="hidden items-center gap-1.5 rounded-full bg-[#35240f] px-2.5 py-1 text-xs font-medium text-[#f0a94a] sm:flex">
      <FlaskConical size={11} /> Sample data
    </span>
  )
}

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/positions', label: 'Positions' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/cash-flow', label: 'Cash Flow' },
  { to: '/dividends', label: 'Dividends' },
  { to: '/month-close', label: 'Month Close' },
  { to: '/ledger', label: 'Ledger' },
  { to: '/connections', label: 'Connections' },
]

function Logo() {
  return (
    <div className="flex items-center gap-2 pr-2">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-[#1f6f4e] to-[#12503a] text-xs font-bold text-white">
        P2
      </div>
      <div className="hidden leading-tight sm:block">
        <div className="text-[11px] font-semibold tracking-wide text-muted">
          PROCEED TO
        </div>
        <div className="-mt-0.5 text-[11px] font-semibold tracking-wide text-muted">
          PORTFOLIO
        </div>
      </div>
    </div>
  )
}

function AccountScope() {
  const { data, scope, setScope } = useStore()
  const [open, setOpen] = useState(false)
  const current =
    scope === 'all'
      ? `All Accounts (${data.accounts.length})`
      : data.accounts.find((a) => a.id === scope)?.name ?? 'Account'
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm hover:bg-[#1c2740]"
      >
        <Layers size={15} className="text-brand" />
        <span className="font-medium">{current}</span>
        <ChevronDown size={15} className="text-faint" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
            <button
              className={clsx(
                'flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-surface-2',
                scope === 'all' && 'text-brand',
              )}
              onClick={() => {
                setScope('all')
                setOpen(false)
              }}
            >
              All Accounts <span className="text-faint">{data.accounts.length}</span>
            </button>
            <div className="h-px bg-border-soft" />
            {data.accounts.map((a) => (
              <button
                key={a.id}
                className={clsx(
                  'flex w-full flex-col px-4 py-2.5 text-left text-sm hover:bg-surface-2',
                  scope === a.id && 'text-brand',
                )}
                onClick={() => {
                  setScope(a.id)
                  setOpen(false)
                }}
              >
                <span className="font-medium">{a.name}</span>
                <span className="text-xs text-faint">
                  {a.broker} ····{a.mask}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function Layout() {
  const { data, syncAll, applyImport, reset } = useStore()
  const [syncing, setSyncing] = useState(false)
  const [autoSyncing, setAutoSyncing] = useState(false)

  // Auto-sync on load: if this browser is connected to Schwab, pull live data so
  // every browser/device shows the real portfolio without a manual Sync Now.
  useEffect(() => {
    let cancelled = false
    schwabStatus().then((st) => {
      if (cancelled || !st.connected) return
      setAutoSyncing(true)
      schwabSync().then((r) => {
        if (!cancelled && r.ok && r.payload) applyImport(r.payload, 'replace', 'live')
        if (!cancelled) setAutoSyncing(false)
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doSync = () => {
    setSyncing(true)
    setTimeout(() => {
      syncAll()
      setSyncing(false)
    }, 700)
  }

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-border-soft bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1360px] items-center gap-3 px-4 py-3 lg:px-8">
          <Logo />
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  clsx(
                    'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'text-[#3fd6a8]'
                      : 'text-muted hover:bg-surface-2 hover:text-ink',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <SourceBadge source={data.source} syncing={autoSyncing} />
            <span className="hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted md:flex">
              <Clock size={12} className="text-[#3fd88a]" />
              {relTime(data.lastSyncAt)}
            </span>
            <button
              onClick={doSync}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-medium hover:bg-[#1c2740]"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Sync All</span>
            </button>
            <button
              onClick={() => {
                if (confirm('Reset all data back to the sample dataset?')) reset()
              }}
              title="Reset sample data"
              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface-2 text-muted hover:bg-[#1c2740]"
            >
              <RotateCcw size={14} />
            </button>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#3b82f6] to-[#7c3aed] text-xs font-bold text-white">
              RS
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1360px] px-4 py-8 lg:px-8">
        <div className="mb-4 flex justify-end">
          <AccountScope />
        </div>
        <Outlet />
      </main>
    </div>
  )
}
