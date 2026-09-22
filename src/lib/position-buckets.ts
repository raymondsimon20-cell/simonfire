import type { Position } from './types'
import { normTicker } from './plan'

type Bucket = NonNullable<Position['allocationBucket']>

// Account-specific choices win. New accounts inherit a ticker's explicit
// category only when all saved choices agree; never guess across conflicts.
export function applyPositionBuckets(positions: Position[], overrides: Record<string, Bucket> = {}) {
  const bySymbol = new Map<string, Set<Bucket>>()
  const byAccount = new Map<string, Bucket>()
  for (const [key, bucket] of Object.entries(overrides)) {
    const split = key.lastIndexOf('|')
    if (split < 0) continue
    const symbol = normTicker(key.slice(split + 1))
    byAccount.set(`${key.slice(0, split)}|${symbol}`, bucket)
    const choices = bySymbol.get(symbol) ?? new Set<Bucket>()
    choices.add(bucket)
    bySymbol.set(symbol, choices)
  }
  for (const row of positions) {
    const symbol = normTicker(row.symbol)
    const exact = byAccount.get(`${row.accountId}|${symbol}`)
    const shared = bySymbol.get(symbol)
    row.allocationBucket = exact ?? (shared?.size === 1 ? [...shared][0] : undefined)
    row.allocationBucketSource = exact ? 'account' : row.allocationBucket ? 'shared' : undefined
  }
}
