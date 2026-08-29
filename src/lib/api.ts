// Client for the Schwab Netlify Functions. These only exist when deployed to
// Netlify (or running `netlify dev`); in a plain Vite/demo build the calls fail
// gracefully and the UI falls back to CSV import.
import type { ImportPayload } from './store'

const FN = '/.netlify/functions'

export const schwabLoginUrl = `${FN}/schwab-login`

export interface SchwabStatus {
  connected: boolean
  needsReconnect?: boolean
}

export async function schwabStatus(): Promise<SchwabStatus> {
  try {
    const r = await fetch(`${FN}/schwab-status`)
    if (!r.ok) return { connected: false }
    return (await r.json()) as SchwabStatus
  } catch {
    return { connected: false }
  }
}

export interface SyncResult {
  ok: boolean
  error?: string
  payload?: ImportPayload
}

export async function schwabSync(): Promise<SyncResult> {
  try {
    const r = await fetch(`${FN}/schwab-sync`)
    const d = await r.json().catch(() => ({ ok: false, error: 'bad_response' }))
    if (!d.ok) return { ok: false, error: d.error || `HTTP ${r.status}` }
    return {
      ok: true,
      payload: {
        accounts: d.accounts,
        positions: d.positions,
        transactions: d.transactions,
        broker: d.broker || 'Schwab',
        twr: d.twr,
        insights: d.insights,
      },
    }
  } catch {
    return { ok: false, error: 'unreachable' }
  }
}

export async function schwabDisconnect(): Promise<void> {
  try {
    await fetch(`${FN}/schwab-disconnect`, { method: 'POST' })
  } catch {
    /* ignore */
  }
}

export interface EquityOrder {
  session: 'NORMAL'
  duration: 'DAY'
  orderType: 'MARKET' | 'LIMIT'
  price?: string
  orderStrategyType: 'SINGLE'
  orderLegCollection: [{
    instruction: 'BUY'
    quantity: number
    instrument: { symbol: string; assetType: 'EQUITY' }
  }]
}

export interface OptionOrder {
  session: 'NORMAL'
  duration: 'DAY'
  orderType: 'LIMIT'
  price: string
  orderStrategyType: 'SINGLE'
  orderLegCollection: [{
    instruction: 'BUY_TO_OPEN'
    quantity: number
    instrument: { symbol: string; assetType: 'OPTION' }
  }]
}

export interface SchwabOrderResult {
  ok: boolean
  error?: unknown
  preview?: unknown
  orderId?: string
  status?: string
}

async function orderRequest(body: Record<string, unknown>): Promise<SchwabOrderResult> {
  try {
    const r = await fetch(`${FN}/schwab-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SimonFIRE-Order-Request': '1' },
      body: JSON.stringify(body),
    })
    const data = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))
    return data as SchwabOrderResult
  } catch {
    return { ok: false, error: 'unreachable' }
  }
}

export const schwabPreviewOrder = (accountId: string, requestId: string, order: EquityOrder | OptionOrder) =>
  orderRequest({ action: 'preview', accountId, requestId, order })

export const schwabPreviewOption = (accountId: string, requestId: string, order: OptionOrder) =>
  orderRequest({ action: 'preview', accountId, requestId, order })

export const schwabPlaceOrder = (accountId: string, requestId: string, order: EquityOrder) =>
  orderRequest({ action: 'place', accountId, requestId, order, confirm: true })

export const schwabOrderStatus = (accountId: string, orderId: string) =>
  orderRequest({ action: 'status', accountId, orderId })

export interface PutQuote {
  symbol: string
  expiration: string
  daysToExpiration: number | null
  strike: number
  bid: number | null
  ask: number | null
  mark: number | null
  last: number | null
  delta: number | null
  theta: number | null
  volatility: number | null
  openInterest: number | null
  volume: number | null
  quoteTime: number | null
  multiplier: number | null
}

export interface PutChainResult {
  ok: boolean
  error?: string
  symbol?: string
  underlyingPrice?: number | null
  delayed?: boolean
  fetchedAt?: string
  contracts?: PutQuote[]
}

export async function schwabPutChain(symbol: string, fromDate?: string, toDate?: string): Promise<PutChainResult> {
  try {
    const params = new URLSearchParams({ symbol })
    if (fromDate) params.set('fromDate', fromDate)
    if (toDate) params.set('toDate', toDate)
    const response = await fetch(`${FN}/schwab-options?${params}`)
    return await response.json() as PutChainResult
  } catch {
    return { ok: false, error: 'unreachable' }
  }
}
