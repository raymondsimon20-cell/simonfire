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
  securityId?: string // Broker-reported CUSIP, when available.
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
  allocationBucketSource?: 'account' | 'shared'
  // Schwab market-data fundamentals. annualDividend is the current indicated
  // annual distribution per share; these fields may be absent for unsupported
  // securities or when market data is temporarily unavailable.
  annualDividend?: number
  indicatedYield?: number
  lastDividend?: number
  dividendPayDate?: string
  dataSource?: 'csv' | 'api' | 'manual'
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
  statement?: { key: string; fileName: string; page: number; row: number; date: string }
  price?: number
  securityId?: string
  securityName?: string
  symbolSource?: 'broker' | 'manual' | 'inferred'
  id: string
  brokerTransactionId?: string
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
  plEstimated?: boolean // reconstructed from available trade/cost-basis data
  plSource?: 'broker' | 'csv' | 'statement' | 'estimated' | 'manual'
  tags: string[]
  classificationSource?: 'schwab' | 'automatic' | 'rule' | 'manual'
  duplicateReviewed?: boolean
  positionEffect?: 'Opening' | 'Closing' | 'Unknown'
  dataSource?: 'csv' | 'api' | 'manual' | 'statement'
}

export interface StatementTransactions {
  accountMask: string
  month: string
  fileName: string
  importedAt: string
  transactions: Omit<Transaction, 'id' | 'accountId'>[]
  complete: boolean
  issues: string[]
}

export interface TransactionOverride {
  updatedAt: string
  symbol?: string
  type?: TxnType
  duplicateReviewed?: boolean
  tags?: string[]
}

export interface CsvPositionAuthority {
  accountMask: string
  importedAt: string
  importBatchId?: string
  position: Omit<Position, 'id' | 'accountId'>
}

export interface CsvTransactionAuthority {
  accountMask: string
  importedAt: string
  importBatchId?: string
  transaction: Omit<Transaction, 'id' | 'accountId'>
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
  /** Manual "opened in" month (YYYY-MM) per account mask; overrides inference. */
  accountOpenMonths?: Record<string, string>
  statementTransactions?: StatementTransactions[]
  accountSyncCoverage?: AccountSyncCoverage[]
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
  symbolRules?: SymbolRule[]
  // Daily portfolio value series for time-weighted return (built at sync time).
  twr?: TwrSeries
  // Moving-average (50/100/200 SMA) snapshot per holding, for rebalance insights.
  insights?: Insights
  hedgeRolls?: HedgeRoll[]
  incomePlan?: IncomePlan
  spendingExclusions?: string[]
  lastSyncChanges?: SyncChangeSummary
  archivedTransactions?: Transaction[]
  realizedPlOverrides?: Record<string, number>
  csvPositionAuthority?: CsvPositionAuthority[]
  csvTransactionAuthority?: CsvTransactionAuthority[]
  importHistory?: ImportHistoryEntry[]
  freshnessThresholds?: { positions: number; transactions: number; realizedPl: number }
  savedTransactionViews?: { name: string; type: string; symbol: string; from: string; to: string; review: string }[]
  historicalBalances?: HistoricalBalance[]
  transactionOverrides?: Record<string, TransactionOverride>
  balanceSnapshots?: MonthlyBalanceSnapshot[]
  snapshotStatus?: SnapshotStatus
}

export interface AccountSyncCoverage {
  accountId: string
  from: string
  to: string
  transactionCount: number
  positionCount: number
  method: 'single request' | 'smaller date windows'
  syncedAt: string
  dividendLookup?: { resolved: number; failed: number; limited: number }
}

export interface HistoricalBalance {
  id: string
  accountMask: string
  month: string
  openingEquity?: number
  deposits: number
  withdrawals: number
  dividendsInterest: number
  marketChange: number
  expenses: number
  closingEquity: number
  marginLoanBalance?: number
  source: 'Schwab statement' | 'CSV' | 'Automatic snapshot'
  fileName: string
  importedAt: string
  asOf?: string
  monthEnd?: boolean
  flowsAvailable?: boolean
  coverageNote?: string
}

export interface SnapshotFlows {
  deposits: number
  withdrawals: number
  dividendsInterest: number
  expenses: number
  available: boolean
  reviewRequired: boolean
}

export interface BalanceSnapshot {
  accountMask: string
  capturedAt: string
  date: string // Brokerage calendar date in America/New_York.
  equity: number
  marginDebt: number
  cash: number
  monthEnd: boolean // Captured after regular market close on the calendar month's last day.
  source: 'sync' | 'scheduled'
  flows: SnapshotFlows
}

export interface MonthlyBalanceSnapshot {
  accountMask: string
  month: string
  first: BalanceSnapshot
  latest: BalanceSnapshot
}

export interface SnapshotStatus {
  attemptedAt: string
  state: 'ok' | 'partial' | 'reconnect' | 'error'
}

export interface ImportHistoryEntry {
  id: string
  importedAt: string
  files: string[]
  positions: number
  transactions: number
  realizedPl: number
  realizedPlKeys?: string[]
  status: 'active' | 'rolled_back'
}

export interface SyncChangeSummary {
  at: string
  addedPositions: string[]
  removedPositions: string[]
  newTransactions: number
  newDividends: number
  valueChange: number
  latestTransactionDate: string
  quantityChanges?: string[]
  csvAuthoritativeRecords?: number
  csvConflicts?: number
  csvConflictDetails?: { record: string; field: string; apiValue: string; csvValue: string; winner: 'CSV' | 'API' }[]
}

export interface IncomePlan {
  allocationExpenseReserve?: boolean
  allocationSizing?: 'priority' | 'gaps' | 'equal' | 'trend'
  annualW2Target: number
  monthlySpending: number
  estimatedTaxRate: number // 0–100
  distributionCutPct: number // 0–100 stress-test reduction
  cashReserveMonths: number
  marginEquityAlertPct: number
  concentrationAlertPct: number
  incomeCoverageAlertPct: number
}

export interface SymbolRule {
  id: string
  contains: string
  symbol: string
  accountId?: string
}

export interface HedgeRoll {
  id: string
  proxy: 'QQQ' | 'SPY'
  contracts: number
  strike: number
  expiration: string
  premiumPerShare: number
  grossPremium: number
  rollDate: string
  createdAt: string
  status: 'queued' | 'active' | 'rolled' | 'closed'
  source: 'planning' | 'manual'
  optionSymbol?: string
  accountId?: string
  previewState?: 'not_previewed' | 'accepted' | 'rejected'
  previewedAt?: string
  previewError?: string
  previewRequestId?: string
  orderId?: string
  orderStatus?: string
  placedAt?: string
  closeOptionSymbol?: string
  closeContracts?: number
  closeLimitCredit?: number
  closePreviewRequestId?: string
  closePreviewState?: 'not_previewed' | 'accepted' | 'rejected'
  closeOrderId?: string
  closeOrderStatus?: string
  closePlacedAt?: string
  closeCostBasis?: number
  closeEstimatedValue?: number
  closeEstimatedPL?: number
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
  // Net account equity after margin debt. Only present for a reported balance;
  // historical debt is not inferred from the current margin balance.
  equity?: number
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
