import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Account, AppData, Connection, Position, Transaction } from './types'
import { buildSeed } from './seed'

const STORAGE_KEY = 'simonfire.data.v1'

// ---- Persistence (swap this module for a Supabase-backed one later) ----
function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppData
      if (parsed && parsed.version === 1) return parsed
    }
  } catch {
    /* ignore */
  }
  const seed = buildSeed()
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
  } catch {
    /* ignore */
  }
  return seed
}

function save(data: AppData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

const uid = () => 'x' + Math.random().toString(36).slice(2, 10)

interface StoreCtx {
  data: AppData
  scope: string // account id or 'all'
  setScope: (id: string) => void
  addTransaction: (t: Omit<Transaction, 'id' | 'tags'> & { tags?: string[] }) => void
  updateTransaction: (id: string, patch: Partial<Transaction>) => void
  deleteTransaction: (id: string) => void
  addTag: (id: string, tag: string) => void
  removeTag: (id: string, tag: string) => void
  syncAll: () => void
  syncConnection: (id: string) => void
  addConnection: (broker: string) => void
  removeConnection: (id: string) => void
  applyImport: (result: ImportPayload, mode: 'replace' | 'merge', source?: 'imported' | 'live') => void
  reset: () => void
}

export interface ImportPayload {
  accounts: Account[]
  positions: Position[]
  transactions: Transaction[]
  broker?: string
}

const Ctx = createContext<StoreCtx | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(() => load())
  const [scope, setScope] = useState<string>('all')

  useEffect(() => {
    save(data)
  }, [data])

  const mutate = useCallback((fn: (d: AppData) => AppData) => {
    setData((prev) => fn(structuredClone(prev)))
  }, [])

  const addTransaction: StoreCtx['addTransaction'] = useCallback(
    (t) => {
      mutate((d) => {
        d.transactions.unshift({ id: uid(), tags: t.tags ?? [], ...t })
        d.transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        return d
      })
    },
    [mutate],
  )

  const updateTransaction: StoreCtx['updateTransaction'] = useCallback(
    (id, patch) => {
      mutate((d) => {
        const i = d.transactions.findIndex((t) => t.id === id)
        if (i >= 0) d.transactions[i] = { ...d.transactions[i], ...patch }
        return d
      })
    },
    [mutate],
  )

  const deleteTransaction: StoreCtx['deleteTransaction'] = useCallback(
    (id) => {
      mutate((d) => {
        d.transactions = d.transactions.filter((t) => t.id !== id)
        return d
      })
    },
    [mutate],
  )

  const addTag: StoreCtx['addTag'] = useCallback(
    (id, tag) => {
      const clean = tag.trim()
      if (!clean) return
      mutate((d) => {
        const t = d.transactions.find((x) => x.id === id)
        if (t && !t.tags.includes(clean)) t.tags.push(clean)
        return d
      })
    },
    [mutate],
  )

  const removeTag: StoreCtx['removeTag'] = useCallback(
    (id, tag) => {
      mutate((d) => {
        const t = d.transactions.find((x) => x.id === id)
        if (t) t.tags = t.tags.filter((x) => x !== tag)
        return d
      })
    },
    [mutate],
  )

  const jitterPrices = (d: AppData) => {
    for (const p of d.positions) {
      p.prevClose = p.lastPrice
      p.lastPrice = +(p.lastPrice * (1 + (Math.random() - 0.5) * 0.02)).toFixed(2)
    }
  }

  const syncAll: StoreCtx['syncAll'] = useCallback(() => {
    mutate((d) => {
      const now = new Date().toISOString()
      jitterPrices(d)
      d.lastSyncAt = now
      d.connections.forEach((c: Connection) => {
        c.lastSynced = now
        c.events.unshift({ at: now, kind: 'sync', message: 'Manual sync completed' })
      })
      return d
    })
  }, [mutate])

  const syncConnection: StoreCtx['syncConnection'] = useCallback(
    (id) => {
      mutate((d) => {
        const now = new Date().toISOString()
        jitterPrices(d)
        const c = d.connections.find((x) => x.id === id)
        if (c) {
          c.lastSynced = now
          c.events.unshift({ at: now, kind: 'refresh', message: 'Connection refreshed' })
        }
        d.lastSyncAt = now
        return d
      })
    },
    [mutate],
  )

  const addConnection: StoreCtx['addConnection'] = useCallback(
    (broker) => {
      mutate((d) => {
        const now = new Date().toISOString()
        d.connections.push({
          id: uid(),
          broker,
          status: 'Active',
          accountIds: [],
          lastSynced: now,
          events: [{ at: now, kind: 'connect', message: `Connection established with ${broker}` }],
        })
        return d
      })
    },
    [mutate],
  )

  const removeConnection: StoreCtx['removeConnection'] = useCallback(
    (id) => {
      mutate((d) => {
        d.connections = d.connections.filter((c) => c.id !== id)
        return d
      })
    },
    [mutate],
  )

  const applyImport: StoreCtx['applyImport'] = useCallback(
    (result, mode, source = 'imported') => {
      const now = new Date().toISOString()
      mutate((d) => {
        d.source = source
        if (mode === 'replace') {
          d.accounts = result.accounts
          d.positions = result.positions
          d.transactions = result.transactions
        } else {
          const existingIds = new Set(d.accounts.map((a) => a.id))
          d.accounts.push(...result.accounts.filter((a) => !existingIds.has(a.id)))
          d.positions.push(...result.positions)
          d.transactions.unshift(...result.transactions)
          d.transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        }
        // Reflect the import as a connection so the Connections page shows it.
        const broker = result.broker || 'Schwab'
        d.connections = [
          {
            id: 'conn_' + uid(),
            broker,
            status: 'Active',
            accountIds: result.accounts.map((a) => a.id),
            lastSynced: now,
            events: [{ at: now, kind: 'connect', message: `Imported ${result.accounts.length} account(s) from CSV` }],
          },
          ...(mode === 'merge' ? d.connections : []),
        ]
        d.lastSyncAt = now
        return d
      })
      setScope('all')
    },
    [mutate],
  )

  const reset: StoreCtx['reset'] = useCallback(() => {
    const seed = buildSeed()
    setData(seed)
    setScope('all')
  }, [])

  const value = useMemo<StoreCtx>(
    () => ({
      data,
      scope,
      setScope,
      addTransaction,
      updateTransaction,
      deleteTransaction,
      addTag,
      removeTag,
      syncAll,
      syncConnection,
      addConnection,
      removeConnection,
      applyImport,
      reset,
    }),
    [
      data,
      scope,
      addTransaction,
      updateTransaction,
      deleteTransaction,
      addTag,
      removeTag,
      syncAll,
      syncConnection,
      addConnection,
      removeConnection,
      applyImport,
      reset,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useStore must be used within StoreProvider')
  return c
}

// Convenience: positions/transactions filtered by current account scope.
export function useScoped() {
  const { data, scope } = useStore()
  return useMemo(() => {
    const inScope = (accountId: string) => scope === 'all' || accountId === scope
    return {
      accounts: data.accounts,
      positions: data.positions.filter((p) => inScope(p.accountId)),
      transactions: data.transactions.filter((t) => inScope(t.accountId)),
      connections: data.connections,
      lastSyncAt: data.lastSyncAt,
      scope,
    }
  }, [data, scope])
}
