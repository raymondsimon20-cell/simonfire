import assert from 'node:assert/strict'
import { runLeveragedRegimeStrategy } from '../src/lib/strategy'

const start = new Date('2020-01-01T00:00:00Z')
const series = (daily: number) => Array.from({ length: 520 }, (_, i) => ({
  date: new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10),
  close: 100 * (1 + daily) ** i,
}))
const result = runLeveragedRegimeStrategy(series(.001), series(.003), series(-.003), {
  startingCapital: 100000, trendWindow: 200, fastWindow: 50,
  tqqqAllocationPct: 50, sqqqAllocationPct: 20, tradingCostBps: 10,
})
assert.equal(result.days.length, 320)
assert.equal(result.segments.length, 3)
assert.ok(result.days.every((d) => d.regime === 'risk-on'))
assert.ok(result.days.at(-1)!.equity > 100000)
assert.equal(result.segments.reduce((n, s) => n + s.days, 0), 320)
assert.ok(result.segments[0].trades >= 1)
console.log('strategy tests passed')
