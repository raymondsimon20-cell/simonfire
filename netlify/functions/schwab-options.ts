// Read-only Schwab option-chain quotes for the protective-put planner.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { accessToken, json, MARKET_BASE } from './lib/schwab'

const symbolPattern = /^[A-Z][A-Z0-9./-]{0,14}$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const finite = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export default async (req: Request) => {
  if (req.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405)
  const url = new URL(req.url)
  const symbol = String(url.searchParams.get('symbol') ?? '').trim().toUpperCase()
  const fromDate = String(url.searchParams.get('fromDate') ?? '')
  const toDate = String(url.searchParams.get('toDate') ?? '')
  if (!symbolPattern.test(symbol)) return json({ ok: false, error: 'invalid_symbol' }, 400)
  if ((fromDate && !datePattern.test(fromDate)) || (toDate && !datePattern.test(toDate)))
    return json({ ok: false, error: 'invalid_date' }, 400)

  try {
    const token = await accessToken()
    const params = new URLSearchParams({
      symbol,
      contractType: 'PUT',
      strikeCount: '24',
      includeUnderlyingQuote: 'true',
      strategy: 'SINGLE',
    })
    if (fromDate) params.set('fromDate', fromDate)
    if (toDate) params.set('toDate', toDate)
    const response = await fetch(`${MARKET_BASE}/chains?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!response.ok) {
      const detail = await response.text()
      return json({ ok: false, error: `Schwab quote request failed (${response.status})`, detail: detail.slice(0, 300) }, response.status)
    }
    const chain: any = await response.json()
    const contracts: any[] = []
    for (const [expiryKey, strikes] of Object.entries(chain.putExpDateMap ?? {})) {
      const [expiration, dteText] = expiryKey.split(':')
      for (const [strikeText, rows] of Object.entries(strikes as Record<string, any[]>)) {
        for (const row of rows ?? []) contracts.push({
          symbol: String(row.symbol ?? ''),
          expiration,
          daysToExpiration: finite(row.daysToExpiration) ?? finite(dteText),
          strike: finite(row.strikePrice) ?? finite(strikeText),
          bid: finite(row.bid),
          ask: finite(row.ask),
          mark: finite(row.mark),
          last: finite(row.last),
          delta: finite(row.delta),
          theta: finite(row.theta),
          volatility: finite(row.volatility),
          openInterest: finite(row.openInterest),
          volume: finite(row.totalVolume),
          quoteTime: finite(row.quoteTimeInLong),
          multiplier: finite(row.multiplier),
        })
      }
    }
    contracts.sort((a, b) => (a.expiration ?? '').localeCompare(b.expiration ?? '') || (b.strike ?? 0) - (a.strike ?? 0))
    return json({
      ok: true,
      symbol,
      underlyingPrice: finite(chain.underlyingPrice),
      delayed: Boolean(chain.isDelayed),
      fetchedAt: new Date().toISOString(),
      contracts,
    })
  } catch (error: any) {
    const message = String(error?.message ?? error)
    if (message.includes('NOT_CONNECTED')) return json({ ok: false, error: 'not_connected' }, 401)
    if (message.includes('REFRESH_EXPIRED')) return json({ ok: false, error: 'refresh_expired' }, 401)
    return json({ ok: false, error: message }, 500)
  }
}
