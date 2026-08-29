// Preview and place one reviewed equity order. Live placement is disabled unless
// SCHWAB_ORDER_PLACEMENT_ENABLED=true is set in the Netlify environment.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { accessToken, accountHash, API_BASE, env, json } from './lib/schwab'

type OrderRequest = {
  action?: 'preview' | 'place' | 'status'
  accountId?: string
  requestId?: string
  orderId?: string
  order?: unknown
  confirm?: boolean
}

const requestIdPattern = /^[a-f0-9-]{20,64}$/i
const symbolPattern = /^[A-Z0-9][A-Z0-9./-]{0,14}$/
const optionSymbolPattern = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin')
  const allowed = env().appUrl || new URL(req.url).origin
  return !!origin && origin === allowed.replace(/\/$/, '') && req.headers.get('x-simonfire-order-request') === '1'
}

function validateOrder(value: any) {
  if (!value || typeof value !== 'object') throw new Error('INVALID_ORDER')
  if (value.session !== 'NORMAL' || value.duration !== 'DAY' || value.orderStrategyType !== 'SINGLE')
    throw new Error('UNSUPPORTED_ORDER')
  if (value.orderType !== 'MARKET' && value.orderType !== 'LIMIT') throw new Error('UNSUPPORTED_ORDER')
  if (!Array.isArray(value.orderLegCollection) || value.orderLegCollection.length !== 1)
    throw new Error('INVALID_ORDER')

  const leg = value.orderLegCollection[0]
  const symbol = String(leg?.instrument?.symbol ?? '').trim().toUpperCase()
  const quantity = Number(leg?.quantity)
  const assetType = String(leg?.instrument?.assetType ?? '').toUpperCase()
  const optionKey = symbol.replace(/\s+/g, '')
  const isEquity = assetType === 'EQUITY' && leg?.instruction === 'BUY' && symbolPattern.test(symbol)
  const isOption = assetType === 'OPTION' && leg?.instruction === 'BUY_TO_OPEN' && optionSymbolPattern.test(optionKey)
  if (!isEquity && !isOption) throw new Error('INVALID_ORDER_LEG')
  if (isOption && value.orderType !== 'LIMIT') throw new Error('OPTION_LIMIT_ORDERS_ONLY')
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > (isOption ? 100 : 10_000))
    throw new Error('INVALID_QUANTITY')

  const normalized: any = {
    session: 'NORMAL',
    duration: 'DAY',
    orderType: value.orderType,
    orderStrategyType: 'SINGLE',
    orderLegCollection: [{
      instruction: isOption ? 'BUY_TO_OPEN' : 'BUY',
      quantity,
      instrument: { symbol, assetType },
    }],
  }
  if (value.orderType === 'LIMIT') {
    const price = Number(value.price)
    if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) throw new Error('INVALID_PRICE')
    normalized.price = price.toFixed(2)
  }
  return normalized
}

function fingerprint(accountId: string, order: unknown) {
  return createHash('sha256').update(JSON.stringify({ accountId, order })).digest('hex')
}

