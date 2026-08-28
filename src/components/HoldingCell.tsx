import type { Position } from '../lib/types'
import { optionLabel } from '../lib/format'
import { bucketOf, BUCKET_COLOR, type Bucket } from '../lib/buckets'

export function BucketBadge({ bucket }: { bucket: Bucket }) {
  const color = BUCKET_COLOR[bucket]
  return (
    <span
      className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]"
      style={{ borderColor: `${color}35`, backgroundColor: `${color}12`, color }}
    >
      {bucket}
    </span>
  )
}

// Shared "Holding" cell used by the positions tables. Options show the underlying
// symbol, a contract subtitle, and a SHORT badge; stocks show symbol + name.
export function HoldingCell({ p }: { p: Position }) {
  const short = p.isOption && p.shares < 0
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        {short && (
          <span className="rounded border border-[#7a611c] bg-[#241d0c] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#e0b24a]">
            Short
          </span>
        )}
        <span className="font-semibold">{p.symbol}</span>
        <BucketBadge bucket={bucketOf(p)} />
      </div>
      <div className="max-w-[200px] truncate text-xs text-faint">
        {p.isOption ? optionLabel(p) : p.name}
      </div>
    </div>
  )
}

// True when an option's percentage / total-return cells should be dashed out
// (they aren't meaningful for a short-premium contract).
export const isOpt = (p: Position) => !!p.isOption
// Per-share option premium for display (avgCost/lastPrice are stored per-contract).
export const displayPrice = (p: Position) => (p.isOption ? p.lastPrice / 100 : p.lastPrice)
export const displayShares = (p: Position) => (p.isOption ? Math.abs(p.shares) : p.shares)
