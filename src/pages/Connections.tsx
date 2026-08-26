import { useState } from 'react'
import {
  RefreshCw,
  Plus,
  Upload,
  History,
  Building2,
  MoreVertical,
  ChevronDown,
  Wallet,
  Eye,
  EyeOff,
  Info,
  Trash2,
} from 'lucide-react'
import { useStore } from '../lib/store'
import { relTime } from '../lib/format'
import { PageHeader, Button, Badge } from '../components/ui'
import { Modal } from '../components/Modal'
import clsx from 'clsx'

const BROKERS = [
  { name: 'E*TRADE', status: 'Available' },
  { name: 'Charles Schwab', status: 'Available' },
  { name: 'Fidelity', status: 'Available' },
  { name: 'Robinhood', status: 'Available' },
  { name: 'Interactive Brokers', status: 'Available' },
  { name: 'Webull', status: 'Coming Soon' },
  { name: 'tastytrade', status: 'Available' },
]

export default function Connections() {
  const { data, syncAll, syncConnection, addConnection, removeConnection } = useStore()
  const [modal, setModal] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ conn_schwab: false })
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const [showLog, setShowLog] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)

  const accountsOf = (ids: string[]) => data.accounts.filter((a) => ids.includes(a.id))
  const allEvents = data.connections.flatMap((c) => c.events).sort((a, b) => (a.at < b.at ? 1 : -1))

  const doSync = () => {
    setSyncing(true)
    setTimeout(() => {
      syncAll()
      setSyncing(false)
    }, 800)
  }

  return (
    <div>
      <PageHeader
        title="Brokerage Connections"
        subtitle="Connect and sync your brokerage accounts"
        right={
          <>
            <Button onClick={doSync}>
              <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} /> Refresh
            </Button>
            <Button variant="primary" onClick={() => setModal(true)}>
              <Plus size={15} /> Connect New Broker
            </Button>
          </>
        }
      />

      <div className="card mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">Sync Status</div>
          <div className="text-sm text-[--color-muted]">Last synced: {relTime(data.lastSyncAt)}</div>
        </div>
        <div className="flex items-center gap-2">
          <button className="grid h-9 w-9 place-items-center rounded-lg border border-[--color-border] bg-[--color-surface-2] text-[--color-muted] hover:text-[--color-ink]" title="Export">
            <Upload size={15} />
          </button>
          <button className="grid h-9 w-9 place-items-center rounded-lg border border-[--color-border] bg-[--color-surface-2] text-[--color-muted] hover:text-[--color-ink]" title="History" onClick={() => setShowLog((s) => !s)}>
            <History size={15} />
          </button>
          <Button onClick={doSync}>
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} /> Sync Now
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data.connections.map((c) => {
          const accts = accountsOf(c.accountIds)
          const isOpen = expanded[c.id]
          return (
            <div key={c.id} className="card flex flex-col p-0">
              <div className="flex items-center gap-3 p-5">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#10233f] text-[#5aa2ff]">
                  <Building2 size={20} />
                </div>
                <div className="flex-1">
                  <div className="font-semibold">{c.broker}</div>
                  <div className="text-xs text-[--color-faint]">
                    {c.accountIds.length} account{c.accountIds.length === 1 ? '' : 's'} linked
                  </div>
                </div>
                <Badge>{c.status}</Badge>
                <div className="relative">
                  <button onClick={() => setMenu((m) => (m === c.id ? null : c.id))} className="text-[--color-faint] hover:text-[--color-ink]">
                    <MoreVertical size={18} />
                  </button>
                  {menu === c.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />
                      <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-[--color-border] bg-[--color-surface] shadow-xl">
                        <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[--color-surface-2]" onClick={() => { syncConnection(c.id); setMenu(null) }}>
                          <RefreshCw size={13} /> Sync now
                        </button>
                        <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[--color-neg] hover:bg-[--color-surface-2]" onClick={() => { if (confirm(`Disconnect ${c.broker}?`)) removeConnection(c.id); setMenu(null) }}>
                          <Trash2 size={13} /> Disconnect
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {c.accountIds.length > 0 && (
                <div className="border-t border-[--color-border-soft] px-5">
                  <button onClick={() => setExpanded((e) => ({ ...e, [c.id]: !e[c.id] }))} className="flex w-full items-center justify-between py-3 text-sm text-[--color-muted]">
                    Accounts
                    <ChevronDown size={16} className={clsx('transition-transform', isOpen && 'rotate-180')} />
                  </button>
                  {isOpen && (
                    <div className="space-y-2 pb-3">
                      {accts.map((a) => (
                        <div key={a.id} className="flex items-center gap-3 rounded-lg bg-[--color-surface-2] px-3 py-2.5">
                          <Wallet size={16} className="text-[--color-muted]" />
                          <div className="flex-1">
                            <div className="text-sm font-medium">{a.name}</div>
                            <div className="text-xs text-[--color-faint]">····{a.mask} · USD</div>
                          </div>
                          <button onClick={() => setHidden((h) => ({ ...h, [a.id]: !h[a.id] }))} className="text-[--color-faint] hover:text-[--color-ink]">
                            {hidden[a.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-auto flex items-center justify-between border-t border-[--color-border-soft] px-5 py-3 text-xs text-[--color-faint]">
                <span>Last synced: {relTime(c.lastSynced)}</span>
                <button onClick={() => syncConnection(c.id)} className="hover:text-[--color-ink]">
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>
          )
        })}

        <button
          onClick={() => setModal(true)}
          className="card grid min-h-[180px] place-items-center border-dashed p-5 text-center transition-colors hover:border-[--color-brand]"
        >
          <div>
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[--color-surface-2] text-[--color-brand]">
              <Plus size={22} />
            </div>
            <div className="mt-3 font-medium">Add Connection</div>
            <div className="text-xs text-[--color-faint]">Connect another broker</div>
          </div>
        </button>
      </div>

      <div className="card mt-6">
        <button onClick={() => setShowLog((s) => !s)} className="flex w-full items-center justify-between">
          <span className="flex items-center gap-2 font-semibold">
            <Info size={16} className="text-[--color-faint]" /> Connection Event Log
          </span>
          <ChevronDown size={16} className={clsx('transition-transform', showLog && 'rotate-180')} />
        </button>
        {showLog && (
          <div className="mt-4 space-y-2">
            {allEvents.map((e, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-[--color-surface-2] px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className={clsx('h-1.5 w-1.5 rounded-full', e.kind === 'error' ? 'bg-[--color-neg]' : 'bg-[#3fd88a]')} />
                  {e.message}
                </span>
                <span className="text-xs text-[--color-faint]">{relTime(e.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Connect a Brokerage" subtitle="Select your brokerage to securely connect your accounts." width="max-w-lg">
        <div className="space-y-3">
          {BROKERS.map((b) => (
            <div key={b.name} className="flex items-center gap-3 rounded-xl border border-[--color-border-soft] p-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#10233f] text-[#5aa2ff]">
                <Building2 size={18} />
              </div>
              <div className="flex-1">
                <div className="font-medium">{b.name}</div>
                <div className="text-xs text-[--color-faint]">{b.status === 'Available' ? 'Available' : 'Coming soon'}</div>
              </div>
              {b.status === 'Available' ? (
                <Button
                  onClick={() => {
                    addConnection(b.name)
                    setModal(false)
                  }}
                >
                  Connect
                </Button>
              ) : (
                <span className="rounded-md bg-[--color-surface-2] px-2.5 py-1 text-xs text-[--color-faint]">Coming Soon</span>
              )}
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-xs text-[--color-faint]">
          Your credentials are securely handled by SnapTrade. We never see or store your login information.
        </p>
      </Modal>
    </div>
  )
}
