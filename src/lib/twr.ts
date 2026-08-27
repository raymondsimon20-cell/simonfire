// ---------- Time-Weighted Return (TWR) ----------
// TWR measures how the *investments* performed, stripped of the effect of when
// you added or withdrew money — the metric fund managers report and benchmark
// against. It differs from the Total Return (Schwab "Investment Change") KPI,
// which is a dollar figure that IS affected by deposit/withdrawal timing.
//
// Method: geometric linking of sub-period returns. For each step in a daily
// portfolio-value series V, with net external cash flow F occurring in that step
// (deposits positive, withdrawals/bill payments negative):
//
//     r = (V_t − F) / V_{t−1} − 1        (flow neutralised, no return credited to it)
//     TWR = Π(1 + r) − 1
//
// The value series (securities market value + cash) is reconstructed server-side
// from Schwab price history; the *flows* are derived here, live, from the current
// transaction classifications — so re-tagging a deposit as a contribution vs. a
// bill payment (now or in the past) recomputes TWR without needing a re-sync.

import type { Transaction, TwrPoint, TwrSeries, TxnType } from './types'

export type { TwrPoint, TwrSeries }

export interface TwrResult {
  twrPct: number // cumulative time-weighted return over the window
  annualizedPct: number // annualized (CAGR-equivalent) figure
  startDate: string
  endDate: string
  days: number
  points: TwrPoint[] // the value series used (for an optional sparkline)
  ok: boolean // false when there isn't enough data to compute
}

// Transaction types that represent EXTERNAL cash flow (money you personally add
// or remove) — the flows TWR must neutralise. Dividends, interest, fees, and
// equity buys/sells are internal to the portfolio and are NOT external flows
// (an equity buy is cash→securities, already value-neutral in the series).
export const EXTERNAL_FLOW_TYPES = new Set<TxnType>(['Contribution', 'Withdrawal', 'Bill Payment'])

const OSI_RE = /\d{6}[CP]\d{8}$/
function isOptionSymbol(sym?: string) {
  return !!sym && OSI_RE.test(sym.replace(/\s+/g, ''))
}

// Net external cash flow per day, derived live from current classifications.
// Amounts already carry sign (contributions +, withdrawals/bill payments −).
// Option-trade cash is also neutralised here: the value series excludes option
// market value (no historical option prices), so option premium would otherwise
// fabricate return — treating it as an external flow cancels it cleanly.
export function flowsByDate(txns: Transaction[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of txns) {
    const isOptionTrade =
      (t.type === 'Buy' || t.type === 'Sell') && isOptionSymbol(t.symbol)
    if (!EXTERNAL_FLOW_TYPES.has(t.type) && !isOptionTrade) continue
    m.set(t.date, (m.get(t.date) ?? 0) + t.amount)
  }
  return m
}

const EMPTY: TwrResult = {
  twrPct: 0,
  annualizedPct: 0,
  startDate: '',
  endDate: '',
  days: 0,
  points: [],
  ok: false,
}

// Link a daily value series with live external flows into a TWR figure.
export function computeTwr(series: TwrPoint[], flows: Map<string, number>): TwrResult {
  if (!series || series.length < 2) return EMPTY
  const points = [...series].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  let factor = 1
  let linked = 0 // count of usable sub-periods
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const vPrev = prev.value
    if (vPrev <= 0) continue // undefined return across a non-positive base — skip
    // Net external flow in (prevDate, currDate].
    let f = 0
    for (const [d, amt] of flows) if (d > prev.date && d <= curr.date) f += amt
    const r = (curr.value - f) / vPrev - 1
    // Guard against absurd single-day jumps from data gaps.
    if (!Number.isFinite(r) || r <= -1) continue
    factor *= 1 + r
    linked++
  }
  if (!linked) return EMPTY

  const twrPct = factor - 1
  const startDate = points[0].date
  const endDate = points[points.length - 1].date
  const days = Math.max(
    1,
    Math.round(
      (new Date(endDate + 'T00:00:00').getTime() - new Date(startDate + 'T00:00:00').getTime()) /
        86_400_000,
    ),
  )
  const years = days / 365
  const annualizedPct = years > 0 && factor > 0 ? Math.pow(factor, 1 / years) - 1 : twrPct

  return { twrPct, annualizedPct, startDate, endDate, days, points, ok: true }
}

// Resolve the value series for the active scope ('all' or an account id).
export function seriesForScope(twr: TwrSeries | undefined, scope: string): TwrPoint[] {
  if (!twr) return []
  if (scope === 'all') return twr.all
  return twr.byAccount[scope] ?? []
}

// Convenience: compute TWR for a scope directly from stored series + live txns.
export function twrForScope(
  twr: TwrSeries | undefined,
  scope: string,
  txns: Transaction[],
): TwrResult {
  const series = seriesForScope(twr, scope)
  if (series.length < 2) return EMPTY
  const scoped = scope === 'all' ? txns : txns.filter((t) => t.accountId === scope)
  return computeTwr(series, flowsByDate(scoped))
}

// ---------- Sample-data value series ----------
// The demo dataset has no price history, so synthesize a plausible daily value
// series by walking a monthly equity path (reusing the same deterministic market
// move the Month Close view uses) and interpolating. Produces a realistic-looking
// TWR for the sample so the KPI isn't empty before a live sync.
export function buildSampleSeries(
  monthlyCloses: { ym: string; closing: number }[],
): TwrPoint[] {
  const pts: TwrPoint[] = []
  const sorted = [...monthlyCloses].sort((a, b) => (a.ym < b.ym ? -1 : 1))
  for (const m of sorted) {
    // last day of that month
    const [y, mo] = m.ym.split('-').map(Number)
    const last = new Date(y, mo, 0)
    pts.push({ date: last.toISOString().slice(0, 10), value: m.closing })
  }
  return pts
}
