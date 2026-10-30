// Synthetic market data only; never read OAuth tokens or call the broker.
import { strict as assert } from 'node:assert'
import * as schwab from '../netlify/functions/lib/schwab'
import riskHistory from '../netlify/functions/schwab-risk-history'
import { priceRisk } from '../src/lib/portfolio-protection'

async function main() {
  const originalFetch = globalThis.fetch
  const originalAccessToken = schwab.accessToken
  const start = Date.UTC(2025, 0, 1)
  const end = start + 254 * 86400000
  // Alternating returns give nonzero variance and a hand-checkable beta of 0.5.
  let benchmark = 100, stock = 200
  type Candle = { datetime: number; open: number; high: number; low: number; close: number; volume: number }
  const qqqCandles: Candle[] = [], brkCandles: Candle[] = []
  for (let i = 0; i < 255; i++) {
    if (i) {
      const change = i % 2 ? 0.02 : -0.01
      benchmark *= 1 + change
      stock *= 1 + change / 2
    }
    const datetime = start + i * 86400000
    qqqCandles.push({ datetime, open: benchmark, high: benchmark, low: benchmark, close: benchmark, volume: 1000 })
    brkCandles.push({ datetime, open: stock, high: stock, low: stock, close: stock, volume: 1000 })
  }
  const requested: string[] = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    assert.equal(url.origin + url.pathname, `${schwab.MARKET_BASE}/pricehistory`)
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-history-token')
    const symbol = url.searchParams.get('symbol')!
    requested.push(symbol)
    const candles = symbol === 'QQQ' ? qqqCandles : ['BRK/A', 'BRK/B'].includes(symbol) ? brkCandles : []
    return Response.json({ symbol, empty: candles.length === 0, candles })
  }
  try {
    const benchmarkCloses = await schwab.fetchDailyCloses('QQQ', 'synthetic-history-token', start, end)
    assert.equal(requested.at(-1), 'QQQ')
    assert.equal(benchmarkCloses.size, 255)
    assert.equal(benchmarkCloses.get('2025-01-01'), 100)
    for (const [input, expected] of [
      ['BRK.B', 'BRK/B'], ['BRK-B', 'BRK/B'], ['BRK.A', 'BRK/A'], ['BRK-A', 'BRK/A'],
      ['BRK/B', 'BRK/B'], ['BRK/A', 'BRK/A'],
    ]) {
      const closes = await schwab.fetchDailyCloses(input, 'synthetic-history-token', start, end)
      assert.equal(requested.at(-1), expected, `${input} must request Schwab's share-class symbol`)
      assert.equal(closes.size, 255)
      assert.equal(closes.get('2025-01-01'), 200)
      const risk = priceRisk(Object.fromEntries(closes), Object.fromEntries(benchmarkCloses))
      assert.ok(risk, `${input} must have risk evidence from returned candles`)
      assert.equal(risk.observations, 254)
      assert.ok(Math.abs(risk.beta - 0.5) < 1e-10)
      assert.ok(Math.abs(risk.correlation - 1) < 1e-10)
    }
    for (const input of ['BRK.C', 'OTHER.B', 'OTHER-B', 'BRKB']) {
      const closes = await schwab.fetchDailyCloses(input, 'synthetic-history-token', start, end)
      assert.equal(requested.at(-1), input, 'mapping must stay limited to Berkshire A/B')
      assert.equal(priceRisk(Object.fromEntries(closes), Object.fromEntries(benchmarkCloses)), null)
    }
    // This suite compiles to CommonJS, allowing only the external token dependency
    // to be replaced while the endpoint, fetchDailyCloses and risk math stay real.
    const exports = schwab as { accessToken: typeof schwab.accessToken }
    exports.accessToken = async () => 'synthetic-history-token'
    requested.length = 0
    const response = await riskHistory(new Request('https://synthetic.test/.netlify/functions/schwab-risk-history?symbols=BRK.B%2CQQQ'))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.deepEqual(Object.keys(body.bySymbol).sort(), ['BRK.B', 'QQQ'])
    assert.equal(body.bySymbol['BRK.B'].observations, 254)
    assert.ok(Math.abs(body.bySymbol['BRK.B'].beta - 0.5) < 1e-10)
    assert.equal(body.bySymbol.QQQ.beta, 1)
    assert.deepEqual(requested, ['QQQ', 'BRK/B'])
    console.log('Schwab history: Berkshire request aliases, candle-derived risk, original endpoint keys and unchanged QQQ passed')
  } finally {
    globalThis.fetch = originalFetch
    ;(schwab as { accessToken: typeof schwab.accessToken }).accessToken = originalAccessToken
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
