import { BUCKETS, type Bucket } from './buckets'
import type { Signal } from './insights'

export type AllocationSizing = 'priority' | 'gaps' | 'equal' | 'trend'

export interface AllocationHolding {
  symbol: string
  name: string
  price: number
  value: number
  annualIncome: number
  trendScore?: number
  trendSignal?: Signal
}

export function hasPriorityTrend(row: AllocationHolding) {
  return Number.isFinite(row.trendScore) && (row.trendSignal === 'strong' || row.trendSignal === 'healthy')
}

export function compareAllocationPriority(a: AllocationHolding, b: AllocationHolding) {
  return Number(hasPriorityTrend(b)) - Number(hasPriorityTrend(a))
    || (b.trendScore ?? -Infinity) - (a.trendScore ?? -Infinity)
    || a.symbol.localeCompare(b.symbol)
}

export function allocationPriorityReason(row: AllocationHolding, gap: number) {
  if (gap <= 0) return 'At or above target size; no new buy'
  if (!(row.price > 0) || !Number.isFinite(row.price)) return 'Paused: no usable price'
  if (!Number.isFinite(row.trendScore) || !row.trendSignal) return 'Paused: fresh 50/100/200-day signals needed'
  if (!hasPriorityTrend(row)) return `Paused: ${row.trendSignal} trend`
  return `${row.trendSignal === 'strong' ? 'Strong' : 'Healthy'} trend · score ${row.trendScore} · below target size`
}

export interface AllocationOrder extends AllocationHolding {
  bucket: Bucket
  shares: number
  spend: number
  reason: string
}

// Respect bucket budgets first, then fill the gaps to an equal-weight mix
// within each bucket. Never buy an overweight holding just to spend the budget.
export function allocationOrders(
  budgets: Record<Bucket, number>,
  holdings: Record<Bucket, AllocationHolding[]>,
  wholeShares: boolean,
  sizing: AllocationSizing = 'gaps',
): AllocationOrder[] {
  const orders: AllocationOrder[] = []
  for (const bucket of BUCKETS) {
    const budget = budgets[bucket]
    if (!Number.isFinite(budget) || budget <= 0) continue
    const rows = holdings[bucket].filter((row) => row.value >= 0 && Number.isFinite(row.value))
    if (!rows.length) continue
    const target = (rows.reduce((sum, row) => sum + row.value, 0) + budget) / rows.length
    const gaps = rows.map((row) => sizing === 'equal' ? 1 : Math.max(0, target - row.value))
    if (sizing === 'priority') {
      const scale = wholeShares ? 1 : 1000
      const candidates = rows.map((row, index) => ({ row, gap: gaps[index] }))
        .filter(({ row, gap }) => hasPriorityTrend(row) && Number.isFinite(row.price) && row.price > 0 && gap >= row.price / scale)
        .sort((a, b) => compareAllocationPriority(a.row, b.row))
      let remaining = budget
      // Allocate to the highest score first; tied holdings share dollars by
      // their gaps. A weaker trend never displaces a stronger eligible trend.
      for (const score of [...new Set(candidates.map(({ row }) => row.trendScore!))]) {
        const group = candidates.filter(({ row }) => row.trendScore === score && row.price / scale <= remaining)
        const totalGap = group.reduce((sum, item) => sum + item.gap, 0)
        const groupBudget = Math.min(remaining, totalGap)
        if (!groupBudget) continue
        const quantities = group.map(({ row, gap }) => Math.floor(Math.min(gap, groupBudget * gap / totalGap) / row.price * scale) / scale)
        let spare = groupBudget - group.reduce((sum, { row }, i) => sum + quantities[i] * row.price, 0)
        // Keep affordable rounding leftovers at this score before considering
        // the next score. This matters when a small budget cannot buy every tie.
        group.forEach(({ row, gap }, i) => {
          const extra = Math.floor(Math.max(0, Math.min(spare, gap - quantities[i] * row.price)) / row.price * scale) / scale
          quantities[i] += extra
          spare -= extra * row.price
        })
        for (const [i, { row, gap }] of group.entries()) {
          const shares = quantities[i]
          const spend = shares * row.price
          if (!shares || spend <= 0.5) continue
          orders.push({ ...row, bucket, shares, spend, reason: allocationPriorityReason(row, gap) })
          remaining -= spend
        }
      }
      continue
    }
    const tilt = rows.map((row) => sizing === 'trend' && Number.isFinite(row.trendScore)
      ? Math.max(-100, Math.min(100, row.trendScore!)) / 100 * (bucket === 'CEFs' || bucket === 'High Yield' ? 0.05 : 0.2) : 0)
    const weights = gaps.map((gap, i) => gap * (1 + tilt[i]))
    const assigned = rows.map(() => 0)
    let remaining = budget
    let active = rows.map((_, i) => i).filter((i) => weights[i] > 0)
    // Redistribute only when a proposed tilt reaches a holding's target gap.
    // This caps trend influence before shares are rounded, including tiny buys.
    while (active.length && remaining > 0.000001) {
      const totalWeight = active.reduce((sum, i) => sum + weights[i], 0)
      const capped = sizing === 'equal' ? [] : active.filter((i) => remaining * weights[i] / totalWeight > gaps[i] - assigned[i])
      if (!capped.length) {
        for (const i of active) assigned[i] += remaining * weights[i] / totalWeight
        break
      }
      for (const i of capped) { remaining -= gaps[i] - assigned[i]; assigned[i] = gaps[i] }
      active = active.filter((i) => !capped.includes(i))
    }
    rows.forEach((row, index) => {
      if (!(row.price > 0) || !Number.isFinite(row.price)) return
      const amount = assigned[index]
      const scale = wholeShares ? 1 : 1000
      const shares = Math.floor(amount / row.price * scale) / scale
      const spend = shares * row.price
      if (!shares || spend <= 0.5) return
      orders.push({ ...row, bucket, shares, spend,
        reason: sizing === 'equal' ? 'Equal share of bucket budget' : sizing === 'trend'
          ? `Holding gap; trend weight ${tilt[index] >= 0 ? '+' : ''}${Math.round(tilt[index] * 100)}%${row.trendScore == null ? ' (no usable trend data)' : ''}`
          : 'Below equal-weight target within bucket',
      })
    })
  }
  return orders
}

export function allocationProjection(holdings: Record<Bucket, AllocationHolding[]>, orders: AllocationOrder[]) {
  const byBucket = Object.fromEntries(BUCKETS.map((bucket) => [bucket, {
    value: holdings[bucket].reduce((sum, row) => sum + row.value, 0),
    spend: orders.filter((row) => row.bucket === bucket).reduce((sum, row) => sum + row.spend, 0),
  }])) as Record<Bucket, { value: number; spend: number }>
  const valueBefore = BUCKETS.reduce((sum, bucket) => sum + byBucket[bucket].value, 0)
  const incomeBefore = BUCKETS.flatMap((bucket) => holdings[bucket]).reduce((sum, row) => sum + row.annualIncome, 0)
  const spend = orders.reduce((sum, row) => sum + row.spend, 0)
  const addedIncome = orders.reduce((sum, row) => sum + (row.value > 0 ? row.spend * row.annualIncome / row.value : 0), 0)
  return {
    byBucket, spend, addedIncome,
    valueAfter: valueBefore + spend,
    yieldAfter: valueBefore + spend > 0 ? (incomeBefore + addedIncome) / (valueBefore + spend) : 0,
  }
}
