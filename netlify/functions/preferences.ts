import { getStore } from '@netlify/blobs'
import { json } from './lib/schwab'
import { cleanTransactionOverrides, mergeTransactionOverrides } from '../../src/lib/transaction-overrides'
import type { TransactionOverride } from '../../src/lib/types'
import type { StatementTransactions } from '../../src/lib/types'
import { mergeStatementTransactions } from '../../src/lib/statement-transactions'

type SharedPreferences = {
  statementTransactions?: StatementTransactions[]
  transactionOverrides?: Record<string, TransactionOverride>
  bucketOverrides?: Record<string, string>
  tagRules?: unknown[]
  symbolRules?: unknown[]
  targetAlloc?: Record<string, number>
  keepList?: string[]
  soldSymbols?: string[]
  spendingExclusions?: string[]
  realizedPlOverrides?: Record<string, number>
  csvPositionAuthority?: unknown[]
  csvTransactionAuthority?: unknown[]
  importHistory?: unknown[]
  freshnessThresholds?: { positions: number; transactions: number; realizedPl: number }
  savedTransactionViews?: unknown[]
  historicalBalances?: unknown[]
  incomePlan?: {
    allocationExpenseReserve?: boolean
    allocationSizing?: 'priority' | 'gaps' | 'equal' | 'trend'
    annualW2Target: number
    monthlySpending: number
    estimatedTaxRate: number
    distributionCutPct: number
    cashReserveMonths: number
    marginEquityAlertPct: number
    concentrationAlertPct: number
    incomeCoverageAlertPct: number
  }
}

const store = () => getStore({ name: 'simonfire', consistency: 'strong' })
const KEY = 'preferences-v1'
const allowed = new Set(['Growth', 'CEFs', 'High Yield', 'Leveraged'])

