// Read-only Schwab option-chain quotes for the protective-put planner.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { accessToken, json, MARKET_BASE } from './lib/schwab'

const symbolPattern = /^[A-Z][A-Z0-9./-]{0,14}$/
const optionSymbolPattern = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const finite = (value: unknown): number | null => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// Contract size must come from broker metadata, including adjusted contracts.
const multiplier = (value: unknown): number | null => {
  const n = finite(value)
  return n != null && n > 0 ? n : null
}

export default async (req: Request) => {
  if (req.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405)
  const url = new URL(req.url)
  const symbol = String(url.searchParams.get('symbol') ?? '').trim().toUpperCase()
  const fromDate = String(url.searchParams.get('fromDate') ?? '')
  const toDate = String(url.searchParams.get('toDate') ?? '')
  const includeSymbol = String(url.searchParams.get('includeSymbol') ?? '').replace(/\s+/g, '').toUpperCase()
  const requestedStrikeCount = Number(url.searchParams.get('strikeCount') ?? 24)
  const strikeCount = Number.isSafeInteger(requestedStrikeCount) ? Math.max(1, Math.min(100, requestedStrikeCount)) : 24
  if (!symbolPattern.test(symbol)) return json({ ok: false, error: 'invalid_symbol' }, 400)
  if (includeSymbol && !optionSymbolPattern.test(includeSymbol)) return json({ ok: false, error: 'invalid_option_symbol' }, 400)
  if ((fromDate && !datePattern.test(fromDate)) || (toDate && !datePattern.test(toDate)))
    return json({ ok: false, error: 'invalid_date' }, 400)

  try {
    const token = await accessToken()
    const params = new URLSearchParams({
      symbol,
      contractType: 'PUT',
      strikeCount: String(strikeCount),
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
          gamma: finite(row.gamma),
          vega: finite(row.vega),
          volatility: finite(row.volatility),
          openInterest: finite(row.openInterest),
          volume: finite(row.totalVolume),
          quoteTime: finite(row.quoteTimeInLong),
          multiplier: multiplier(row.multiplier),
        })
      }
    }
    // strikeCount intentionally keeps the replacement chain compact, but a held
    // contract may sit outside those strikes. Fetch that exact OSI symbol so a
    // valid live position can always supply its close bid during a roll.
    if (includeSymbol && !contracts.some((contract) => String(contract.symbol).replace(/\s+/g, '').toUpperCase() === includeSymbol)) {
      const quoteParams = new URLSearchParams({ symbols: includeSymbol, fields: 'quote,reference' })
      const quoteResponse = await fetch(`${MARKET_BASE}/quotes?${quoteParams}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      if (quoteResponse.ok) {
        const quoteBody: any = await quoteResponse.json()
        const item = Object.entries(quoteBody).find(([key]) => key.replace(/\s+/g, '').toUpperCase() === includeSymbol)?.[1] as any
        if (!item || String(item.symbol ?? includeSymbol).replace(/\s+/g, '').toUpperCase() !== includeSymbol) throw new Error('Requested option quote missing or mismatched')
        const quote = item?.quote ?? {}
        const tail = includeSymbol.slice(-15)
        const expiration = `20${tail.slice(0, 2)}-${tail.slice(2, 4)}-${tail.slice(4, 6)}`
        const expirationMs = new Date(`${expiration}T00:00:00Z`).getTime()
        contracts.push({
          symbol: String(item?.symbol ?? includeSymbol),
          expiration,
          daysToExpiration: Math.max(0, Math.ceil((expirationMs - Date.now()) / 86_400_000)),
          strike: Number.parseInt(tail.slice(7), 10) / 1_000,
          bid: finite(quote.bidPrice),
          ask: finite(quote.askPrice),
          mark: finite(quote.mark),
          last: finite(quote.lastPrice),
          delta: finite(quote.delta),
          theta: finite(quote.theta),
          gamma: finite(quote.gamma),
          vega: finite(quote.vega),
          volatility: finite(quote.volatility),
          openInterest: finite(quote.openInterest),
          volume: finite(quote.totalVolume),
          quoteTime: finite(quote.quoteTime),
          multiplier: multiplier(item?.reference?.multiplier),
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
