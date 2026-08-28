import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Account, AppData, Connection, Insights, Position, TagRule, Transaction, TwrSeries } from './types'
import { buildSeed } from './seed'
import { DEFAULT_KEEP } from './plan'
import { classifySchwabTransaction } from './transaction-classification'

const soldKey = (accountId: string, symbol: string) => `${accountId}|${symbol}`

// Reconcile every tag rule against all transactions in place. Any tag string a
// rule manages is stripped first, then re-applied only where an *enabled* rule
// still matches — so disabling or deleting a rule also removes the tags it added.
// Idempotent: safe to run on load, after each sync, and whenever rules change.
// `extraManaged` lets callers include a just-removed rule's tag in the sweep.
function applyRulesTo(d: AppData, extraManaged?: Iterable<string>) {
  const all = d.tagRules ?? []
  const managed = new Set<string>()
  for (const r of all) if (r.tag) managed.add(r.tag)
  if (extraManaged) for (const t of extraManaged) if (t) managed.add(t)
  const active = all.filter((r) => r.enabled && r.contains.trim())
  if (!managed.size && !active.length) return
  for (const t of d.transactions) {
    if (managed.size && t.tags.some((tg) => managed.has(tg))) {
      t.tags = t.tags.filter((tg) => !managed.has(tg))
    }
    const desc = t.description.toLowerCase()
    for (const r of active) {
      if (!desc.includes(r.contains.toLowerCase())) continue
      if (r.tag && !t.tags.includes(r.tag)) t.tags.push(r.tag)
      if (r.setType) t.type = r.setType
    }
  }
}

// Upgrade only transactions that are still uncategorized and match a strong,
// description-based Schwab rule. User edits and existing categories always win.
function classifyKnownOthers(d: AppData) {
  for (const t of d.transactions) {
    if (t.type !== 'Other') continue
    const classified = classifySchwabTransaction({
      description: t.description,
      amount: t.amount,
      units: t.units,
    })
    if (classified !== 'Other') t.type = classified
  }
}

const STORAGE_KEY = 'simonfire.data.v1'

// ---- Persistence (swap this module for a Supabase-backed one later) ----
function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppData
      if (parsed && parsed.version === 1) {
        if (!parsed.keepList) parsed.keepList = DEFAULT_KEEP
        if (!parsed.soldSymbols) parsed.soldSymbols = []
        if (!parsed.tagRules) parsed.tagRules = []
        // Backfill sample analytics for datasets stored before these existed.
        if (parsed.source === 'sample' && (!parsed.twr || !parsed.insights)) {
          const s = buildSeed()
          if (!parsed.twr) parsed.twr = s.twr
          if (!parsed.insights) parsed.insights = s.insights
        }
        classifyKnownOthers(parsed)
        applyRulesTo(parsed)
        return parsed
      }
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
  // Target-plan / rebalance
  setKeepList: (list: string[]) => void
  sellPosition: (accountId: string, symbol: string) => void
  sellOffPlan: (keepSet: Set<string>) => void
  unsell: (accountId: string, symbol: string) => void
  setTargetAlloc: (alloc: Record<string, number>) => void
  // Tag rules
  addRule: (rule: Omit<TagRule, 'id'>) => void
  updateRule: (id: string, patch: Partial<TagRule>) => void
  removeRule: (id: string) => void
}

export interface ImportPayload {
  accounts: Account[]
  positions: Position[]
  transactions: Transaction[]
  broker?: string
  twr?: TwrSeries
  insights?: Insights
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
        // Keep positions marked sold in the tracker out of the synced set.
        const sold = new Set(d.soldSymbols ?? [])
        if (sold.size) d.positions = d.positions.filter((p) => !sold.has(soldKey(p.accountId, p.symbol)))
        // Daily value series for time-weighted return (from the live sync).
        if (result.twr) d.twr = result.twr
        if (result.insights) d.insights = result.insights
        // Classify known Schwab descriptions, then let user rules take precedence.
        classifyKnownOthers(d)
        applyRulesTo(d)
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

  const setKeepList: StoreCtx['setKeepList'] = useCallback(
    (list) => mutate((d) => {
      d.keepList = list
      return d
    }),
    [mutate],
  )

  // Mark a holding sold: log the realized sale and drop it from the tracker.
  // Does NOT place a brokerage order — that's done at Schwab.
  const sellOne = (d: AppData, accountId: string, symbol: string) => {
    const i = d.positions.findIndex((p) => p.accountId === accountId && p.symbol === symbol)
    if (i < 0) return
    const p = d.positions[i]
    const proceeds = +(p.shares * p.lastPrice).toFixed(2)
    const pl = +(p.shares * (p.lastPrice - p.avgCost)).toFixed(2)
    d.transactions.unshift({
      id: uid(),
      accountId,
      date: new Date().toISOString().slice(0, 10),
      type: 'Sell',
      symbol,
      description: `Sold ${p.shares} ${symbol} (off-plan)`,
      amount: proceeds,
      units: -p.shares,
      pl,
      tags: ['rebalance'],
    })
    d.positions.splice(i, 1)
    d.soldSymbols = d.soldSymbols ?? []
    const key = soldKey(accountId, symbol)
    if (!d.soldSymbols.includes(key)) d.soldSymbols.push(key)
  }

  const sellPosition: StoreCtx['sellPosition'] = useCallback(
    (accountId, symbol) => mutate((d) => {
      sellOne(d, accountId, symbol)
      d.transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      return d
    }),
    [mutate],
  )

  const sellOffPlan: StoreCtx['sellOffPlan'] = useCallback(
    (keepSet) => mutate((d) => {
      const off = d.positions.filter(
        (p) => !keepSet.has(String(p.symbol).toUpperCase().replace(/[^A-Z0-9]/g, '')),
      )
      for (const p of off) sellOne(d, p.accountId, p.symbol)
      d.transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      return d
    }),
    [mutate],
  )

  const unsell: StoreCtx['unsell'] = useCallback(
    (accountId, symbol) => mutate((d) => {
      const key = soldKey(accountId, symbol)
      d.soldSymbols = (d.soldSymbols ?? []).filter((k) => k !== key)
      return d
    }),
    [mutate],
  )

  const setTargetAlloc: StoreCtx['setTargetAlloc'] = useCallback(
    (alloc) => mutate((d) => {
      d.targetAlloc = alloc
      return d
    }),
    [mutate],
  )

  const addRule: StoreCtx['addRule'] = useCallback(
    (rule) => mutate((d) => {
      d.tagRules = [...(d.tagRules ?? []), { ...rule, id: uid() }]
      applyRulesTo(d)
      return d
    }),
    [mutate],
  )

  const updateRule: StoreCtx['updateRule'] = useCallback(
    (id, patch) => mutate((d) => {
      d.tagRules = (d.tagRules ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r))
      applyRulesTo(d)
      return d
    }),
    [mutate],
  )

  const removeRule: StoreCtx['removeRule'] = useCallback(
    (id) => mutate((d) => {
      const gone = (d.tagRules ?? []).find((r) => r.id === id)
      d.tagRules = (d.tagRules ?? []).filter((r) => r.id !== id)
      applyRulesTo(d, gone?.tag ? [gone.tag] : undefined)
      return d
    }),
    [mutate],
  )

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
      setKeepList,
      sellPosition,
      sellOffPlan,
      unsell,
      setTargetAlloc,
      addRule,
      updateRule,
      removeRule,
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
      setKeepList,
      sellPosition,
      sellOffPlan,
      unsell,
      setTargetAlloc,
      addRule,
      updateRule,
      removeRule,
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
