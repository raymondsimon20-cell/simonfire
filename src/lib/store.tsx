import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Account, AppData, Connection, HedgeRoll, IncomePlan, Insights, Position, TagRule, Transaction, TwrSeries } from './types'
import { buildSeed } from './seed'
import { DEFAULT_KEEP } from './plan'
import { classifySchwabTransaction, normalizeTransactionPattern, transactionPatternMatches } from './transaction-classification'
import { loadSharedPreferences, saveSharedPreferences, type SharedPreferences } from './api'
import { dividendDescriptionKey, resolveDividendSymbols } from './dividend-symbol'
import { populateRealizedProfitLoss } from './realized-pl'
import { summarizeSync } from './sync-summary'

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
  // Broad rules run first; the most specific matching description wins.
  const active = all
    .filter((r) => r.enabled && r.contains.trim())
    .sort((a, b) => a.contains.length - b.contains.length)
  if (!managed.size && !active.length) return
  for (const t of d.transactions) {
    if (managed.size && t.tags.some((tg) => managed.has(tg))) {
      t.tags = t.tags.filter((tg) => !managed.has(tg))
    }
    for (const r of active) {
      if (!transactionPatternMatches(t.description, r.contains)) continue
      if (r.amountDirection === 'positive' && t.amount <= 0) continue
      if (r.amountDirection === 'negative' && t.amount >= 0) continue
      if (r.amountDirection === 'zero' && t.amount !== 0) continue
      if (r.tag && !t.tags.includes(r.tag)) t.tags.push(r.tag)
      if (r.setType) { t.type = r.setType; t.classificationSource = 'rule' }
    }
  }
}

function amountDirection(amount: number): NonNullable<TagRule['amountDirection']> {
  return amount > 0 ? 'positive' : amount < 0 ? 'negative' : 'zero'
}

function upsertRule(d: AppData, rule: Omit<TagRule, 'id'>) {
  const contains = rule.contains.trim()
  const sameMatcher = (r: TagRule) =>
    r.contains.trim().toLowerCase() === contains.toLowerCase() &&
    r.amountDirection === rule.amountDirection
  const matches = (d.tagRules ?? []).filter(sameMatcher)
  const existing = matches.at(-1)
  d.tagRules = (d.tagRules ?? []).filter((r) => !sameMatcher(r))
  d.tagRules.push({
    ...existing,
    ...rule,
    contains,
    tag: rule.tag || existing?.tag || '',
    id: existing?.id ?? uid(),
  })
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
    if (classified !== 'Other') { t.type = classified; t.classificationSource = 'automatic' }
  }
}

const STORAGE_KEY = 'simonfire.data.v1'
export const DEFAULT_INCOME_PLAN: IncomePlan = { annualW2Target: 0, monthlySpending: 0, estimatedTaxRate: 20, distributionCutPct: 20, cashReserveMonths: 6, marginEquityAlertPct: 50, concentrationAlertPct: 15, incomeCoverageAlertPct: 100 }

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
        if (!parsed.bucketOverrides) parsed.bucketOverrides = {}
        parsed.incomePlan = { ...DEFAULT_INCOME_PLAN, ...(parsed.incomePlan ?? {}) }
        if (!parsed.spendingExclusions) parsed.spendingExclusions = []
        if (!parsed.archivedTransactions) parsed.archivedTransactions = []
        for (const p of parsed.positions) p.allocationBucket = parsed.bucketOverrides[`${p.accountId}|${p.symbol}`]
        // Backfill sample analytics for datasets stored before these existed.
        if (parsed.source === 'sample' && (!parsed.twr || !parsed.insights)) {
          const s = buildSeed()
          if (!parsed.twr) parsed.twr = s.twr
          if (!parsed.insights) parsed.insights = s.insights
        }
        classifyKnownOthers(parsed)
        applyRulesTo(parsed)
        if (!parsed.symbolRules) parsed.symbolRules = []
        resolveDividendSymbols(parsed.positions, parsed.transactions, parsed.symbolRules)
        populateRealizedProfitLoss(parsed.positions, parsed.transactions)
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