function clean(input: any): SharedPreferences {
  const bucketOverrides = Object.fromEntries(
    Object.entries(input?.bucketOverrides ?? {})
      .filter(([key, value]) => key.length <= 160 && allowed.has(String(value)))
      .slice(0, 2_000),
  ) as Record<string, string>
  const tagRules = Array.isArray(input?.tagRules) ? input.tagRules
    .filter((rule: any) => rule && typeof rule === 'object' && typeof rule.id === 'string' && typeof rule.contains === 'string' && typeof rule.tag === 'string' && typeof rule.enabled === 'boolean')
    .slice(0, 500)
    .map((rule: any) => ({
      id: rule.id.slice(0, 80),
      contains: rule.contains.slice(0, 300),
      tag: rule.tag.slice(0, 100),
      ...(typeof rule.setType === 'string' ? { setType: rule.setType.slice(0, 40) } : {}),
      ...(['positive', 'negative', 'zero'].includes(rule.amountDirection) ? { amountDirection: rule.amountDirection } : {}),
      enabled: rule.enabled,
    })) : []
  const symbolRules = Array.isArray(input?.symbolRules) ? input.symbolRules
    .filter((rule: any) => rule && typeof rule.id === 'string' && typeof rule.contains === 'string' && typeof rule.symbol === 'string')
    .slice(0, 500)
    .map((rule: any) => ({ id: rule.id.slice(0, 80), contains: rule.contains.slice(0, 300), symbol: rule.symbol.replace(/[^A-Za-z0-9./-]/g, '').toUpperCase().slice(0, 20), ...(typeof rule.accountId === 'string' ? { accountId: rule.accountId.slice(0, 80) } : {}) })) : []
  const targetAlloc = Object.fromEntries(
    Object.entries(input?.targetAlloc ?? {})
      .filter(([, value]) => Number.isFinite(value) && Number(value) >= 0 && Number(value) <= 100)
      .slice(0, 20),
  ) as Record<string, number>
  const strings = (value: unknown, limit: number) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length <= 160).slice(0, limit)
    : []
  const numberIn = (value: unknown, min: number, max: number, fallback: number) => {
    const number = Number(value)
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
  }
  const rawPlan = input?.incomePlan
  const incomePlan = rawPlan && typeof rawPlan === 'object' ? {
    allocationExpenseReserve: rawPlan.allocationExpenseReserve !== false,
    allocationSizing: (['priority', 'gaps', 'equal', 'trend'].includes(rawPlan.allocationSizing) ? rawPlan.allocationSizing : 'priority') as 'priority' | 'gaps' | 'equal' | 'trend',
    annualW2Target: numberIn(rawPlan.annualW2Target, 0, 10_000_000, 0),
    monthlySpending: numberIn(rawPlan.monthlySpending, 0, 1_000_000, 0),
    estimatedTaxRate: numberIn(rawPlan.estimatedTaxRate, 0, 60, 20),
    distributionCutPct: numberIn(rawPlan.distributionCutPct, 0, 100, 20),
    cashReserveMonths: numberIn(rawPlan.cashReserveMonths, 0, 60, 6),
    marginEquityAlertPct: numberIn(rawPlan.marginEquityAlertPct, 0, 100, 50),
    concentrationAlertPct: numberIn(rawPlan.concentrationAlertPct, 0, 100, 15),
    incomeCoverageAlertPct: numberIn(rawPlan.incomeCoverageAlertPct, 0, 200, 100),
  } : undefined
  const realizedPlOverrides = Object.fromEntries(Object.entries(input?.realizedPlOverrides ?? {}).filter(([key, value]) => key.length <= 300 && Number.isFinite(value) && Math.abs(Number(value)) <= 100_000_000).slice(0, 5_000)) as Record<string, number>
  const csvPositionAuthority = Array.isArray(input?.csvPositionAuthority) ? input.csvPositionAuthority.filter((row: any) => row && typeof row.accountMask === 'string' && row.position && typeof row.position.symbol === 'string').slice(0, 5_000) : []
  const csvTransactionAuthority = Array.isArray(input?.csvTransactionAuthority) ? input.csvTransactionAuthority.filter((row: any) => row && typeof row.accountMask === 'string' && row.transaction && typeof row.transaction.date === 'string' && typeof row.transaction.amount === 'number').slice(0, 20_000) : []
  const importHistory = Array.isArray(input?.importHistory) ? input.importHistory.filter((row: any) => row && typeof row.id === 'string' && typeof row.importedAt === 'string' && Array.isArray(row.files)).slice(0, 100) : []
  const rawFreshness = input?.freshnessThresholds ?? {}
  const freshnessThresholds = {
    positions: numberIn(rawFreshness.positions, 1, 365, 7),
    transactions: numberIn(rawFreshness.transactions, 1, 365, 14),
    realizedPl: numberIn(rawFreshness.realizedPl, 1, 365, 30),
  }
  const savedTransactionViews = Array.isArray(input?.savedTransactionViews) ? input.savedTransactionViews.filter((row: any) => row && typeof row.name === 'string').slice(0, 100).map((row: any) => ({ name: row.name.slice(0, 80), type: String(row.type ?? 'all').slice(0, 40), symbol: String(row.symbol ?? '').slice(0, 30), from: String(row.from ?? '').slice(0, 10), to: String(row.to ?? '').slice(0, 10), review: String(row.review ?? 'all').slice(0, 30) })) : []
  const historicalBalances = Array.isArray(input?.historicalBalances) ? input.historicalBalances
    .filter((row: any) => row && typeof row.id === 'string' && typeof row.accountMask === 'string' && typeof row.month === 'string' && typeof row.source === 'string' && Number.isFinite(Number(row.closingEquity)))
    .slice(0, 500)
    .map((row: any) => ({
      id: row.id.slice(0, 160), accountMask: row.accountMask.slice(0, 80), month: row.month.slice(0, 10),
      ...(Number.isFinite(Number(row.openingEquity)) ? { openingEquity: Number(row.openingEquity) } : {}),
      deposits: Number.isFinite(Number(row.deposits)) ? Number(row.deposits) : 0,
      withdrawals: Number.isFinite(Number(row.withdrawals)) ? Number(row.withdrawals) : 0,
      dividendsInterest: Number.isFinite(Number(row.dividendsInterest)) ? Number(row.dividendsInterest) : 0,
      marketChange: Number.isFinite(Number(row.marketChange)) ? Number(row.marketChange) : 0,
      expenses: Number.isFinite(Number(row.expenses)) ? Number(row.expenses) : 0,
      closingEquity: Number(row.closingEquity),
      ...(Number.isFinite(Number(row.marginLoanBalance)) ? { marginLoanBalance: Number(row.marginLoanBalance) } : {}),
      source: ['Schwab statement', 'CSV', 'Automatic snapshot'].includes(row.source) ? row.source : 'CSV',
      fileName: typeof row.fileName === 'string' ? row.fileName.slice(0, 240) : 'Imported statement',
      importedAt: typeof row.importedAt === 'string' ? row.importedAt.slice(0, 40) : new Date().toISOString(),
      ...(typeof row.asOf === 'string' ? { asOf: row.asOf.slice(0, 40) } : {}),
      ...(typeof row.monthEnd === 'boolean' ? { monthEnd: row.monthEnd } : {}),
      ...(typeof row.flowsAvailable === 'boolean' ? { flowsAvailable: row.flowsAvailable } : {}),
      ...(typeof row.coverageNote === 'string' ? { coverageNote: row.coverageNote.slice(0, 300) } : {}),
    })) : []
  return {
    statementTransactions: Array.isArray(input?.statementTransactions) ? input.statementTransactions.filter((group: any) => group && typeof group.accountMask === 'string' && /^20\d{2}-\d{2}$/.test(group.month) && typeof group.importedAt === 'string' && group.complete === true && Array.isArray(group.transactions) && group.transactions.every((row: any) => row && typeof row.date === 'string' && Number.isFinite(row.amount) && Number.isFinite(row.units) && typeof row.statement?.key === 'string')) : [],
    transactionOverrides: cleanTransactionOverrides(input?.transactionOverrides),
    bucketOverrides,
    tagRules,
    symbolRules,
    targetAlloc,
    keepList: strings(input?.keepList, 2_000),
    soldSymbols: strings(input?.soldSymbols, 2_000),
    spendingExclusions: strings(input?.spendingExclusions, 2_000),
    realizedPlOverrides,
    csvPositionAuthority,
    csvTransactionAuthority,
    importHistory,
    freshnessThresholds,
    savedTransactionViews,
    historicalBalances,
    incomePlan,
  }
}

