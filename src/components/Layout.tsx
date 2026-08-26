import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { RefreshCw, ChevronDown, Layers, RotateCcw, Zap, FlaskConical, Upload } from 'lucide-react'
import { useStore } from '../lib/store'
import { schwabStatus, schwabSync } from '../lib/api'
import { relTime } from '../lib/format'
import clsx from 'clsx'

// Brand mark: a rounded gradient tile with an upward "portfolio growth" line.
function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" fill="none" aria-hidden>
      <defs>
        <linearGradient id="sf-mark" x1="0" y1="0" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#34d17d" />
          <stop offset="1" stopColor="#3fd6c8" />
        </linearGradient>
      </defs>
      <rect width="34" height="34" rx="9" fill="url(#sf-mark)" />
      <path d="M7 25 L13 19 L18 22 L27 10 L27 27 L7 27 Z" fill="#0a1512" fillOpacity="0.18" />
      <path
        d="M7 25 L13 19 L18 22 L27 10"
        stroke="#ffffff"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="27" cy="10" r="2.2" fill="#ffffff" />
    </svg>
  )
}

function Logo() {
  return (
    <NavLink to="/" className="flex shrink-0 items-center gap-2.5 pr-1">
      <LogoMark />
      <span className="hidden text-[17px] font-bold tracking-tight sm:block">
        <span className="text-ink">Simon</span>
        <span className="bg-gradient-to-r from-[#34d17d] to-[#3fd6c8] bg-clip-text text-transparent">
          FIRE
        </span>
      </span>
    </NavLink>
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
  { to: '/allocation', label: 'Allocation' },
  { to: '/rebalance', label: 'Rebalance' },
  { to: '/connections', label: 'Connections' },
]

// A single compact pill that folds "where the data came from" and "how fresh it
// is" together, replacing the two separate badges that used to sit in the header.
function StatusPill({
  source,
  lastSyncAt,
  syncing,
}: {
  source?: string
  lastSyncAt: string
  syncing?: boolean
}) {
  const cfg = syncing
    ? { dot: 'bg-[#3fd6a8]', text: 'text-muted', icon: <RefreshCw size={11} className="animate-spin" />, label: 'Syncing…' }
    : source === 'live'
      ? { dot: 'bg-[#3fd88a]', text: 'text-[#3fd88a]', icon: <Zap size={11} />, label: 'Live · Schwab' }
      : source === 'imported'
        ? { dot: 'bg-[#5aa2ff]', text: 'text-[#5aa2ff]', icon: <Upload size={11} />, label: 'Imported' }
        : { dot: 'bg-[#f0a94a]', text: 'text-[#f0a94a]', icon: <FlaskConical size={11} />, label: 'Sample' }

  return (
    <div className="hidden items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs md:flex">
      <span className={clsx('flex items-center gap-1.5 font-medium', cfg.text)}>
        {cfg.icon}
        {cfg.label}
      </span>
      {!syncing && (
        <>
          <span className="h-3 w-px bg-border" />
          <span className="text-faint">{relTime(lastSyncAt)}</span>
        </>
      )}
    </div>
  )
}

function AvatarMenu({ onReset }: { onReset: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#3b82f6] to-[#7c3aed] text-xs font-bold text-white outline-none ring-offset-2 ring-offset-bg hover:ring-2 hover:ring-border"
      >
        RS
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          <div className="border-b border-border-soft px-4 py-3">
            <div className="text-sm font-semibold">Raymond Simon</div>
            <div className="text-xs text-faint">SimonFIRE portfolio</div>
          </div>
          <button
            onClick={() => {
              setOpen(false)
              onReset()
            }}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-muted hover:bg-surface-2 hover:text-ink"
          >
            <RotateCcw size={15} /> Reset to sample data
          </button>
        </div>
      )}
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
  // every browser/device shows the real portfolio without a manual sync.
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

  // Manual sync: pull live from Schwab if connected, otherwise refresh sample prices.
  const doSync = async () => {
    setSyncing(true)
    try {
      const st = await schwabStatus()
      if (st.connected) {
        const r = await schwabSync()
        if (r.ok && r.payload) applyImport(r.payload, 'replace', 'live')
        else syncAll()
      } else {
        syncAll()
      }
    } finally {
      setSyncing(false)
    }
  }

  const handleReset = () => {
    if (confirm('Reset all data back to the sample dataset?')) reset()
  }

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-border-soft bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1360px] items-center gap-4 px-4 py-3 lg:px-8">
          <Logo />
          <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  clsx(
                    'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-surface-2 text-[#3fd6a8]'
                      : 'text-muted hover:bg-surface-2 hover:text-ink',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <StatusPill source={data.source} lastSyncAt={data.lastSyncAt} syncing={autoSyncing} />
            <button
              onClick={doSync}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-medium hover:bg-[#1c2740]"
              title="Sync now"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Sync</span>
            </button>
            <AvatarMenu onReset={handleReset} />
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
