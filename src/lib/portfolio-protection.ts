import type { Position } from './types'
import { isActiveProtectivePut, putPlanMatchesContract } from './hedge'
export const HEDGE_ADVISORY_ONLY = true
export const PROTECTION_FLOOR = 0.5
export const PROTECTION_SHOCKS = [5, 10, 20, 30] as const
export interface HoldingRisk {
  beta?: number; correlation?: number; leverage?: number; maintenancePct?: number
  source?: string; maintenanceSource?: string
}
export interface ProtectionQuote {
  symbol: string; expiration: string; strike: number; ask: number | null; bid: number | null
  multiplier?: number | null; openInterest?: number | null; volume?: number | null
}
export interface ProtectionInput {
  accountCount?: number
  positions: Position[]; risks: Record<string, HoldingRisk>; gross: number; debt: number
  qqqPrice: number; today: string; horizonDays: number; ratePct: number; feePerContract: number
  quoteFetchedAt?: string; delayed?: boolean; now?: number
  budget: number; quotes: ProtectionQuote[]; closePositionId?: string; maxContracts?: number
}
export const riskKey = (p: Position) => `${p.accountId}|${p.symbol.trim().toUpperCase()}`
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
export function priceRisk(closes: Record<string, number>, benchmark: Record<string, number>) {
  const dates = Object.keys(closes).filter((d) => finite(closes[d]) && closes[d] > 0 && finite(benchmark[d]) && benchmark[d] > 0).sort()
  const x: number[] = [], y: number[] = []
  for (let i = 1; i < dates.length; i++) {
    const a = dates[i - 1], b = dates[i]
    // Both series use the exact same endpoints, never unmatched daily returns.
    x.push(benchmark[b] / benchmark[a] - 1); y.push(closes[b] / closes[a] - 1)
  }
  if (x.length < 60) return null
  const mx = x.reduce((s, n) => s + n, 0) / x.length, my = y.reduce((s, n) => s + n, 0) / y.length
  let xx = 0, yy = 0, xy = 0
  for (let i = 0; i < x.length; i++) { xx += (x[i] - mx) ** 2; yy += (y[i] - my) ** 2; xy += (x[i] - mx) * (y[i] - my) }
  return xx > 0 && yy > 0 ? { beta: xy / xx, correlation: xy / Math.sqrt(xx * yy), observations: x.length, from: dates[0], through: dates.at(-1)! } : null
}
export function protectionEvidence(input: ProtectionInput) {
  const missing: string[] = []
  if ((input.accountCount ?? 1) > 1 || new Set(input.positions.filter((p) => p.shares !== 0).map((p) => p.accountId)).size > 1) missing.push('Select one brokerage account for an actionable review; cross-account collateral offsets are not assumed')
  if (!finite(input.gross) || input.gross <= 0 || !finite(input.debt) || input.debt < 0 || !finite(input.qqqPrice) || input.qqqPrice <= 0) missing.push('Valid portfolio balances and a QQQ price are required')
  for (const p of input.positions) {
    if (p.isOption) {
      if ((!isActiveProtectivePut(p, input.today) || !Number.isSafeInteger(p.shares)) && p.shares !== 0) missing.push(`${p.symbol}: unsupported option exposure`)
      continue
    }
    const r = input.risks[riskKey(p)]
    if (p.shares < 0) missing.push(`${p.symbol}: short exposure requires a separate model`)
    if (!finite(r?.beta) || Math.abs(r.beta) > 8 || !finite(r?.correlation) || Math.abs(r.correlation) > 1 || !r.source?.trim()) missing.push(`${p.symbol}: QQQ beta/correlation missing`)
    if (!finite(r?.maintenancePct) || r.maintenancePct < 0 || r.maintenancePct > 100 || !r?.maintenanceSource?.trim()) missing.push(`${p.symbol}: broker maintenance evidence missing`)
  }
  return missing
}
export function protectionStress(input: ProtectionInput, candidate?: { quote: ProtectionQuote; contracts: number }) {
  const horizon = new Date(Date.parse(`${input.today}T12:00:00Z`) + input.horizonDays * 86400000).toISOString().slice(0, 10)
  const close = candidate ? input.positions.find((p) => p.id === input.closePositionId) : undefined
  const closeQuote = close ? input.quotes.find((q) => q.symbol.replace(/\s/g, '') === close.symbol.replace(/\s/g, '')) : undefined
  const closeCredit = close && closeQuote?.multiplier === 100 ? (closeQuote.bid ?? 0) * 100 * close.shares : 0
  const premium = candidate ? candidate.quote.ask! * 100 * candidate.contracts : 0
  const fees = candidate ? input.feePerContract * (candidate.contracts + (close?.shares ?? 0)) : 0
  const netDebit = premium + fees - closeCredit
  const postDebt = Math.max(0, input.debt + netDebit)
  const excessCredit = Math.max(0, -(input.debt + netDebit))
  const financing = postDebt * input.ratePct / 100 * input.horizonDays / 365
  return PROTECTION_SHOCKS.map((declinePct) => {
    const decline = declinePct / 100, qqq = input.qqqPrice * (1 - decline)
    let loss = 0, putChange = 0, maintenance = 0, unknownMaintenance = false
    const omitted: string[] = []
    for (const p of input.positions) {
      if (p.id === close?.id) continue
      const current = p.shares * p.lastPrice
      if (!p.isOption) {
        const risk = input.risks[riskKey(p)]
        const beta = finite(risk?.beta) ? risk.beta : 1
        // Observed beta already incorporates leverage. Never multiply it twice.
        const stressed = Math.max(0, current * (1 - beta * decline))
        loss += current - stressed
        if (finite(risk?.maintenancePct)) maintenance += stressed * risk.maintenancePct / 100
        else unknownMaintenance = true
      } else if (isActiveProtectivePut(p, input.today)) {
        const underlying = (p.underlying ?? p.symbol.replace(/\s*\d{6}P\d{8}$/, '')).trim().toUpperCase()
        const stock = input.positions.find((s) => !s.isOption && s.symbol.toUpperCase() === underlying)
        const beta = stock ? input.risks[riskKey(stock)]?.beta : underlying === 'QQQ' ? 1 : undefined
        const price = underlying === 'QQQ' ? qqq : stock && finite(beta) ? Math.max(0, stock.lastPrice * (1 - beta * decline)) : undefined
        const payoff = p.expiration! >= horizon && price != null ? Math.max(0, p.strike! - price) * 100 * p.shares : 0
        if (p.expiration! < horizon || price == null) omitted.push(`${p.symbol}: no protection credited at this horizon`)
        putChange += payoff - current
        maintenance += payoff // Conservative: option value is fully funded; no broker offset assumed.
      } else if (p.shares !== 0) omitted.push(`${p.symbol}: option value held fixed; result incomplete`)
    }
    const newPayoff = candidate ? Math.max(0, candidate.quote.strike - qqq) * 100 * candidate.contracts : 0
    const gross = input.gross - loss + putChange - (close ? close.shares * close.lastPrice : 0) + newPayoff + excessCredit
    const debt = postDebt + financing, equity = gross - debt
    maintenance += newPayoff
    const floorGap = Math.max(0, gross * PROTECTION_FLOOR - equity)
    return { declinePct, portfolioLoss: loss, putChange, newPayoff, premium, closeCredit, fees, netDebit, financing,
      gross, debt, equity, equityPct: gross > 0 ? equity / gross * 100 : 0, floorGap,
      maintenanceGap: unknownMaintenance ? null : Math.max(0, maintenance - equity), omitted,
      lossFromToday: input.gross - input.debt - equity }
  })
}
export function protectionEntry(input: ProtectionInput, quote: ProtectionQuote, contracts: number) {
  const close = input.positions.find((p) => p.id === input.closePositionId)
  const old = close ? input.quotes.find((q) => q.symbol.replace(/\s/g,'') === close.symbol.replace(/\s/g,'')) : undefined
  const credit = close && old?.multiplier === 100 ? (old.bid ?? 0) * 100 * close.shares : 0
  const cost = quote.ask! * 100 * contracts + input.feePerContract * (contracts + (close?.shares ?? 0))
  const debt = Math.max(0, input.debt + cost - credit)
  const liquidMark = quote.bid! * 100 * contracts
  const gross = input.gross - (close ? close.shares * close.lastPrice : 0) + liquidMark + Math.max(0, credit - input.debt - cost)
  const equity = gross - debt
  let maintenance = liquidMark, unknown = false
  for (const p of input.positions) {
    if (p.id === close?.id) continue
    if (p.isOption) maintenance += Math.max(0, p.shares * p.lastPrice)
    else { const pct = input.risks[riskKey(p)]?.maintenancePct; if (finite(pct)) maintenance += Math.max(0,p.shares * p.lastPrice) * pct / 100; else unknown = true }
  }
  return { gross, debt, equity, equityPct: gross > 0 ? equity / gross * 100 : 0, floorGap: Math.max(0, gross * PROTECTION_FLOOR - equity), maintenanceGap: unknown ? null : Math.max(0, maintenance - equity) }
}
export function rankPortfolioProtection(input: ProtectionInput) {
  const missing = protectionEvidence(input)
  const fetched = Date.parse(input.quoteFetchedAt ?? '')
  if (!Number.isFinite(fetched) || (input.now ?? Date.now()) - fetched > 5 * 60000 || fetched > (input.now ?? Date.now()) + 60000 || input.delayed !== false) missing.push('Fresh, non-delayed option quotes are required for a recommendation')
  const hold = protectionStress(input)
  const close = input.positions.find((p) => p.id === input.closePositionId)
  if (close && !input.quotes.some((q) => q.symbol.replace(/\s/g, '') === close.symbol.replace(/\s/g, '') && finite(q.bid) && q.bid > 0 && q.multiplier === 100)) missing.push('A current bid and confirmed 100-share closing multiplier are required to compare holding versus rolling')
  const eligible = input.quotes.filter((q) => {
    const dte = (Date.parse(`${q.expiration}T12:00:00Z`) - Date.parse(`${input.today}T12:00:00Z`)) / 86400000
    return finite(q.ask) && q.ask > 0 && finite(q.bid) && q.bid >= 0 && q.bid <= q.ask
      && q.multiplier === 100 && dte >= input.horizonDays && dte <= 365
      && (!close || q.expiration > close.expiration!)
      && putPlanMatchesContract({ optionSymbol: q.symbol, proxy: 'QQQ', strike: q.strike, expiration: q.expiration, contracts: 1, premiumPerShare: q.ask }, input.today)
  })
  const candidates = eligible.flatMap((quote) => {
    let best: { quote: ProtectionQuote; contracts: number; stress: ReturnType<typeof protectionStress>; entry: ReturnType<typeof protectionEntry>; worstGap: number; debit: number; withinBudget: boolean; meetsFloor: boolean; score: number } | null = null
    for (let contracts = 1; contracts <= Math.min(100, input.maxContracts ?? 30); contracts++) {
      const stress = protectionStress(input, { quote, contracts })
      const entry = protectionEntry(input, quote, contracts)
      const worstGap = Math.max(entry.floorGap + (entry.maintenanceGap ?? 0), ...stress.map((s) => s.floorGap + (s.maintenanceGap ?? 0)))
      const debit = stress[0].premium + stress[0].fees
      const withinBudget = debit <= input.budget
      const meetsFloor = entry.floorGap < .01 && (entry.maintenanceGap == null || entry.maintenanceGap < .01) && stress.every((s) => s.floorGap < 0.01 && (s.maintenanceGap == null || s.maintenanceGap < 0.01))
      const spread = (quote.ask! - quote.bid!) / Math.max(0.01, (quote.ask! + quote.bid!) / 2)
      const score = worstGap * 100 + (withinBudget ? 0 : (debit - input.budget) * 10) + debit + stress[0].financing + spread * 100
      const feasible = meetsFloor && withinBudget
      const bestFeasible = best?.meetsFloor && best.withinBudget
      if (!best || (feasible && !bestFeasible) || (feasible === !!bestFeasible && score < best.score)) best = { quote, contracts, stress, entry, worstGap, debit, withinBudget, meetsFloor, score }
    }
    return best ? [best] : []
  }).sort((a, b) => a.score - b.score)
  const holdMeetsFloor = hold.every((s) => s.floorGap < .01 && s.maintenanceGap != null && s.maintenanceGap < .01)
  return { hold, holdMeetsFloor, candidates, missing, ready: missing.length === 0, recommendation: missing.length === 0 && !holdMeetsFloor ? candidates.find((c) => c.meetsFloor && c.withinBudget) ?? null : null }
}