export default async (request: Request) => {
  if (request.method === 'GET') {
    const preferences = await store().get(KEY, { type: 'json' }).catch(() => null)
    return json({ ok: true, preferences })
  }
  if (request.method === 'PUT') {
    const length = Number(request.headers.get('content-length') ?? 0)
    if (length > 5_000_000) return json({ ok: false, error: 'payload_too_large' }, 413)
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return json({ ok: false, error: 'invalid_body' }, 400)
    const incoming = clean(body)
    const storage = store()
    // Older tabs and devices may submit stale preferences. Preserve per-row
    // decisions and use conditional writes so simultaneous saves cannot lose edits.
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await storage.getWithMetadata(KEY, { type: 'json' })
      const preferences = { ...incoming, statementTransactions: mergeStatementTransactions(existing?.data.statementTransactions, incoming.statementTransactions), transactionOverrides: mergeTransactionOverrides(
        cleanTransactionOverrides(existing?.data.transactionOverrides), incoming.transactionOverrides,
      ) }
      if (existing && !existing.etag) return json({ ok: false, error: 'missing_etag' }, 503)
      const result = await storage.setJSON(KEY, preferences, existing ? { onlyIfMatch: existing.etag } : { onlyIfNew: true })
      if (result.modified) return json({ ok: true, preferences })
    }
    return json({ ok: false, error: 'write_conflict' }, 409)
  }
  return json({ ok: false, error: 'method_not_allowed' }, 405)
}
