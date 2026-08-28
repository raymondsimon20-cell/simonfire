// Domain model for the SimonFIRE portfolio tracker.

export type AccountType =
  | 'Individual'
  | 'Joint'
  | 'Roth IRA'
  | 'Traditional IRA'
  | 'Margin'

export interface Account {
  id: string
  broker: string // e.g. "Schwab"
  name: string // e.g. "Raymond"
  fullName: string // e.g. "Raymond (Raymond ...391)"
  mask: string // last 3-4 digits
  type: AccountType
  isMargin: boolean
  cash: number // settled + unsettled cash
  marginBalance: number // outstanding margin (negative liability magnitude, stored positive)
  // Optional broker-reported balances (populate the account-detail KPIs).
  equity?: number // net liquidation value / equity
  buyingPower?: number
  sma?: number // Schwab Special Memorandum Account balance
  availableFunds?: number // cash available to withdraw (incl. margin)
  longMarketValue?: number
}

export interface Position {
  id: string
  accountId: string
  symbol: string
  name: string
  shares: number
  avgCost: number // per share cost basis
  lastPrice: number
  prevClose: number
  // Total lifetime dividends received on this holding (for total-return calc)
  dividendsReceived: number
  isOption?: boolean
  // Option contract detail (present when isOption). avgCost/lastPrice are stored
  // per-contract (premium × 100) so value/cost math matches; display divides back.
  optionType?: 'Put' | 'Call'
  strike?: number
  expiration?: string // ISO yyyy-mm-dd
  underlying?: string
  allocationBucket?: 'Growth' | 'CEFs' | 'High Yield' | 'Leveraged'
  // Schwab market-data fundamentals. annualDividend is the current indicated
  // annual distribution per share; these fields may be absent for unsupported
  // securities or when market data is temporarily unavailable.
  annualDividend?: number
  indicatedYield?: number
  lastDividend?: number
  dividendPayDate?: string
}

export type TxnType =
  | 'Buy'
  | 'Sell'
  | 'Dividend'
  | 'Interest'
  | 'Contribution'
  | 'Withdrawal'
  | 'Bill Payment'
  | 'Transfer'
  | 'Fee'
  | 'Tax Withholding'
  | 'Corporate Action'
  | 'Other'

export interface Transaction {
  id: string
  accountId: string
  date: string // ISO yyyy-mm-dd
  type: TxnType
  symbol?: string
  description: string
  amount: number // cash impact (+ inflow, - outflow)
  units: number // shares +/- (0 for cash-only)
  fee?: number
  strike?: number
  exp?: string
  pl?: number // realized P/L on sells
  tags: string[]
  classificationSource?: 'schwab' | 'automatic' | 'rule' | 'manual'
}

export interface Connection {
  id: string
  broker: string
  status: 'Active' | 'Error' | 'Disconnected'
  accountIds: string[]
  lastSynced: string // ISO datetime
  events: ConnectionEvent[]
}

export interface ConnectionEvent {
  at: string
  kind: 'sync' | 'connect' | 'error' | 'refresh'
  message: string
}

export interface AppData {
  version: number
  accounts: Account[]
  positions: Position[]
  transactions: Transaction[]
  connections: Connection[]
  lastSyncAt: string
  // Where the current dataset came from — drives the header badge.
  source?: 'sample' | 'imported' | 'live'
  // Target plan: tickers to keep. Off-plan holdings surface on the Rebalance page.
  keepList?: string[]
  // Positions marked sold in the tracker ("accountId|SYMBOL"); filtered out on sync.
  soldSymbols?: string[]
  // Target allocation: bucket name → target percent (0–100), should sum to 100.
  targetAlloc?: Record<string, number>
  bucketOverrides?: Record<string, 'Growth' | 'CEFs' | 'High Yield' | 'Leveraged'>
  // Auto-tagging rules applied to existing + future transactions.
  tagRules?: TagRule[]
  // Daily portfolio value series for time-weighted return (built at sync time).
  twr?: TwrSeries
  // Moving-average (50/100/200 SMA) snapshot per holding, for rebalance insights.
  insights?: Insights
}

export interface SmaSnapshot {
  symbol: string
  price: number
  sma50: number | null
  sma100: number | null
  sma200: number | null
  history: number // number of daily closes available (200 needed for SMA-200)
}

export interface Insights {
  bySymbol: Record<string, SmaSnapshot>
  generatedAt: string
}

export interface TwrPoint {
  date: string // ISO yyyy-mm-dd
  value: number // portfolio value (securities MV + cash) at close
}

// Per-account (+ combined) daily value series produced at sync time. TWR itself
// is computed live from this series plus the current transaction classifications,
// so re-tagging contributions/withdrawals recomputes the return without a re-sync.
export interface TwrSeries {
  byAccount: Record<string, TwrPoint[]> // key: account id
  all: TwrPoint[] // combined portfolio
  generatedAt: string // ISO datetime
  note?: string // caveats (e.g. options valued at cost)
}

export interface TagRule {
  id: string
  contains: string // case-insensitive match on the transaction description
  tag: string // tag/label to apply to matching transactions
  setType?: TxnType // optionally re-categorize matching transactions
  amountDirection?: 'positive' | 'negative' | 'zero' // optional cash-direction guard
  enabled: boolean
}