function sharedPreferences(data: AppData): SharedPreferences {
  return {
    bucketOverrides: data.bucketOverrides ?? {},
    tagRules: data.tagRules ?? [],
    symbolRules: data.symbolRules ?? [],
    targetAlloc: data.targetAlloc,
    keepList: data.keepList ?? DEFAULT_KEEP,
    soldSymbols: data.soldSymbols ?? [],
    incomePlan: data.incomePlan ?? DEFAULT_INCOME_PLAN,
    spendingExclusions: data.spendingExclusions ?? [],
  }
}

function applySharedPreferences(data: AppData, preferences: SharedPreferences) {
  data.bucketOverrides = preferences.bucketOverrides ?? {}
  data.tagRules = preferences.tagRules ?? []
  data.symbolRules = preferences.symbolRules ?? []
  data.targetAlloc = preferences.targetAlloc
  data.keepList = preferences.keepList ?? DEFAULT_KEEP
  data.soldSymbols = preferences.soldSymbols ?? []
  data.incomePlan = { ...DEFAULT_INCOME_PLAN, ...(data.incomePlan ?? {}), ...(preferences.incomePlan ?? {}) }
  data.spendingExclusions = preferences.spendingExclusions ?? []
  for (const position of data.positions) {
    position.allocationBucket = data.bucketOverrides[`${position.accountId}|${position.symbol}`]
  }
  const sold = new Set(data.soldSymbols)
  if (sold.size) data.positions = data.positions.filter((position) => !sold.has(soldKey(position.accountId, position.symbol)))
  applyRulesTo(data)
  resolveDividendSymbols(data.positions, data.transactions, data.symbolRules)
}

const uid = () => 'x' + Math.random().toString(36).slice(2, 10)
export type GlobalDateRange = '30' | '90' | '365' | 'all'

interface StoreCtx {
  data: AppData
  scope: string // account id or 'all'
  setScope: (id: string) => void
  dateRange: GlobalDateRange
  setDateRange: (range: GlobalDateRange) => void
  addTransaction: (t: Omit<Transaction, 'id' | 'tags'> & { tags?: string[] }) => void
  updateTransaction: (id: string, patch: Partial<Transaction>) => void
  assignTransactionSymbol: (id: string, symbol: string) => void
  enrichDividendSymbols: (matches: { transactionId: string; symbol: string }[]) => void
  deleteTransaction: (id: string) => void
  restoreTransaction: (id: string) => void
  undoLabel: string
  undoLast: () => void
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
  setPositionBucket: (accountId: string, symbol: string, bucket: NonNullable<Position['allocationBucket']>) => void
  setIncomePlan: (plan: IncomePlan) => void
  toggleSpendingExclusion: (key: string) => void
  // Tag rules
  addRule: (rule: Omit<TagRule, 'id'>) => void
  updateRule: (id: string, patch: Partial<TagRule>) => void
  removeRule: (id: string) => void
  addHedgeRoll: (roll: Omit<HedgeRoll, 'id' | 'createdAt'>) => void
  updateHedgeRoll: (id: string, patch: Partial<HedgeRoll>) => void
  removeHedgeRoll: (id: string) => void
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
  const [dateRange, setDateRangeState] = useState<GlobalDateRange>(() => (localStorage.getItem('simonfire.date-range') as GlobalDateRange) || '365')
  const [sharedReady, setSharedReady] = useState(false)
  const undoRef = useRef<AppData | null>(null)
  const [undoLabel, setUndoLabel] = useState('')
  const setDateRange = useCallback((range: GlobalDateRange) => {
    setDateRangeState(range)
    localStorage.setItem('simonfire.date-range', range)
  }, [])

  useEffect(() => {
    save(data)
  }, [data])

