import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { RefreshCw, ChevronDown, Layers, RotateCcw, Zap, FlaskConical, Upload, LayoutDashboard, ChartNoAxesCombined, ReceiptText, Landmark, Coins, CalendarCheck, BookOpenText, Goal, Cable, Sparkles } from 'lucide-react'
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
          <stop stopColor="#d8bd7a" />
          <stop offset="1" stopColor="#9c7a3d" />
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
      <span className="text-[17px] font-semibold tracking-[-0.03em]">
        <span className="text-ink">Simon</span>
        <span className="bg-gradient-to-r from-[#e1c887] to-[#a98343] bg-clip-text text-transparent">
          FIRE
        </span>
      </span>
    </NavLink>
  )
}

const NAV = [
  { to: '/', label: 'Overview', end: true, icon: LayoutDashboard },
  { to: '/positions', label: 'Positions', icon: ChartNoAxesCombined },
  { to: '/transactions', label: 'Transactions', icon: ReceiptText },
  { to: '/cash-flow', label: 'Cash Flow', icon: Landmark },
  { to: '/dividends', label: 'Dividends', icon: Coins },
  { to: '/month-close', label: 'Month Close', icon: CalendarCheck },
  { to: '/ledger', label: 'Ledger', icon: BookOpenText },
  { to: '/allocation', label: 'Allocation', icon: Goal },
  { to: '/connections', label: 'Connections', icon: Cable },
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
    <div className="flex items-center gap-2 rounded-full border border-border bg-white/[0.025] px-3 py-1.5 text-xs">
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
        className="grid h-9 w-9 place-items-center rounded-full border border-[#b99550]/30 bg-gradient-to-br from-[#3a3122] to-[#171a20] text-xs font-semibold text-[#e1c887] outline-none ring-offset-2 ring-offset-bg hover:ring-2 hover:ring-[#b99550]/30"
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
        className="flex w-full items-center gap-2 rounded-xl border border-border bg-white/[0.025] px-3 py-2.5 text-sm hover:bg-white/[0.05]"
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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-white/[0.06] bg-[#090c11]/95 px-4 py-5 backdrop-blur-xl lg:flex">
        <div className="px-2"><Logo /></div>
        <div className="mt-8 flex items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">
          <Sparkles size={11} className="text-[#c7a96b]" /> Portfolio
        </div>
        <nav className="mt-3 flex flex-1 flex-col gap-1">
          {NAV.map((n) => {
            const Icon = n.icon
            return (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => clsx('group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all', isActive ? 'bg-gradient-to-r from-[#c7a96b]/15 to-transparent text-[#e4cc8e] shadow-[inset_1px_0_0_#c7a96b]' : 'text-muted hover:bg-white/[0.035] hover:text-ink')}>
                <Icon size={17} strokeWidth={1.7} /> {n.label}
              </NavLink>
            )
          })}
        </nav>
        <div className="space-y-3 border-t border-white/[0.06] pt-4">
          <AccountScope />
          <StatusPill source={data.source} lastSyncAt={data.lastSyncAt} syncing={autoSyncing} />
          <div className="flex items-center gap-2">
            <button onClick={doSync} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-white/[0.025] px-3 py-2.5 text-sm font-medium hover:bg-white/[0.05]">
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> Sync
            </button>
            <AvatarMenu onReset={handleReset} />
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-bg/85 backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <Logo />
          <div className="ml-auto flex items-center gap-2">
            <button onClick={doSync} className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-surface" title="Sync now">
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            </button>
            <AvatarMenu onReset={handleReset} />
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto px-3 pb-2">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  clsx(
                    'whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                    isActive
                      ? 'bg-[#c7a96b]/15 text-[#e1c887]'
                      : 'text-muted hover:bg-surface-2 hover:text-ink',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[1480px] px-4 py-7 sm:px-6 lg:ml-[248px] lg:px-10 lg:py-9 xl:px-12">
        <div className="mb-5 flex justify-end lg:hidden">
          <AccountScope />
        </div>
        <Outlet />
      </main>
    </div>
  )
}
