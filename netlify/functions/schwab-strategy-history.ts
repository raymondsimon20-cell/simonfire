// Historical daily closes used by the blinded TQQQ/SQQQ strategy lab.
import { accessToken, json, MARKET_BASE } from './lib/schwab'

const SYMBOLS = ['QQQ', 'TQQQ', 'SQQQ'] as const

export default async (req: Request) => {
  if (req.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405)
  try {
    const token = await accessToken()
    const end = Date.now()
    const start = new Date()
    start.setFullYear(start.getFullYear() - 10)
    const series: Record<string, Array<{ date: string; close: number }>> = {}
    for (const symbol of SYMBOLS) {
      const params = new URLSearchParams({
        symbol, periodType: 'year', frequencyType: 'daily', frequency: '1',
        startDate: String(start.getTime()), endDate: String(end),
        needExtendedHoursData: 'false', needPreviousClose: 'false',
      })
      const response = await fetch(`${MARKET_BASE}/pricehistory?${params}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      if (!response.ok) return json({ ok: false, error: `Schwab history request failed for ${symbol} (${response.status})` }, response.status)
      const payload: any = await response.json()
      series[symbol] = (payload.candles ?? [])
        .filter((c: any) => Number(c.close) > 0 && Number.isFinite(Number(c.datetime)))
        .map((c: any) => ({ date: new Date(Number(c.datetime)).toISOString().slice(0, 10), close: Number(c.close) }))
    }
    return json({ ok: true, fetchedAt: new Date().toISOString(), series })
  } catch (error: any) {
    const message = String(error?.message ?? error)
    if (message.includes('NOT_CONNECTED')) return json({ ok: false, error: 'not_connected' }, 401)
    if (message.includes('REFRESH_EXPIRED')) return json({ ok: false, error: 'refresh_expired' }, 401)
    return json({ ok: false, error: message }, 500)
  }
}
