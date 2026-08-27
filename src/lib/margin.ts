import type { Account } from './types'

export interface MarginCapacity {
  maxOrderSpend: number
  currentUsage: number
  projectedUsage: (spend: number) => number
  basis: 'SMA, buying power, and 50% minimum equity' | 'buying power and 50% minimum equity' | '50% minimum equity' | 'available cash'
  alreadyOverLimit: boolean
}

// Maximum planned order spend that keeps margin debt / gross assets <= 50%.
// Purchases consume positive cash first; only spend beyond cash increases both
// margin debt and gross assets. Schwab buying power and SMA are additional
// hard caps when the broker reports them.
export function marginCapacity(account: Account | undefined, positionValue: number): MarginCapacity | null {
  if (!account) return null
  const cash = Math.max(0, account.cash || 0)
  const debt = Math.max(0, account.marginBalance || 0)
  const brokerEquity = account.equity
  const gross = Math.max(0, brokerEquity != null ? brokerEquity + debt : positionValue + account.cash)
  const currentUsage = gross > 0 ? debt / gross : 0

  if (!account.isMargin) {
    const maxOrderSpend = Math.max(0, Math.min(cash, account.buyingPower ?? cash))
    return {
      maxOrderSpend,
      currentUsage: 0,
      projectedUsage: () => 0,
      basis: 'available cash',
      alreadyOverLimit: false,
    }
  }

  const alreadyOverLimit = currentUsage > 0.5
  const marginHeadroom = alreadyOverLimit ? 0 : Math.max(0, gross - 2 * debt)
  const ratioLimitedSpend = alreadyOverLimit ? 0 : cash + marginHeadroom
  const hasBrokerBuyingPower = account.buyingPower != null && account.buyingPower >= 0
  const hasSma = account.sma != null && account.sma >= 0
  const maxOrderSpend = Math.min(
    ratioLimitedSpend,
    hasBrokerBuyingPower ? account.buyingPower! : Number.POSITIVE_INFINITY,
    hasSma ? account.sma! : Number.POSITIVE_INFINITY,
  )

  return {
    maxOrderSpend,
    currentUsage,
    projectedUsage: (spend: number) => {
      const borrowed = Math.max(0, spend - cash)
      const nextGross = gross + borrowed
      return nextGross > 0 ? (debt + borrowed) / nextGross : 0
    },
    basis: hasSma
      ? 'SMA, buying power, and 50% minimum equity'
      : hasBrokerBuyingPower ? 'buying power and 50% minimum equity' : '50% minimum equity',
    alreadyOverLimit,
  }
}