  // Category and planning preferences are shared through Netlify Blobs. Do not
  // publish this browser's local copy until the server copy has been hydrated,
  // otherwise a new device could overwrite established preferences on startup.
  useEffect(() => {
    let cancelled = false
    loadSharedPreferences().then((preferences) => {
      if (cancelled) return
      if (preferences) setData((previous) => {
        const next = structuredClone(previous)
        applySharedPreferences(next, preferences)
        return next
      })
      setSharedReady(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!sharedReady) return
    const timeout = window.setTimeout(() => { void saveSharedPreferences(sharedPreferences(data)) }, 350)
    return () => window.clearTimeout(timeout)
  }, [data.bucketOverrides, data.tagRules, data.symbolRules, data.targetAlloc, data.keepList, data.soldSymbols, data.incomePlan, data.spendingExclusions, sharedReady])

  const mutate = useCallback((fn: (d: AppData) => AppData, label?: string) => {
    setData((prev) => {
      if (label) { undoRef.current = structuredClone(prev); setUndoLabel(label) }
      return fn(structuredClone(prev))
    })
  }, [])
  const undoLast = useCallback(() => {
    if (!undoRef.current) return
    setData(undoRef.current)
    undoRef.current = null
    setUndoLabel('')
  }, [])

  const addTransaction: StoreCtx['addTransaction'] = useCallback(
    (t) => {
      mutate((d) => {
        d.transactions.unshift({ id: uid(), tags: t.tags ?? [], ...t })
        d.transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        return d
      }, 'Add transaction')
    },
    [mutate],
  )

  const updateTransaction: StoreCtx['updateTransaction'] = useCallback(
    (id, patch) => {
      mutate((d) => {
        const i = d.transactions.findIndex((t) => t.id === id)
        if (i >= 0) {
          d.transactions[i] = { ...d.transactions[i], ...patch }
          // Category edits are intended classifications, not ephemeral row edits.
          // Persist a direction-scoped rule so fresh Schwab rows inherit the choice.
          if (patch.type) {
            const t = d.transactions[i]
            t.classificationSource = 'manual'
            const contains = normalizeTransactionPattern(t.description) || t.description.trim()
            upsertRule(d, {
              contains,
              tag: '',
              setType: patch.type,
              amountDirection: amountDirection(t.amount),
              enabled: true,
            })
            applyRulesTo(d)
          }
        }
        return d
      }, 'Transaction edit')
    },
    [mutate],
  )

  const assignTransactionSymbol: StoreCtx['assignTransactionSymbol'] = useCallback(
    (id, rawSymbol) => mutate((d) => {
      const transaction = d.transactions.find((item) => item.id === id)
      const symbol = rawSymbol.trim().toUpperCase()
      if (!transaction || !symbol) return d
      transaction.symbol = symbol
      const contains = dividendDescriptionKey(transaction.description)
      if (contains) {
        d.symbolRules = (d.symbolRules ?? []).filter((rule) => !(rule.accountId === transaction.accountId && rule.contains === contains))
        d.symbolRules.push({ id: uid(), contains, symbol, accountId: transaction.accountId })
        resolveDividendSymbols(d.positions, d.transactions, d.symbolRules)
      }
      return d
    }, 'Symbol assignment'),
    [mutate],
  )

  const enrichDividendSymbols: StoreCtx['enrichDividendSymbols'] = useCallback(
    (matches) => mutate((d) => {
      for (const match of matches) {
        const transaction = d.transactions.find((item) => item.id === match.transactionId)
        const symbol = match.symbol.trim().toUpperCase()
        if (!transaction || !symbol) continue
        transaction.symbol = symbol
        const contains = dividendDescriptionKey(transaction.description)
        if (!contains) continue
        d.symbolRules = (d.symbolRules ?? []).filter((rule) => !(rule.accountId === transaction.accountId && rule.contains === contains))
        d.symbolRules.push({ id: uid(), contains, symbol, accountId: transaction.accountId })
      }
      resolveDividendSymbols(d.positions, d.transactions, d.symbolRules)
      return d
    }),
    [mutate],
  )

  const deleteTransaction: StoreCtx['deleteTransaction'] = useCallback(
    (id) => {
      mutate((d) => {
        const transaction = d.transactions.find((t) => t.id === id)
        if (transaction) d.archivedTransactions = [transaction, ...(d.archivedTransactions ?? [])]
        d.transactions = d.transactions.filter((t) => t.id !== id)
        return d
      }, 'Archive transaction')
    },
    [mutate],
  )

  const restoreTransaction: StoreCtx['restoreTransaction'] = useCallback(
    (id) => mutate((d) => {
      const transaction = (d.archivedTransactions ?? []).find((t) => t.id === id)
      if (transaction) d.transactions = [transaction, ...d.transactions].sort((a, b) => b.date.localeCompare(a.date))
      d.archivedTransactions = (d.archivedTransactions ?? []).filter((t) => t.id !== id)
      return d
    }, 'Restore transaction'), [mutate],
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
        const syncChanges = summarizeSync(d.positions, d.transactions, result.positions, result.transactions, now)
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
        d.bucketOverrides = d.bucketOverrides ?? {}
        for (const p of d.positions) p.allocationBucket = d.bucketOverrides[`${p.accountId}|${p.symbol}`]
        // Keep positions marked sold in the tracker out of the synced set.
        const sold = new Set(d.soldSymbols ?? [])
        if (sold.size) d.positions = d.positions.filter((p) => !sold.has(soldKey(p.accountId, p.symbol)))
        // Daily value series for time-weighted return (from the live sync).
        if (result.twr) d.twr = result.twr
        if (result.insights) d.insights = result.insights
        // Classify known Schwab descriptions, then let user rules take precedence.
        classifyKnownOthers(d)
        applyRulesTo(d)
        resolveDividendSymbols(d.positions, d.transactions, d.symbolRules)
        populateRealizedProfitLoss(d.positions, d.transactions)
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
        d.lastSyncChanges = syncChanges
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

  const setIncomePlan: StoreCtx['setIncomePlan'] = useCallback(
    (plan) => mutate((d) => { d.incomePlan = plan; return d }),
    [mutate],
  )

  const toggleSpendingExclusion: StoreCtx['toggleSpendingExclusion'] = useCallback(
    (key) => mutate((d) => {
      const excluded = new Set(d.spendingExclusions ?? [])
      if (excluded.has(key)) excluded.delete(key)
      else excluded.add(key)
      d.spendingExclusions = [...excluded]
      return d
    }, 'Spending exclusion'),
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

  const setPositionBucket: StoreCtx['setPositionBucket'] = useCallback(
    (accountId, symbol, bucket) => mutate((d) => {
      const key = `${accountId}|${symbol}`
      d.bucketOverrides = { ...(d.bucketOverrides ?? {}), [key]: bucket }
      for (const p of d.positions) if (p.accountId === accountId && p.symbol === symbol) p.allocationBucket = bucket
      return d
    }), [mutate],
  )

  const addRule: StoreCtx['addRule'] = useCallback(
    (rule) => mutate((d) => {
      upsertRule(d, rule)
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

  const addHedgeRoll: StoreCtx['addHedgeRoll'] = useCallback(
    (roll) => mutate((d) => { d.hedgeRolls = [...(d.hedgeRolls ?? []), { ...roll, id: uid(), createdAt: new Date().toISOString() }]; return d }),
    [mutate],
  )
  const updateHedgeRoll: StoreCtx['updateHedgeRoll'] = useCallback(
    (id, patch) => mutate((d) => { d.hedgeRolls = (d.hedgeRolls ?? []).map((r) => r.id === id ? { ...r, ...patch } : r); return d }),
    [mutate],
  )
  const removeHedgeRoll: StoreCtx['removeHedgeRoll'] = useCallback(
    (id) => mutate((d) => { d.hedgeRolls = (d.hedgeRolls ?? []).filter((r) => r.id !== id); return d }),
    [mutate],
  )

  const value = useMemo<StoreCtx>(
    () => ({
      data,
      scope,
      setScope,
      dateRange,
      setDateRange,
      addTransaction,
      updateTransaction,
      assignTransactionSymbol,
      enrichDividendSymbols,
      deleteTransaction,
      restoreTransaction,
      undoLabel,
      undoLast,
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
      setPositionBucket,
      setIncomePlan,
      toggleSpendingExclusion,
      addRule,
      updateRule,
      removeRule,
      addHedgeRoll,
      updateHedgeRoll,
      removeHedgeRoll,
    }),
    [
      data,
      scope,
      dateRange,
      setDateRange,
      addTransaction,
      updateTransaction,
      assignTransactionSymbol,
      enrichDividendSymbols,
      deleteTransaction,
      restoreTransaction,
      undoLabel,
      undoLast,
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
      setPositionBucket,
      setIncomePlan,
      toggleSpendingExclusion,
      addRule,
      updateRule,
      removeRule,
      addHedgeRoll,
      updateHedgeRoll,
      removeHedgeRoll,
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
