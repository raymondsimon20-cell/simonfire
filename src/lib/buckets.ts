// Bucket classification for the Target Allocation tool. Every holding is sorted
// into one of four buckets. Classification uses an explicit ticker map first
// (derived from the P2P allocation tool), then name-based heuristics.
import type { Position, Transaction } from './types'
import { normTicker } from './plan'
import { dividendStats } from './calc'

export type Bucket = 'Growth' | 'CEFs' | 'High Yield' | 'Leveraged'
export const BUCKETS: Bucket[] = ['Growth', 'CEFs', 'High Yield', 'Leveraged']

export const BUCKET_COLOR: Record<Bucket, string> = {
  Growth: '#34d17d',
  CEFs: '#f0a94a',
  'High Yield': '#5aa2ff',
  Leveraged: '#b18aff',
}

// Explicit ticker → bucket overrides.
const MAP: Record<string, Bucket> = {}
const add = (b: Bucket, tickers: string[]) => tickers.forEach((t) => (MAP[normTicker(t)] = b))

add('Growth', [
  'SPYG', 'MCD', 'COST', 'NVDA', 'AMZN', 'BRK.B', 'BRKB', 'MSTR', 'KGC', 'AAAU', 'QQQ', 'ITA',
  'AAPL', 'GOOGL', 'META', 'MSFT', 'IWM', 'IVV', 'SPY', 'VOO', 'VTI', 'VXUS', 'VYM', 'VGT',
  'QQQM', 'RSP', 'SCHB', 'SCHD', 'SCHG', 'SGOV', 'USFR', 'WEEK', 'GLD', 'IAU', 'IEF', 'BLOK',
  'COWS', 'DEFI', 'DOG', 'CASH', 'HIBL', 'FNGD', 'BND', 'AGG', 'DJIA',
])
add('CEFs', [
  'CLM', 'CRF', 'GOF', 'ECAT', 'BDJ', 'BGY', 'BST', 'EOI', 'EOS', 'ETV', 'EVT', 'GAB', 'GDV',
  'PCN', 'PDI', 'PTY', 'USA', 'BCAT', 'BUI', 'CHW', 'CSQ', 'ETB', 'EXG', 'GGT', 'OPP', 'OXLC',
])
add('Leveraged', [
  'CURE', 'FAS', 'FAZ', 'FNGU', 'LABU', 'NVDL', 'SDOW', 'SOXL', 'SPXL', 'SPXS', 'SQQQ', 'SRTY',
  'TECL', 'TNA', 'TQQQ', 'TSLL', 'UPRO', 'UVXY', 'UDOW', 'UMDD', 'URTY', 'FNGO', 'BULZ',
])
add('High Yield', [
  'AMZY', 'NVDY', 'MSTY', 'PLTY', 'TSYY', 'GDXY', 'YMAX', 'QQQI', 'SPYI', 'BTCI', 'NIHI', 'IAUI',
  'KSLV', 'XDTE', 'RDTE', 'QDTE', 'IWMY', 'QQQY', 'TOPW', 'O', 'AMDY', 'FIAT', 'CVNY', 'BIOY',
  'CRSH', 'AIYY', 'MSFO', 'CONY', 'DIPS', 'FBY', 'NFLY', 'APLY', 'MAGY', 'OARK', 'KLIP', 'IWMI',
  'MRNY', 'JEPQ', 'JEPI', 'AIPI', 'FEPI', 'DIVO', 'KMLM', 'TSLY', 'ULTY', 'PLTW', 'NVW', 'AMDW',
  'MSTW', 'CHPY', 'GLDI', 'QDTY', 'BRKW', 'WDTE', 'GPTY', 'COIY', 'ULTP',
])

// Name-based heuristics for anything not in the map.
function classifyByName(name: string): Bucket {
  const n = name.toUpperCase()
  if (
    /\b[23]X\b|ULTRAPRO|ULTRA PRO|DIREXION DAILY|GRANITESHARES 2X|LEVERAGED ETN|BULL 3X|BEAR 3X|ULTRA VIX|MICROSECTORS/.test(n)
  )
    return 'Leveraged'
  if (
    /OPTION INCOME|WEEKLYPAY|WEEKLY PAY|YIELDMAX|YIELDBOOST|0DTE|HIGH INCOME|ENHANCED OPTION|COVERED CALL|PREMIUM INCOME|OPTION PREMIUM|WEEKLY OPTION|OPTION STRATEGY|TARGET \d+ INCOME|TARGET INCOME|DAILY TARGET/.test(n)
  )
    return 'High Yield'
  if (/CLOSED[- ]END|TERM TRUST|INCOME TRUST|DIVIDEND TRUST|STRATEGIC (VALUE|OPPORTUNITIES)|TOTAL RETURN FUND/.test(n))
    return 'CEFs'
  return 'Growth'
}

export function bucketOf(p: Position): Bucket {
  const key = normTicker(p.isOption && p.underlying ? p.underlying : p.symbol)
  if (MAP[key]) return MAP[key]
  return classifyByName(p.name || p.symbol)
}

export interface BucketStat {
  bucket: Bucket
  value: number
  count: number
  weight: number // fraction of total
  runRateIncome: number // historical per-share payments scaled to current shares
  yieldValue: number // eligible long equity/ETF market value; options excluded
  yield: number // runRateIncome / yieldValue
}

// Per-bucket allocation value and current-share distribution run-rate yield.
export function bucketStats(positions: Position[], transactions: Transaction[]): {
  buckets: Record<Bucket, BucketStat>
  total: number
  blendedYield: number
} {
  const now = new Date()
  const localToday = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
  const runRateBySym = new Map(
    dividendStats(positions, transactions, localToday).bySymbol.map((s) => [s.symbol, s.projAnnual]),
  )

  const init = (): BucketStat => ({ bucket: 'Growth', value: 0, count: 0, weight: 0, runRateIncome: 0, yieldValue: 0, yield: 0 })
  const buckets = {
    Growth: { ...init(), bucket: 'Growth' as Bucket },
    CEFs: { ...init(), bucket: 'CEFs' as Bucket },
    'High Yield': { ...init(), bucket: 'High Yield' as Bucket },
    Leveraged: { ...init(), bucket: 'Leveraged' as Bucket },
  } as Record<Bucket, BucketStat>

  let total = 0
  // dividendStats already combines accounts and scales payments to all current
  // shares, so attribute each symbol's run rate exactly once.
  const symSeen = new Set<string>()
  for (const p of positions) {
    const b = bucketOf(p)
    const value = p.shares * p.lastPrice
    buckets[b].value += value
    buckets[b].count += 1
    total += value
    const key = normTicker(p.symbol)
    if (!p.isOption && p.shares > 0) buckets[b].yieldValue += value
    if (!p.isOption && p.shares > 0 && !symSeen.has(key)) {
      symSeen.add(key)
      buckets[b].runRateIncome += runRateBySym.get(key) ?? 0
    }
  }
  let blendedIncome = 0
  let blendedValue = 0
  for (const b of BUCKETS) {
    const s = buckets[b]
    s.weight = total ? s.value / total : 0
    s.yield = s.yieldValue ? s.runRateIncome / s.yieldValue : 0
    blendedIncome += s.runRateIncome
    blendedValue += s.yieldValue
  }
  return { buckets, total, blendedYield: blendedValue ? blendedIncome / blendedValue : 0 }
}