async function schwabError(res: Response) {
  const text = await res.text()
  try {
    const parsed = JSON.parse(text)
    return parsed?.message || parsed?.error || parsed?.errors || parsed
  } catch {
    return text || `Schwab returned HTTP ${res.status}`
  }
}

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  if (!sameOrigin(req)) return json({ ok: false, error: 'forbidden' }, 403)

  try {
    const body = (await req.json()) as OrderRequest
    const action = body.action
    if (!body.accountId) return json({ ok: false, error: 'account_required' }, 400)

    const token = await accessToken()
    const hash = await accountHash(body.accountId, token)

    if (action === 'status') {
      if (!/^\d+$/.test(String(body.orderId ?? ''))) return json({ ok: false, error: 'invalid_order_id' }, 400)
      const res = await fetch(`${API_BASE}/accounts/${encodeURIComponent(hash)}/orders/${body.orderId}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      if (!res.ok) return json({ ok: false, error: await schwabError(res) }, res.status)
      const order: any = await res.json()
      return json({ ok: true, orderId: String(body.orderId), status: order.status ?? 'UNKNOWN' })
    }

    if (action !== 'preview' && action !== 'place') return json({ ok: false, error: 'invalid_action' }, 400)
    if (!requestIdPattern.test(String(body.requestId ?? ''))) return json({ ok: false, error: 'invalid_request_id' }, 400)
    const order = validateOrder(body.order)
    const isOptionOrder = order.orderLegCollection[0]?.instrument?.assetType === 'OPTION'
    const digest = fingerprint(body.accountId, order)
    const orderStore = getStore('schwab-orders')

    if (action === 'preview') {
      const res = await fetch(`${API_BASE}/accounts/${encodeURIComponent(hash)}/previewOrder`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      })
      if (!res.ok) return json({ ok: false, error: await schwabError(res) }, res.status)
      const text = await res.text()
      const preview = text ? (() => { try { return JSON.parse(text) } catch { return { message: text } } })() : {}
      await orderStore.setJSON(`previews/${body.requestId}`, { digest, previewedAt: Date.now() })
      return json({ ok: true, preview })
    }

    if (isOptionOrder) return json({ ok: false, error: 'option_placement_disabled_preview_only' }, 503)
    if (process.env.SCHWAB_ORDER_PLACEMENT_ENABLED !== 'true')
      return json({ ok: false, error: 'placement_disabled' }, 503)
    if (body.confirm !== true) return json({ ok: false, error: 'confirmation_required' }, 400)

    const preview: any = await orderStore.get(`previews/${body.requestId}`, { type: 'json' })
    if (!preview || preview.digest !== digest || Date.now() - Number(preview.previewedAt) > 10 * 60_000)
      return json({ ok: false, error: 'preview_required' }, 409)

    const claim = await orderStore.setJSON(
      `placements/${body.requestId}`,
      { digest, state: 'submitting', createdAt: Date.now() },
      { onlyIfNew: true },
    )
    if (!claim.modified) return json({ ok: false, error: 'duplicate_request' }, 409)

    const res = await fetch(`${API_BASE}/accounts/${encodeURIComponent(hash)}/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    })
    if (!res.ok) {
      const error = await schwabError(res)
      await orderStore.setJSON(`placements/${body.requestId}`, { digest, state: 'rejected', error, createdAt: Date.now() })
      return json({ ok: false, error }, res.status)
    }

    const location = res.headers.get('location') ?? ''
    const orderId = location.split('/').filter(Boolean).pop()
    if (!orderId) {
      await orderStore.setJSON(`placements/${body.requestId}`, { digest, state: 'accepted_unknown_id', createdAt: Date.now() })
      return json({ ok: false, error: 'accepted_but_order_id_missing' }, 502)
    }
    await orderStore.setJSON(`placements/${body.requestId}`, { digest, state: 'accepted', orderId, createdAt: Date.now() })
    return json({ ok: true, orderId, status: 'ACCEPTED' }, 201)
  } catch (e: any) {
    const message = String(e?.message ?? e)
    const known = ['INVALID_ACCOUNT', 'ACCOUNT_NOT_FOUND', 'AMBIGUOUS_ACCOUNT', 'INVALID_ORDER', 'UNSUPPORTED_ORDER', 'BUY_ORDERS_ONLY', 'INVALID_SYMBOL', 'INVALID_QUANTITY', 'INVALID_PRICE']
    if (known.includes(message)) return json({ ok: false, error: message.toLowerCase() }, 400)
    if (message.includes('NOT_CONNECTED')) return json({ ok: false, error: 'not_connected' }, 401)
    if (message.includes('REFRESH_EXPIRED')) return json({ ok: false, error: 'refresh_expired' }, 401)
    return json({ ok: false, error: 'order_request_failed' }, 500)
  }
}
