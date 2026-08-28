export interface ProtectivePutInput {
  shares: number
  sharePrice: number
  coveragePct: number
  maxDrawdownPct: number
  premiumPerShare: number
}

export function protectivePutPlan(input: ProtectivePutInput) {
  const shares = Math.max(0, input.shares)
  const sharePrice = Math.max(0, input.sharePrice)
  const coveragePct = Math.max(0, Math.min(100, input.coveragePct))
  const drawdownPct = Math.max(0, Math.min(100, input.maxDrawdownPct))
  const premiumPerShare = Math.max(0, input.premiumPerShare)
  const desiredShares = shares * coveragePct / 100
  const contracts = desiredShares > 0 ? Math.ceil(desiredShares / 100) : 0
  const coveredShares = Math.min(shares, contracts * 100)
  const strike = +(sharePrice * (1 - drawdownPct / 100)).toFixed(2)
  const premiumCost = premiumPerShare * 100 * contracts
  const protectedNotional = strike * coveredShares
  const positionValue = shares * sharePrice
  return {
    contracts,
    coveredShares,
    actualCoveragePct: shares ? coveredShares / shares : 0,
    strike,
    premiumCost,
    protectedNotional,
    effectiveFloor: Math.max(0, strike - premiumPerShare),
    premiumDrag: positionValue ? premiumCost / positionValue : 0,
    positionValue,
  }
}
