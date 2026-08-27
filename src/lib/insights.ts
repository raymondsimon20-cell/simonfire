// ---------- Moving-average rebalance insights (50 / 100 / 200 SMA) ----------
// Turns the raw SMA snapshot (computed server-side from price history) into a
// trend read and a suggested action for each holding. Classic technical setup:
//   - Price above all three SMAs, with 50 > 100 > 200 (bullish alignment) = strong uptrend.
//   - Price below all three, with 50 < 100 < 200 (bearish alignment) = downtrend.
//   - The 200-day is the long-term line in the sand: below it = caution/weak.

import type { Position, SmaSnapshot } from './types'
import { normTicker } from './plan'

export type Signal = 'strong' | 'healthy' | 'neutral' | 'caution' | 'weak'
export type Action = 'Add' | 'Hold' | 'Watch' | 'Trim'

export interface HoldingInsight {
  symbol: string
  name: string
  accountId: string
  shares: number
  price: number
  value: number
  sma50: number | null
  sma100: number | null
  sma200: number | null
  vs50: number | null // price / sma − 1
  vs100: number | null
  vs200: number | null
  trend: 'up' | 'down' | 'mixed' | 'n/a' // SMA alignment
  aboveCount: number // how many SMAs price sits above (0–3, of available)
  available: number // how many SMAs are available (history permitting)
  signal: Signal
  action: Action
  score: number // -100..100, higher = stronger
  note: string
}

const rel = (price: number, sma: number | null): number | null =>
  sma && sma > 0 ? price / sma - 1 : null

export function holdingInsight(
  p: Position,
  snap: SmaSnapshot | undefined,
): HoldingInsight | null {
  if (!snap) return null
  const price = snap.price || p.lastPrice
  const value = p.shares * p.lastPrice
  const vs50 = rel(price, snap.sma50)
  const vs100 = rel(price, snap.sma100)
  const vs200 = rel(price, snap.sma200)

  const available = [vs50, vs100, vs200].filter((v) => v != null).length
  const aboveCount = [vs50, vs100, vs200].filter((v) => v != null && (v as number) >= 0).length

  // Alignment: strictly stacked SMAs signal a clean trend.
  let trend: HoldingInsight['trend'] = 'n/a'
  if (snap.sma50 != null && snap.sma100 != null && snap.sma200 != null) {
    if (snap.sma50 >= snap.sma100 && snap.sma100 >= snap.sma200) trend = 'up'
    else if (snap.sma50 <= snap.sma100 && snap.sma100 <= snap.sma200) trend = 'down'
    else trend = 'mixed'
  } else if (snap.sma50 != null && snap.sma100 != null) {
    trend = snap.sma50 >= snap.sma100 ? 'up' : snap.sma50 <= snap.sma100 ? 'down' : 'mixed'
  }

  // Score: position relative to each available SMA (weighted toward the 200-day),
  // plus an alignment bonus/penalty. Normalized to roughly -100..100.
  let raw = 0
  let wsum = 0
  const add = (v: number | null, w: number) => {
    if (v == null) return
    raw += (v >= 0 ? 1 : -1) * w
    wsum += w
  }
  add(vs50, 1)
  add(vs100, 1.5)
  add(vs200, 2)
  let score = wsum ? (raw / wsum) * 80 : 0
  if (trend === 'up') score += 20
  else if (trend === 'down') score -= 20
  score = Math.max(-100, Math.min(100, Math.round(score)))

  // Signal + action. The 200-day is decisive; below it is never "strong".
  const below200 = vs200 != null && vs200 < 0
  let signal: Signal
  let action: Action
  if (available === 0) {
    signal = 'neutral'
    action = 'Hold'
  } else if (aboveCount === available && trend !== 'down' && !below200) {
    signal = 'strong'
    action = 'Add'
  } else if (!below200 && aboveCount >= Math.ceil(available / 2)) {
    signal = 'healthy'
    action = 'Hold'
  } else if (below200 && (trend === 'down' || aboveCount === 0)) {
    signal = 'weak'
    action = 'Trim'
  } else if (below200) {
    signal = 'caution'
    action = 'Watch'
  } else {
    signal = 'neutral'
    action = 'Hold'
  }

  const parts: string[] = []
  if (vs200 != null) parts.push(`${vs200 >= 0 ? 'above' : 'below'} 200-day (${fmtPct(vs200)})`)
  else if (snap.history) parts.push(`only ${snap.history}d history — 200-day n/a`)
  if (trend === 'up') parts.push('SMAs stacked bullishly')
  else if (trend === 'down') parts.push('SMAs stacked bearishly')

  return {
    symbol: p.symbol,
    name: p.name,
    accountId: p.accountId,
    shares: p.shares,
    price,
    value,
    sma50: snap.sma50,
    sma100: snap.sma100,
    sma200: snap.sma200,
    vs50,
    vs100,
    vs200,
    trend,
    aboveCount,
    available,
    signal,
    action,
    score,
    note: parts.join(' · '),
  }
}

function fmtPct(v: number) {
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
}

// Build insights for every current non-option holding, dedup by ticker (summing
// shares across accounts is left per-position so order tickets stay per-account).
export function buildInsights(
  positions: Position[],
  bySymbol: Record<string, SmaSnapshot> | undefined,
): HoldingInsight[] {
  if (!bySymbol) return []
  const out: HoldingInsight[] = []
  for (const p of positions) {
    if (p.isOption) continue
    const snap = bySymbol[p.symbol] ?? bySymbol[normTicker(p.symbol)]
    const hi = holdingInsight(p, snap)
    if (hi) out.push(hi)
  }
  // Weakest first — the trim candidates surface at the top.
  out.sort((a, b) => a.score - b.score)
  return out
}

export const SIGNAL_STYLE: Record<Signal, { label: string; cls: string }> = {
  strong: { label: 'Strong uptrend', cls: 'text-[#3fd88a] bg-[#123024]' },
  healthy: { label: 'Healthy', cls: 'text-[#7fd0a0] bg-[#132a20]' },
  neutral: { label: 'Neutral', cls: 'text-muted bg-surface-2' },
  caution: { label: 'Caution', cls: 'text-[#f0a94a] bg-[#2a2010]' },
  weak: { label: 'Weak / downtrend', cls: 'text-[#f2607a] bg-[#33161d]' },
}

export const ACTION_STYLE: Record<Action, string> = {
  Add: 'text-[#3fd88a] border-[#1e6b45] bg-[#123024]',
  Hold: 'text-muted border-border bg-surface-2',
  Watch: 'text-[#f0a94a] border-[#5a4520] bg-[#2a2010]',
  Trim: 'text-[#f2607a] border-[#5a1f2a] bg-[#33161d]',
}
