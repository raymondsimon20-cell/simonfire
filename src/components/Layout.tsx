import { NavLink, Outlet } from 'react-router-dom'
import { useState } from 'react'
import { RefreshCw, ChevronDown, Layers, Clock, RotateCcw } from 'lucide-react'
import { useStore } from '../lib/store'
import { relTime } from '../lib/format'
import clsx from 'clsx'

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
        <div className="text-[11px] font-semibold tracking-wide text-[--color-muted]">
          PROCEED TO
        </div>
        <div className="-mt-0.5 text-[11px] font-semibold tracking-wide text-[--color-muted]">
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
        className="flex items-center gap-2 rounded-lg border border-[--color-border] bg-[--color-surface-2] px-3 py-2 text-sm hover:bg-[#1c2740]"
      >
        <Layers size={15} className="text-[--color-brand]" />
        <span className="font-medium">{current}</span>
        <ChevronDown size={15} className="text-[--color-faint]" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-xl border border-[--color-border] bg-[--color-surface] shadow-xl">
            <button
              className={clsx(
                'flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-[--color-surface-2]',
                scope === 'all' && 'text-[--color-brand]',
              )}
              onClick={() => {
                setScope('all')
                setOpen(false)
              }}
            >
              All Accounts <span className="text-[--color-faint]">{data.accounts.length}</span>
            </button>
            <div className="h-px bg-[--color-border-soft]" />
            {data.accounts.map((a) => (
              <button
                key={a.id}
                className={clsx(
                  'flex w-full flex-col px-4 py-2.5 text-left text-sm hover:bg-[--color-surface-2]',
                  scope === a.id && 'text-[--color-brand]',
                )}
                onClick={() => {
                  setScope(a.id)
                  setOpen(false)
                }}
              >
                <span className="font-medium">{a.name}</span>
                <span className="text-xs text-[--color-faint]">
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
  const { data, syncAll, reset } = useStore()
  const [syncing, setSyncing] = useState(false)

  const doSync = () => {
    setSyncing(true)
    setTimeout(() => {
      syncAll()
      setSyncing(false)
    }, 700)
  }

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-[--color-border-soft] bg-[--color-bg]/90 backdrop-blur">
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
                      : 'text-[--color-muted] hover:bg-[--color-surface-2] hover:text-[--color-ink]',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-[--color-border] px-2.5 py-1 text-xs text-[--color-muted] md:flex">
              <Clock size={12} className="text-[#3fd88a]" />
              {relTime(data.lastSyncAt)}
            </span>
            <button
              onClick={doSync}
              className="flex items-center gap-2 rounded-lg border border-[--color-border] bg-[--color-surface-2] px-3 py-2 text-sm font-medium hover:bg-[#1c2740]"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Sync All</span>
            </button>
            <button
              onClick={() => {
                if (confirm('Reset all data back to the sample dataset?')) reset()
              }}
              title="Reset sample data"
              className="grid h-9 w-9 place-items-center rounded-lg border border-[--color-border] bg-[--color-surface-2] text-[--color-muted] hover:bg-[#1c2740]"
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
