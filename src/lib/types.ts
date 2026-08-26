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
}

export type TxnType =
  | 'Buy'
  | 'Sell'
  | 'Dividend'
  | 'Interest'
  | 'Contribution'
  | 'Withdrawal'
  | 'Bill Payment'
  | 'Fee'
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
}
