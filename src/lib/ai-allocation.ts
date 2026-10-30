import { PROTECTION_SHOCKS, type ProtectionAiEvidence, type ProtectionAiScenario } from './portfolio-protection'
import type { Insights, Position } from './types'
import { bucketOf, BUCKETS } from './buckets'
import { holdingInsight } from './insights'
import { existingProxyPutOffset, isActiveProtectivePut, portfolioPutHedge } from './hedge'

export interface PriceRiskEvidence { asOf: string; observations: number; return3m: number | null; return6m: number | null; return12m: number | null; annualizedVolatility: number | null; maxDrawdown: number | null; largeMoveWarning: boolean }
export interface ProxyRelationship { beta: number | null; correlation: number | null; observations: number }
type Point = { date: string; value: number }
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
function cleanPoints(points: Point[]) { return [...new Map(points.filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value) && p.value > 0).map((p) => [p.date, p])).values()].sort((a, b) => a.date.localeCompare(b.date)) }
export function priceRiskEvidence(input: Point[]): PriceRiskEvidence {
  const points = cleanPoints(input); const end = points.at(-1)
  const returns = points.slice(1).map((p, i) => p.value / points[i].value - 1)
  const historicalReturn = (months: number) => {
    if (!end) return null
    const cutoff = new Date(`${end.date}T12:00:00Z`); cutoff.setUTCMonth(cutoff.getUTCMonth() - months)
    const base = [...points].reverse().find((p) => p.date <= cutoff.toISOString().slice(0, 10))
    return base && points.filter((p) => p.date >= base.date).length >= months * 16 ? end.value / base.value - 1 : null
  }
  let peak = 0; let drawdown = 0
  for (const p of points) { peak = Math.max(peak, p.value); drawdown = Math.min(drawdown, p.value / peak - 1) }
  const avg = returns.length ? mean(returns) : 0
  return { asOf: end?.date ?? '', observations: points.length, return3m: historicalReturn(3), return6m: historicalReturn(6), return12m: historicalReturn(12), annualizedVolatility: returns.length >= 60 ? Math.sqrt(returns.reduce((s, x) => s + (x - avg) ** 2, 0) / (returns.length - 1)) * Math.sqrt(252) : null, maxDrawdown: points.length >= 2 ? drawdown : null, largeMoveWarning: returns.some((r) => Math.abs(r) > .4) }
}
export function proxyRelationship(input: Point[], proxy: Point[]): ProxyRelationship {
  const prices = new Map(cleanPoints(proxy).map((p) => [p.date, p.value]))
  const aligned = cleanPoints(input).filter((p) => prices.has(p.date))
  const n = aligned.length - 1
  if (n < 60) return { beta: null, correlation: null, observations: Math.max(0, n) }
  const xs = aligned.slice(1).map((p, i) => prices.get(p.date)! / prices.get(aligned[i].date)! - 1)
  const ys = aligned.slice(1).map((p, i) => p.value / aligned[i].value - 1)
  const mx = mean(xs); const my = mean(ys)
  const vx = xs.reduce((s, x) => s + (x - mx) ** 2, 0); const vy = ys.reduce((s, y) => s + (y - my) ** 2, 0)
  const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
  return { beta: vx > 0 ? cov / vx : null, correlation: vx > 0 && vy > 0 ? Math.max(-1, Math.min(1, cov / Math.sqrt(vx * vy))) : null, observations: n }
}
export interface AiHedgeContext { proxy: 'QQQ' | 'SPY'; price: number; beta: number; declinePct: number; offsetPct: number; annualBudgetPct: number; strike: number; premium: number; expiration: string; quoteFetchedAt: string; quoteDelayed: boolean; alternatives?: { strike: number; premium: number; expiration: string }[] }
export function isCurrentHedgeQuote(fetchedAt: string, expiration: string, asOf: string, delayed: boolean, now = Date.now()) {
  const age = now - Date.parse(fetchedAt)
  return !delayed && expiration > asOf && Number.isFinite(age) && age >= 0 && age <= 5 * 60000
}
export interface AllocationCandidate { symbol: string; bucket: string; weight: number; distributionYield: number | null; trend: string; trendScore: number | null; risk: PriceRiskEvidence | null; eligible: boolean; evidenceScore: number; gapWeight: number }
export interface AllocationEvidence {
  protectionReview?: ProtectionAiEvidence
  asOf: string; source: 'sample' | 'live' | 'imported'; horizonMonths: 12; monitorMonths: [3, 6]; budget: number; longExposure: number; shortExposure: number; marginDebt: number | null; netEquity: number | null
  candidates: AllocationCandidate[]; targets: { bucket: string; percent: number }[]
  proxies: { symbol: string; beta: number | null; coverage: number }[]
  hedgeAlternatives: { strike: number; premium: number; expiration: string; contracts: number; premiumCost: number; residualLoss: number }[]
  activePuts: { underlying: string; contracts: number; strike: number; expiration: string; value: number }[]
  hedge: (AiHedgeContext & { contracts: number; premiumCost: number; modeledLoss: number; netOffset: number; residualLoss: number; monthlyBudget: number; quoteCurrent: boolean; existingOffset: number }) | null
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
export function buildAllocationEvidence(positions: Position[], insights: Insights | undefined, target: Record<string, number>, budget: number, asOf: string, source: AllocationEvidence['source'] = 'live', hedge?: AiHedgeContext | null, balances?: { marginDebt: number; netEquity: number }, now = Date.now()): AllocationEvidence {
  const holdings = positions.filter((p) => !p.isOption && p.shares > 0 && finite(p.lastPrice) && p.lastPrice > 0)
  const exposure = holdings.reduce((s, p) => s + p.shares * p.lastPrice, 0)
  const values = new Map<string, number>(); const first = new Map<string, Position>()
  for (const p of holdings) { values.set(p.symbol, (values.get(p.symbol) ?? 0) + p.shares * p.lastPrice); if (!first.has(p.symbol)) first.set(p.symbol, p) }
  const age = Date.parse(asOf) - Date.parse(insights?.generatedAt ?? '')
  const fresh = finite(age) && age >= -86400000 && age <= 7 * 86400000
  const candidates = [...values].map(([symbol, value]) => {
    const p = first.get(symbol)!; const snapshot = insights?.bySymbol[symbol]; const trend = holdingInsight(p, snapshot)
    const risk = snapshot?.risk ?? null; const riskAge = Date.parse(asOf) - Date.parse(risk?.asOf ?? '')
    const eligible = fresh && riskAge >= 0 && riskAge <= 7 * 86400000 && risk?.return12m != null && risk.annualizedVolatility != null && !risk.largeMoveWarning && trend?.available === 3 && ['strong', 'healthy'].includes(trend.signal)
    const weight = exposure ? value / exposure : 0; const bucket = bucketOf(p)
    const bucketValue = holdings.filter((r) => bucketOf(r) === bucket).reduce((s, r) => s + r.shares * r.lastPrice, 0)
    const distribution = holdings.find((r) => r.symbol === symbol && finite(r.annualDividend) && r.annualDividend >= 0)?.annualDividend
    return { symbol, bucket, weight, distributionYield: distribution == null ? null : distribution / p.lastPrice, trend: fresh ? trend?.signal ?? 'missing' : 'stale', trendScore: fresh ? trend?.score ?? null : null, risk, eligible, evidenceScore: eligible ? Math.round(Math.max(0, Math.min(100, (trend?.score ?? 0) - (risk?.annualizedVolatility ?? 0) * 20 - Math.abs(risk?.maxDrawdown ?? 0) * 30 - Math.max(0, weight - .1) * 50))) : 0, gapWeight: (target[bucket] ?? 0) / 100 - (exposure ? bucketValue / exposure : 0) }
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.evidenceScore - a.evidenceScore || a.symbol.localeCompare(b.symbol)).slice(0, 100)
  const proxies = ['QQQ', 'SPY'].map((symbol) => {
    let covered = 0; let beta = 0
    for (const p of holdings) { const rel = insights?.bySymbol[p.symbol]?.proxies?.[symbol]; const w = exposure ? p.shares * p.lastPrice / exposure : 0; if (fresh && rel && finite(rel.beta) && rel.observations >= 60) { covered += w; beta += w * rel.beta } }
    return { symbol, coverage: covered, beta: covered >= .8 ? beta / covered : null }
  })
  const activePuts = positions.filter((p) => isActiveProtectivePut(p, asOf)).map((p) => ({ underlying: p.underlying ?? p.symbol.replace(/\s*\d{6}P\d{8}$/, ''), contracts: p.shares, strike: p.strike!, expiration: p.expiration!, value: p.shares * p.lastPrice }))
  const plan = hedge ? portfolioPutHedge({ existingOffset: existingProxyPutOffset(positions, hedge!.proxy, hedge!.price * (1 - hedge!.declinePct / 100), hedge!.expiration || asOf), longExposure: exposure, qqqPrice: hedge.price, portfolioQqqBeta: hedge.beta, targetQqqDeclinePct: hedge.declinePct, lossOffsetPct: hedge.offsetPct, strikePrice: hedge.strike, premiumPerShare: hedge.premium, annualPremiumBudgetPct: hedge.annualBudgetPct }) : null
  const hedgeAlternatives = hedge ? (hedge.alternatives ?? []).slice(0, 3).map((q) => {
    const alternative = portfolioPutHedge({ longExposure: exposure, qqqPrice: hedge.price, portfolioQqqBeta: hedge.beta, targetQqqDeclinePct: hedge.declinePct, lossOffsetPct: hedge.offsetPct, strikePrice: q.strike, premiumPerShare: q.premium, annualPremiumBudgetPct: hedge.annualBudgetPct, existingOffset: existingProxyPutOffset(positions, hedge.proxy, hedge.price * (1 - hedge.declinePct / 100), q.expiration) })
    return { strike: q.strike, premium: q.premium, expiration: q.expiration, contracts: alternative.contracts, premiumCost: alternative.grossPremium, residualLoss: alternative.residualLoss }
  }) : []
  return { asOf, source, horizonMonths: 12, monitorMonths: [3, 6], budget: Math.max(0, budget), longExposure: exposure, shortExposure: positions.filter((p) => !p.isOption && p.shares < 0 && finite(p.lastPrice)).reduce((sum, p) => sum + Math.abs(p.shares * p.lastPrice), 0), marginDebt: balances?.marginDebt ?? null, netEquity: balances?.netEquity ?? null, candidates, hedgeAlternatives, targets: BUCKETS.map((bucket) => ({ bucket, percent: target[bucket] ?? 0 })), proxies, activePuts, hedge: hedge && plan ? { ...hedge, contracts: plan.contracts, premiumCost: plan.grossPremium, modeledLoss: plan.modeledPortfolioLoss, netOffset: plan.modeledNetOffset, residualLoss: plan.residualLoss, monthlyBudget: plan.monthlyGrossDebitBudget, existingOffset: plan.existingOffset, quoteCurrent: isCurrentHedgeQuote(hedge.quoteFetchedAt, hedge.expiration, asOf, hedge.quoteDelayed, now) } : null }
}
export interface AllocationReview { summary: string; candidates: { symbol: string; reason: string; risk: string }[]; protection: string; checks3m: string[]; checks6m: string[]; limitations: string[] }
export function validateAllocationEvidence(raw: unknown): AllocationEvidence {
  if (!raw || typeof raw !== 'object') throw new Error('invalid_evidence')
  const r = raw as AllocationEvidence
  const bounded = (x: unknown, min: number, max: number) => finite(x) && x >= min && x <= max
  const text = (s: unknown, max: number) => typeof s === 'string' && s.length <= max
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.asOf) || !['sample', 'live', 'imported'].includes(r.source) || r.horizonMonths !== 12 || JSON.stringify(r.monitorMonths) !== '[3,6]' || !bounded(r.budget, 0, 1e10) || !bounded(r.longExposure, 0, 1e12) || !bounded(r.shortExposure, 0, 1e12) || !(r.marginDebt === null || bounded(r.marginDebt, 0, 1e12)) || !(r.netEquity === null || bounded(r.netEquity, -1e12, 1e12)) || !Array.isArray(r.candidates) || r.candidates.length > 100 || !Array.isArray(r.activePuts) || r.activePuts.length > 100 || !Array.isArray(r.hedgeAlternatives) || r.hedgeAlternatives.length > 3 || !Array.isArray(r.targets) || r.targets.length !== 4 || !Array.isArray(r.proxies) || r.proxies.length !== 2) throw new Error('invalid_evidence')
  const candidates = r.candidates.map((c) => {
    if (!c || !/^[A-Z0-9./-]{1,20}$/.test(c.symbol) || !BUCKETS.includes(c.bucket as typeof BUCKETS[number]) || !bounded(c.weight, 0, 1.00001) || !(c.distributionYield === null || bounded(c.distributionYield, 0, 100)) || !['strong', 'healthy', 'neutral', 'caution', 'weak', 'missing', 'stale'].includes(c.trend) || !(c.trendScore === null || bounded(c.trendScore, -100, 100)) || typeof c.eligible !== 'boolean' || !bounded(c.evidenceScore, 0, 100) || !bounded(c.gapWeight, -1, 1)) throw new Error('invalid_candidate')
    let risk: PriceRiskEvidence | null = null
    if (c.risk) { const k = c.risk; if (!text(k.asOf, 10) || typeof k.largeMoveWarning !== 'boolean' || !bounded(k.observations, 0, 1e5) || ![k.return3m, k.return6m, k.return12m].every((v) => v === null || bounded(v, -1, 1e6)) || !(k.annualizedVolatility === null || bounded(k.annualizedVolatility, 0, 1e4)) || !(k.maxDrawdown === null || bounded(k.maxDrawdown, -1, 0))) throw new Error('invalid_risk'); risk = { asOf: k.asOf, observations: k.observations, return3m: k.return3m, return6m: k.return6m, return12m: k.return12m, annualizedVolatility: k.annualizedVolatility, maxDrawdown: k.maxDrawdown, largeMoveWarning: k.largeMoveWarning } }
    const riskAge = Date.parse(r.asOf) - Date.parse(risk?.asOf ?? '')
    if (c.eligible && (!risk || risk.largeMoveWarning || risk.return12m === null || risk.annualizedVolatility === null || riskAge < 0 || riskAge > 7 * 86400000 || !Number.isFinite(riskAge) || !['strong', 'healthy'].includes(c.trend))) throw new Error('invalid_eligibility')
    return { symbol: c.symbol, bucket: c.bucket, weight: c.weight, distributionYield: c.distributionYield, trend: c.trend, trendScore: c.trendScore, risk, eligible: c.eligible, evidenceScore: c.evidenceScore, gapWeight: c.gapWeight }
  })
  if (new Set(candidates.map((c) => c.symbol)).size !== candidates.length) throw new Error('duplicate_symbol')
  const targets = r.targets.map((t) => { if (!BUCKETS.includes(t.bucket as typeof BUCKETS[number]) || !bounded(t.percent, 0, 100)) throw new Error('invalid_targets'); return { bucket: t.bucket, percent: t.percent } })
  const proxies = r.proxies.map((p) => { if (!['QQQ', 'SPY'].includes(p.symbol) || !bounded(p.coverage, 0, 1.00001) || !(p.beta === null || bounded(p.beta, -20, 20))) throw new Error('invalid_proxy'); return { symbol: p.symbol, coverage: p.coverage, beta: p.beta } })
  const activePuts = r.activePuts.map((p) => { if (!/^[A-Z0-9./-]{1,20}$/.test(p.underlying) || !bounded(p.contracts, 0, 10000) || !bounded(p.strike, 0, 1e7) || !text(p.expiration, 10) || !bounded(p.value, 0, 1e10)) throw new Error('invalid_put'); return { underlying: p.underlying, contracts: p.contracts, strike: p.strike, expiration: p.expiration, value: p.value } })
  let hedge: AllocationEvidence['hedge'] = null
  if (r.hedge) { const h = r.hedge; if (!['QQQ', 'SPY'].includes(h.proxy) || !bounded(h.price, 0, 1e7) || !bounded(h.beta, 0, 3) || !bounded(h.declinePct, 1, 90) || !bounded(h.offsetPct, 1, 100) || !bounded(h.annualBudgetPct, 0, 20) || !bounded(h.strike, 0, 1e7) || !bounded(h.premium, 0, 1e7) || !text(h.expiration, 10) || !text(h.quoteFetchedAt, 40) || typeof h.quoteDelayed !== 'boolean') throw new Error('invalid_hedge'); const plan = portfolioPutHedge({ existingOffset: activePuts.filter((p) => p.underlying === h.proxy && p.expiration >= h.expiration).reduce((sum, p) => sum + p.contracts * 100 * Math.max(0, p.strike - h.price * (1 - h.declinePct / 100)) - p.value, 0), longExposure: r.longExposure, qqqPrice: h.price, portfolioQqqBeta: h.beta, targetQqqDeclinePct: h.declinePct, lossOffsetPct: h.offsetPct, strikePrice: h.strike, premiumPerShare: h.premium, annualPremiumBudgetPct: h.annualBudgetPct }); hedge = { proxy: h.proxy, price: h.price, beta: h.beta, declinePct: h.declinePct, offsetPct: h.offsetPct, annualBudgetPct: h.annualBudgetPct, strike: h.strike, premium: h.premium, expiration: h.expiration, quoteFetchedAt: h.quoteFetchedAt, quoteDelayed: h.quoteDelayed, contracts: plan.contracts, premiumCost: plan.grossPremium, modeledLoss: plan.modeledPortfolioLoss, netOffset: plan.modeledNetOffset, residualLoss: plan.residualLoss, monthlyBudget: plan.monthlyGrossDebitBudget, existingOffset: plan.existingOffset, quoteCurrent: isCurrentHedgeQuote(h.quoteFetchedAt, h.expiration, r.asOf, h.quoteDelayed) } }
  const hedgeAlternatives = r.hedgeAlternatives.map((q) => {
    if (!hedge || !bounded(q.strike, .001, 1e7) || !bounded(q.premium, .001, 1e7) || !/^\d{4}-\d{2}-\d{2}$/.test(q.expiration) || q.expiration <= r.asOf) throw new Error('invalid_alternative')
    const h = hedge
    const p = portfolioPutHedge({ longExposure: r.longExposure, qqqPrice: h.price, portfolioQqqBeta: h.beta, targetQqqDeclinePct: h.declinePct, lossOffsetPct: h.offsetPct, strikePrice: q.strike, premiumPerShare: q.premium, annualPremiumBudgetPct: h.annualBudgetPct, existingOffset: activePuts.filter((put) => put.underlying === h.proxy && put.expiration >= q.expiration).reduce((sum, put) => sum + put.contracts * 100 * Math.max(0, put.strike - h.price * (1 - h.declinePct / 100)) - put.value, 0) })
    return { strike: q.strike, premium: q.premium, expiration: q.expiration, contracts: p.contracts, premiumCost: p.grossPremium, residualLoss: p.residualLoss }
  })
  let protectionReview: ProtectionAiEvidence | undefined
  if (r.protectionReview != null) {
    const p = r.protectionReview
    const scenarios = (rows: ProtectionAiScenario[]) => {
      if (!Array.isArray(rows) || rows.length !== 4) throw new Error('invalid_protection_scenarios')
      return rows.map((v,i) => {
        if (!v || v.declinePct !== PROTECTION_SHOCKS[i] || !bounded(v.equity,-1e12,1e12) || !bounded(v.equityPct,-1e9,1e9) || !bounded(v.floorGap,0,1e12) || !(v.maintenanceGap === null || bounded(v.maintenanceGap,0,1e12)) || ![v.premium,v.closeCredit,v.fees,v.financing].every(n=>bounded(n,0,1e12))) throw new Error('invalid_protection_scenario')
        return {declinePct:v.declinePct,equity:v.equity,equityPct:v.equityPct,floorGap:v.floorGap,maintenanceGap:v.maintenanceGap,premium:v.premium,closeCredit:v.closeCredit,fees:v.fees,financing:v.financing}
      })
    }
    if (p.targetEquityPct !== 50 || !bounded(p.horizonDays,30,180) || !bounded(p.ratePct,0,50) || typeof p.evidenceComplete !== 'boolean' || !Number.isSafeInteger(p.missingCount) || !bounded(p.missingCount,0,1000) || !text(p.quoteFetchedAt,40)) throw new Error('invalid_protection_review')
    let candidate: ProtectionAiEvidence['candidate'] = null
    if(p.candidate) {
      const c=p.candidate
      if (typeof c.meetsTargets !== 'boolean' || typeof c.withinBudget !== 'boolean' || !bounded(c.entryEquityPct,-1e9,1e9) || !bounded(c.entryFloorGap,0,1e12) || !['ADD','ROLL'].includes(c.action) || !bounded(c.strike,.001,1e7) || !/^\d{4}-\d{2}-\d{2}$/.test(c.expiration) || !Number.isSafeInteger(c.contracts) || !bounded(c.contracts,1,100)) throw new Error('invalid_protection_candidate')
      candidate={meetsTargets:c.meetsTargets,withinBudget:c.withinBudget,entryEquityPct:c.entryEquityPct,entryFloorGap:c.entryFloorGap,action:c.action,strike:c.strike,expiration:c.expiration,contracts:c.contracts,stress:scenarios(c.stress)}
    }
    const age = Date.now()-Date.parse(p.quoteFetchedAt)
    protectionReview={targetEquityPct:50,horizonDays:p.horizonDays,ratePct:p.ratePct,evidenceComplete:p.evidenceComplete && p.missingCount===0 && age>=0 && age<=300000,missingCount:p.missingCount,quoteFetchedAt:p.quoteFetchedAt,hold:scenarios(p.hold),candidate}
  }
  return { ...(protectionReview ? {protectionReview} : {}), asOf: r.asOf, source: r.source, horizonMonths: 12, monitorMonths: [3, 6], budget: r.budget, longExposure: r.longExposure, shortExposure: r.shortExposure, marginDebt: r.marginDebt, netEquity: r.netEquity, candidates, hedgeAlternatives, targets, proxies, activePuts, hedge }
}
export function validateAllocationReview(raw: unknown, evidence: AllocationEvidence): AllocationReview {
  const r = raw as AllocationReview; const text = (x: unknown) => typeof x === 'string' && x.trim().length > 0 && x.length <= 1500
  const list = (x: unknown) => Array.isArray(x) && x.length >= 1 && x.length <= 8 && x.every(text)
  if (!r || !text(r.summary) || !text(r.protection) || !list(r.checks3m) || !list(r.checks6m) || !list(r.limitations) || !Array.isArray(r.candidates) || r.candidates.length > 5) throw new Error('invalid_review')
  const seen = new Set<string>()
  const candidates = r.candidates.map((c) => { if (!c || !text(c.reason) || !text(c.risk) || seen.has(c.symbol) || !evidence.candidates.some((e) => e.symbol === c.symbol && e.eligible)) throw new Error('invalid_shortlist'); seen.add(c.symbol); return { symbol: c.symbol, reason: c.reason, risk: c.risk } })
  return { summary: r.summary, protection: r.protection, candidates, checks3m: [...r.checks3m], checks6m: [...r.checks6m], limitations: [...r.limitations] }
}
export function filterAllocationShortlist<T extends { symbol: string }>(orders: T[], symbols: string[] | null): T[] { return symbols === null ? orders : orders.filter((o) => symbols.includes(o.symbol)) }

export function allocationShortlistIsCurrent(selection: { key: string; expiresAt: number } | null, evidenceKey: string, now: number) {
  return !!selection && selection.key === evidenceKey && selection.expiresAt > now
}
