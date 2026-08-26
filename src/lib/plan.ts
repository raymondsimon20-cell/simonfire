// Target holding plan — the funds Raymond wants to keep. Anything held that is
// NOT on this list shows up on the Rebalance page as an off-plan holding to sell.

export interface PlanBucket {
  name: string
  tickers: string[]
}

export const DEFAULT_PLAN: PlanBucket[] = [
  {
    name: 'Bucket 1: Growth (Anchors)',
    tickers: ['SPYG', 'MCD', 'COST', 'NVDA', 'AMZN', 'BRK.B', 'BRKW', 'MSTR', 'KGC', 'AAAU', 'QQQ', 'ITA'],
  },
  {
    name: 'Bucket 2: CEFs (Compounding Engines)',
    tickers: ['CLM', 'CRF', 'GOF', 'ECAT'],
  },
  {
    name: 'Bucket 3: High-Yield (Cash Flow)',
    tickers: [
      'AMZY', 'NVDY', 'MSTY', 'PLTY', 'TSYY', 'GDXY', 'YMAX', 'QQQI', 'SPYI', 'BTCI',
      'NIHI', 'IAUI', 'KSLV', 'XDTE', 'RDTE', 'QDTE', 'IWMY', 'QQQY', 'TOPW', 'O',
    ],
  },
]

export const DEFAULT_KEEP: string[] = DEFAULT_PLAN.flatMap((b) => b.tickers)

// Normalize a ticker for comparison: BRK.B / BRK/B / BRKB all match.
export const normTicker = (s: string) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export const keepSetOf = (keep: string[]) => new Set(keep.map(normTicker))
