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

export interface PutQuoteCandidate {
  strike: number
  ask: number | null
  mark: number | null
  last: number | null
  bid: number | null
  daysToExpiration: number | null
  openInterest: number | null
  volume: number | null
}

export function rankProtectivePut<T extends PutQuoteCandidate>(
  quote: T,
  sharePrice: number,
  targetDrawdownPct: number,
  targetDays: number,
) {
  const premium = quote.ask ?? quote.mark ?? quote.last ?? quote.bid ?? 0
  const bid = quote.bid ?? 0
  const ask = quote.ask ?? premium
  const midpoint = Math.max((bid + ask) / 2, 0.01)
  const spreadPct = ask > 0 ? Math.max(0, ask - bid) / midpoint : 1
  const targetFloor = sharePrice * (1 - Math.max(0, Math.min(100, targetDrawdownPct)) / 100)
  const effectiveFloor = quote.strike - premium
  const floorGapPct = sharePrice > 0 ? Math.abs(effectiveFloor - targetFloor) / sharePrice : 1
  const dte = quote.daysToExpiration ?? targetDays
  const dteGap = targetDays > 0 ? Math.abs(dte - targetDays) / targetDays : 0
  const oi = quote.openInterest ?? 0
  const volume = quote.volume ?? 0
  const floorPenalty = Math.min(38, floorGapPct * 240)
  const spreadPenalty = Math.min(24, spreadPct * 35)
  const dtePenalty = Math.min(16, dteGap * 12)
  const liquidityPenalty = oi >= 500 ? 0 : oi >= 100 ? 4 : oi > 0 ? 9 : 14
  const volumePenalty = volume >= 50 ? 0 : volume >= 10 ? 2 : volume > 0 ? 5 : 8
  const premiumPenalty = sharePrice > 0 ? Math.min(8, premium / sharePrice * 50) : 8
  const score = Math.max(0, Math.round(100 - floorPenalty - spreadPenalty - dtePenalty - liquidityPenalty - volumePenalty - premiumPenalty))
  const protectionPct = sharePrice > 0 ? (1 - effectiveFloor / sharePrice) * 100 : 0
  const reasons = [
    `${protectionPct.toFixed(1)}% effective protection floor`,
    spreadPct <= 0.12 ? 'tight spread' : spreadPct <= 0.3 ? 'moderate spread' : 'wide spread',
    oi >= 500 ? 'strong open interest' : oi >= 100 ? 'useful open interest' : 'thin open interest',
  ]
  return { score, premium, effectiveFloor, targetFloor, floorGapPct, spreadPct, reasons }
}