export interface ProtectionAiScenario {
  declinePct: number; equity: number; equityPct: number; floorGap: number
  maintenanceGap: number | null; premium: number; closeCredit: number; fees: number; financing: number
}
export interface ProtectionAiEvidence {
  targetEquityPct: 50; horizonDays: number; ratePct: number; evidenceComplete: boolean
  missingCount: number; quoteFetchedAt: string; hold: ProtectionAiScenario[]
  candidate: { meetsTargets: boolean; withinBudget: boolean; entryEquityPct: number; entryFloorGap: number; action: 'ADD' | 'ROLL'; strike: number; expiration: string; contracts: number; stress: ProtectionAiScenario[] } | null
}
// Send only aggregate comparison values. No account identifiers, raw positions,
// free-text evidence labels, or credentials belong in an AI request.
export function protectionAiEvidence(input: ProtectionInput, balancesConfirmed: boolean): ProtectionAiEvidence {
  const ranking = rankPortfolioProtection(input)
  const scenario = (s: ReturnType<typeof protectionStress>[number]): ProtectionAiScenario => ({declinePct:s.declinePct,equity:s.equity,equityPct:s.equityPct,floorGap:s.floorGap,maintenanceGap:s.maintenanceGap,premium:s.premium,closeCredit:s.closeCredit,fees:s.fees,financing:s.financing})
  const candidate = ranking.recommendation ?? ranking.candidates[0]
  return {targetEquityPct:50,horizonDays:input.horizonDays,ratePct:input.ratePct,evidenceComplete:ranking.ready && balancesConfirmed,missingCount:ranking.missing.length + Number(!balancesConfirmed),quoteFetchedAt:input.quoteFetchedAt ?? '',hold:ranking.hold.map(scenario),candidate:candidate ? {meetsTargets:candidate.meetsFloor,withinBudget:candidate.withinBudget,entryEquityPct:candidate.entry.equityPct,entryFloorGap:candidate.entry.floorGap,action:input.closePositionId?'ROLL':'ADD',strike:candidate.quote.strike,expiration:candidate.quote.expiration,contracts:candidate.contracts,stress:candidate.stress.map(scenario)} : null}
}
