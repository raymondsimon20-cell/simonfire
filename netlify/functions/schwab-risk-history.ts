import { accessToken, fetchDailyCloses, json } from './lib/schwab'
import { priceRisk } from '../../src/lib/portfolio-protection'
export default async (request: Request) => {
  if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405)
  const symbols = [...new Set((new URL(request.url).searchParams.get('symbols') ?? '').split(',').map((s) => s.trim().toUpperCase()))]
  if (!symbols.length || symbols.length > 80 || symbols.some((s) => !/^[A-Z][A-Z0-9./-]{0,14}$/.test(s))) return json({ ok: false, error: 'invalid_symbols' }, 400)
  try {
    const token = await accessToken(), end = Date.now(), start = end - 370 * 86400000
    const benchmark = await fetchDailyCloses('QQQ', token, start, end)
    const bySymbol: Record<string, ReturnType<typeof priceRisk>> = {}
    // Bound concurrent requests to avoid a burst against broker market-data limits.
    for (let i = 0; i < symbols.length; i += 4) await Promise.all(symbols.slice(i, i + 4).map(async (symbol) => {
      const closes = symbol === 'QQQ' ? benchmark : await fetchDailyCloses(symbol, token, start, end)
      bySymbol[symbol] = priceRisk(Object.fromEntries(closes), Object.fromEntries(benchmark))
    }))
    return json({ ok: true, bySymbol, fetchedAt: new Date().toISOString(), method: 'Aligned daily price returns; distributions excluded; observed beta already includes leverage' })
  } catch { return json({ ok: false, error: 'risk_history_unavailable' }, 503) }
}
