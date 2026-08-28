export interface ProtectivePutInput {
  shares: number
  sharePrice: number
  coveragePct: number
  maxDrawdownPct: number
  premiumPerShare: number
  contractRounding?: 'down' | 'nearest' | 'up'
  strikePrice?: number
}

export function protectivePutPlan(input: ProtectivePutInput) {
  const shares = Math.max(0, input.shares)
  const sharePrice = Math.max(0, input.sharePrice)
  const coveragePct = Math.max(0, Math.min(100, input.coveragePct))
  const drawdownPct = Math.max(0, Math.min(100, input.maxDrawdownPct))
  const premiumPerShare = Math.max(0, input.premiumPerShare)
  const desiredShares = shares * coveragePct / 100
  const rawContracts = desiredShares / 100
  const contracts = desiredShares <= 0 ? 0 : (input.contractRounding ?? 'up') === 'up'
    ? Math.ceil(rawContracts)
    : input.contractRounding === 'nearest' ? Math.round(rawContracts) : Math.floor(rawContracts)
  const contractShares = contracts * 100
  const coveredShares = Math.min(shares, contractShares)
  const uncoveredShares = Math.max(0, shares - contractShares)
  const overhedgedShares = Math.max(0, contractShares - shares)
  const suggestedStrike = +(sharePrice * (1 - drawdownPct / 100)).toFixed(2)
  const strike = input.strikePrice != null && input.strikePrice > 0 ? input.strikePrice : suggestedStrike
  const premiumCost = premiumPerShare * 100 * contracts
  const protectedNotional = strike * coveredShares
  const positionValue = shares * sharePrice
  const floorValueAtZero = contractShares * strike
  const maxLoss = Math.max(0, positionValue + premiumCost - floorValueAtZero)
  return {
    shares,
    sharePrice,
    contracts,
    contractShares,
    coveredShares,
    uncoveredShares,
    overhedgedShares,
    actualCoveragePct: shares ? coveredShares / shares : 0,
    strike,
    suggestedStrike,
    premiumCost,
    protectedNotional,
    effectiveFloor: Math.max(0, strike - premiumPerShare),
    premiumDrag: positionValue ? premiumCost / positionValue : 0,
    breakEvenPrice: shares ? sharePrice + premiumCost / shares : 0,
    maxLoss,
    maxLossPct: positionValue ? maxLoss / positionValue : 0,
    positionValue,
  }
}

export function protectivePutOutcome(
  plan: ReturnType<typeof protectivePutPlan>,
  expirationPrice: number,
) {
  const price = Math.max(0, expirationPrice)
  const terminalValue = plan.shares * price + plan.contractShares * Math.max(plan.strike - price, 0)
  const pnl = terminalValue - plan.positionValue - plan.premiumCost
  return { expirationPrice: price, terminalValue, pnl, returnPct: plan.positionValue ? pnl / plan.positionValue : 0 }
}
