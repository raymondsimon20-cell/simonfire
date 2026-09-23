import type { Transaction } from '../../../src/lib/types'
import { hasDividendIdentity } from '../../../src/lib/dividend-symbol'
import { createHash } from 'node:crypto'

const MARKET = 'https://api.schwabapi.com/marketdata/v1'
const TRADER = 'https://api.schwabapi.com/trader/v1'
const cusip = (value: unknown) => typeof value === 'string' ? value.trim().toUpperCase() : ''
const validCusip = (value: unknown) => /^[A-Z0-9*@#]{8}[0-9]$/.test(cusip(value))
const nameKey = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
const validSymbol = (value: unknown): value is string => typeof value === 'string' && /^[A-Z][A-Z0-9./^-]{0,15}$/.test(value) && !value.startsWith('CURRENCY') && value !== 'UNKNOWN'

// Strip payment labels only at the edges. Keep fund names, share classes and
// numbers intact: "Nasdaq 100" and "Nasdaq 200" are different securities.
function payerName(row: Transaction) {
  if (typeof row.securityName === 'string' && row.securityName.trim()) return row.securityName.trim()
  return row.description.trim()
    .replace(/^(?:(?:QUALIFIED |NONQUALIFIED |CASH |ORDINARY |SPECIAL )?DIVIDENDS?|DISTRIBUTIONS?|SUBSTITUTE INCOME PAYMENT|PAYMENT IN LIEU)(?:\s+(?:PAYMENT|PAID|OF|FOR))*\b[\s:;-]*/i, '')
    .replace(/[\s:;-]+(?:(?:CASH |QUALIFIED |ORDINARY )?DIVIDENDS?|DISTRIBUTIONS?|SUBSTITUTE INCOME PAYMENT)(?:\s+(?:PAYMENT|PAID))?$/i, '')
    .trim()
}

interface Instrument { symbol?: unknown; cusip?: string; description?: string; assetType?: string }
function instruments(body: unknown): Instrument[] | undefined {
  const rows = Array.isArray(body) ? body : body && typeof body === 'object' ? (body as { instruments?: unknown }).instruments : undefined
  if (!Array.isArray(rows)) return undefined
  return rows.filter((row): row is Instrument => !!row && typeof row === 'object')
}
function uniqueInstrument(rows: Instrument[], matches: (row: Instrument) => boolean) {
  const matched = rows.filter((row) => matches(row) && validSymbol(row.symbol) && !['OPTION', 'CURRENCY', 'FUTURE', 'FOREX'].includes(row.assetType ?? ''))
  return new Set(matched.map((row) => row.symbol)).size === 1 ? matched[0] : undefined
}

export interface DividendLookupSummary { resolved: number; failed: number; limited: number }
type SecurityDetail = Pick<Transaction, 'brokerTransactionId' | 'type' | 'units' | 'symbol' | 'securityId' | 'securityName'>
type LookupResult = { instruments?: Instrument[]; detail?: SecurityDetail; failed?: boolean; limited?: boolean }
export type DividendLookupCache = Record<string, { expiresAt: number; result: LookupResult }>
interface Options {
  token: string
  transactions: Transaction[]
  accountHashes: Map<string, string>
  mapTransaction: (accountId: string, raw: unknown) => Transaction
  request?: typeof fetch
  maxRequests?: number
  timeoutMs?: number
  lookupCache?: DividendLookupCache
}

// All requests stay on Schwab, share a deadline, and are deduplicated across
// accounts. Enrichment failures never discard the successfully fetched ledger.
export async function resolveDividendSymbolsFromApi(options: Options): Promise<Map<string, DividendLookupSummary>> {
  const { token, transactions, accountHashes, mapTransaction, request = fetch, maxRequests = 80, timeoutMs = 8_000, lookupCache = {} } = options
  const missing = transactions.filter((row) => row.type === 'Dividend' && !row.symbol)
  const summaries = new Map<string, DividendLookupSummary>()
  if (!missing.length) return summaries
  const signal = AbortSignal.timeout(timeoutMs)
  const failed = new Set<Transaction>(), limited = new Set<Transaction>()
  const cache = new Map<string, Promise<LookupResult>>()
  const blocked = new Set<string>()
  let requests = 0
  async function get(url: string, row: Transaction): Promise<LookupResult | undefined> {
    const key = createHash('sha256').update(url).digest('hex')
    const cached = lookupCache[key]
    if (cached?.expiresAt > Date.now()) return cached.result
    let pending = cache.get(url)
    if (!pending) {
      const service = url.startsWith(MARKET) ? MARKET : TRADER
      if (blocked.has(service)) { failed.add(row); return undefined }
      if (signal.aborted || requests >= maxRequests) { limited.add(row); return undefined }
      requests++
      pending = (async (): Promise<LookupResult> => {
        try {
          const response = await request(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal })
          if (response.status === 404) {
            const result = { instruments: [] }
            lookupCache[key] = { expiresAt: Date.now() + 7 * 86_400_000, result }
            return result
          }
          if (!response.ok) {
            if ([401, 403, 429].includes(response.status)) blocked.add(service)
            return { failed: true }
          }
          const body: unknown = await response.json()
          let result: LookupResult
          if (service === MARKET) {
            const rows = instruments(body)
            if (!rows) return { failed: true }
            result = { instruments: rows.map(({ symbol, cusip, description, assetType }) => ({ symbol, cusip, description, assetType })) }
          } else {
            if (!body || typeof body !== 'object' || Array.isArray(body)) return { failed: true }
            const detail = mapTransaction(row.accountId, body)
            if (!detail.brokerTransactionId) return { failed: true }
            const { brokerTransactionId, type, units, symbol, securityId, securityName } = detail
            result = { detail: { brokerTransactionId, type, units, symbol, securityId, securityName } }
          }
          // Cache completed empty results too, so subsequent syncs reach the
          // unattempted tail of a large history. Never cache failures or tokens.
          lookupCache[key] = { expiresAt: Date.now() + 7 * 86_400_000, result }
          return result
        } catch { return signal.aborted ? { limited: true } : { failed: true } }
      })()
      cache.set(url, pending)
    }
    const result = await pending
    if (result.failed) failed.add(row)
    if (result.limited) limited.add(row)
    return result
  }
  async function each(work: (row: Transaction) => Promise<void>) {
    let index = 0
    await Promise.all(Array.from({ length: Math.min(3, missing.length) }, async () => {
      while (index < missing.length) {
        const row = missing[index++]
        if (!row.symbol) await work(row)
      }
    }))
  }
  function assign(row: Transaction, instrument: Instrument, exactId: boolean) {
    if (row.symbol || !validSymbol(instrument.symbol)) return
    row.symbol = instrument.symbol
    row.symbolSource = exactId ? 'broker' : 'inferred'
    if (!row.securityId && validCusip(instrument.cusip)) row.securityId = cusip(instrument.cusip)
    if (!row.securityName && typeof instrument.description === 'string') row.securityName = instrument.description
  }
  async function lookup(row: Transaction) {
    const id = cusip(row.securityId)
    const name = payerName(row)
    // A supplied CUSIP must match exactly; never fall back to a different
    // security with a similar name (e.g. after a merger or share-class change).
    if (!validCusip(id) && (!hasDividendIdentity(name) || name.length < 6 || name.length > 160)) return
    const url = validCusip(id) ? `${MARKET}/instruments/${encodeURIComponent(id)}`
      : `${MARKET}/instruments?${new URLSearchParams({ symbol: name, projection: 'desc-search' })}`
    const result = await get(url, row)
    const rows = result?.instruments
    if (!rows) return
    const match = uniqueInstrument(rows, validCusip(id)
      ? (candidate) => typeof candidate.cusip === 'string' && cusip(candidate.cusip) === id
      : (candidate) => typeof candidate.description === 'string' && nameKey(candidate.description) === nameKey(name))
    if (match) assign(row, match, validCusip(id))
  }
  await each(lookup)
  // List responses can contain only the cash leg. Ask for the individual
  // activity before concluding that Schwab has no security identity to return.
  await each(async (row) => {
    const hash = accountHashes.get(row.accountId)
    if (!hash || !row.brokerTransactionId) return
    const result = await get(`${TRADER}/accounts/${encodeURIComponent(hash)}/transactions/${encodeURIComponent(row.brokerTransactionId)}`, row)
    const detail = result?.detail
    if (!detail) return
    if (detail.brokerTransactionId !== row.brokerTransactionId || detail.type !== 'Dividend' || detail.units !== 0) return
    if (row.securityId && detail.securityId && cusip(row.securityId) !== cusip(detail.securityId)) return
    if (detail.securityId) row.securityId = detail.securityId
    if (detail.securityName) row.securityName = detail.securityName
    if (validSymbol(detail.symbol)) assign(row, { symbol: detail.symbol }, true)
  })
  await each(lookup)
  for (const row of missing) {
    const summary = summaries.get(row.accountId) ?? { resolved: 0, failed: 0, limited: 0 }
    if (row.symbol) summary.resolved++
    else if (limited.has(row)) summary.limited++
    else if (failed.has(row)) summary.failed++
    row.dividendLookupState = row.symbol ? 'resolved' : limited.has(row) ? 'deferred' : failed.has(row) ? 'unavailable' : 'unmatched'
    summaries.set(row.accountId, summary)
  }
  return summaries
}
