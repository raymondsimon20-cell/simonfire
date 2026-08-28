export interface StrategyPricePoint { date: string; close: number }
export interface StrategyConfig {
  startingCapital: number
  trendWindow: number
  fastWindow: number
  tqqqAllocationPct: number
  sqqqAllocationPct: number
  tradingCostBps: number
}
export interface StrategyDay {
  date: string
  equity: number
  benchmark: number
  regime: 'risk-on' | 'risk-off' | 'cash'
  allocation: number
  traded: boolean
}
export interface StrategyMetrics {
  start: string
  end: string
  days: number
  totalReturn: number
  annualizedReturn: number
  benchmarkReturn: number
  maxDrawdown: number
  annualizedVolatility: number
  sharpe: number
  trades: number
}

const mean = (v: number[]) => v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0
const std = (v: number[]) => {
  if (v.length < 2) return 0
  const m = mean(v)
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1))
}

export function runLeveragedRegimeStrategy(
  qqq: StrategyPricePoint[],
  tqqq: StrategyPricePoint[],
  sqqq: StrategyPricePoint[],
  config: StrategyConfig,
) {
  const byDate = (rows: StrategyPricePoint[]) => new Map(rows.filter((r) => r.close > 0).map((r) => [r.date, r.close]))
  const q = byDate(qqq), t = byDate(tqqq), s = byDate(sqqq)
  const dates = [...q.keys()].filter((d) => t.has(d) && s.has(d)).sort()
  const slow = Math.max(20, Math.round(config.trendWindow))
  const fast = Math.max(5, Math.min(slow - 1, Math.round(config.fastWindow)))
  if (dates.length <= slow + 2) return { days: [] as StrategyDay[], segments: [] as StrategyMetrics[] }
  const closes = dates.map((d) => q.get(d)!)
  let equity = Math.max(1, config.startingCapital)
  let benchmark = equity
  let priorRegime: StrategyDay['regime'] = 'cash'
  let peak = equity
  const rows: Array<StrategyDay & { dailyReturn: number; benchmarkDailyReturn: number; drawdown: number }> = []
  for (let i = slow; i < dates.length; i++) {
    // Yesterday's fully formed signal controls today's allocation, preventing
    // same-close look-ahead bias.
    const signalIndex = i - 1
    const slowAvg = mean(closes.slice(signalIndex - slow + 1, signalIndex + 1))
    const fastAvg = mean(closes.slice(signalIndex - fast + 1, signalIndex + 1))
    const signalClose = closes[signalIndex]
    const regime: StrategyDay['regime'] = signalClose > slowAvg && fastAvg > slowAvg
      ? 'risk-on' : signalClose < slowAvg && fastAvg < slowAvg ? 'risk-off' : 'cash'
    const assetReturn = regime === 'risk-on'
      ? t.get(dates[i])! / t.get(dates[i - 1])! - 1
      : regime === 'risk-off' ? s.get(dates[i])! / s.get(dates[i - 1])! - 1 : 0
    const allocation = (regime === 'risk-on' ? config.tqqqAllocationPct : regime === 'risk-off' ? config.sqqqAllocationPct : 0) / 100
    const priorAllocation = (priorRegime === 'risk-on' ? config.tqqqAllocationPct : priorRegime === 'risk-off' ? config.sqqqAllocationPct : 0) / 100
    const turnover = regime === priorRegime ? 0 : allocation + priorAllocation
    const cost = turnover * Math.max(0, config.tradingCostBps) / 10_000
    const dailyReturn = allocation * assetReturn - cost
    equity *= 1 + dailyReturn
    const benchmarkDailyReturn = q.get(dates[i])! / q.get(dates[i - 1])! - 1
    benchmark *= 1 + benchmarkDailyReturn
    peak = Math.max(peak, equity)
    rows.push({ date: dates[i], equity, benchmark, regime, allocation, traded: regime !== priorRegime, dailyReturn, benchmarkDailyReturn, drawdown: peak ? equity / peak - 1 : 0 })
    priorRegime = regime
  }
  const cut1 = Math.floor(rows.length * .6)
  const cut2 = Math.floor(rows.length * .8)
  const ranges = [[0, cut1], [cut1, cut2], [cut2, rows.length]] as const
  const segments = ranges.map(([start, end]) => metrics(rows.slice(start, end)))
  return { days: rows, segments }
}

function metrics(rows: Array<StrategyDay & { dailyReturn: number; benchmarkDailyReturn: number; drawdown: number }>): StrategyMetrics {
  if (!rows.length) return { start: '', end: '', days: 0, totalReturn: 0, annualizedReturn: 0, benchmarkReturn: 0, maxDrawdown: 0, annualizedVolatility: 0, sharpe: 0, trades: 0 }
  const firstEquity = rows[0].equity / (1 + rows[0].dailyReturn)
  const totalReturn = rows.at(-1)!.equity / firstEquity - 1
  const years = rows.length / 252
  const daily = rows.map((r) => r.dailyReturn)
  const annualizedVolatility = std(daily) * Math.sqrt(252)
  let segmentPeak = rows[0].equity
  let maxDrawdown = 0
  for (const row of rows) { segmentPeak = Math.max(segmentPeak, row.equity); maxDrawdown = Math.min(maxDrawdown, row.equity / segmentPeak - 1) }
  return {
    start: rows[0].date, end: rows.at(-1)!.date, days: rows.length,
    totalReturn,
    annualizedReturn: years > 0 ? (1 + totalReturn) ** (1 / years) - 1 : 0,
    benchmarkReturn: rows.reduce((value, row) => value * (1 + row.benchmarkDailyReturn), 1) - 1,
    maxDrawdown,
    annualizedVolatility,
    sharpe: annualizedVolatility ? mean(daily) * 252 / annualizedVolatility : 0,
    trades: rows.filter((r) => r.traded).length,
  }
}
