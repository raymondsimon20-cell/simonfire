import { DEFAULT_SURVIVAL, buildSurvivalReport, simulateSurvival, survivalEvidence, type SurvivalSettings, type SurvivalBroker, type StrategyResult } from './margin-survival'
import type { HedgeRoll, Position } from './types'
import { isActiveProtectivePut, putPlanMatchesContract } from './hedge'
export const PROTECTION_FLOOR = 0.5
export const PROTECTION_SHOCKS = [5, 10, 15, 20, 30, 40] as const
export interface HoldingRisk {
  beta?: number; correlation?: number; leverage?: number; maintenancePct?: number
  source?: string; maintenanceSource?: string
}
export interface ProtectionQuote {
  symbol: string; expiration: string; strike: number; ask: number | null; bid: number | null
  multiplier?: number | null; openInterest?: number | null; volume?: number | null
  quoteTime?: number | null; volatility?: number | null; delta?:number|null; gamma?:number|null; theta?:number|null; vega?:number|null
}
export interface ProtectionInput {
  survivalSettings?: Partial<SurvivalSettings>; broker?: SurvivalBroker
  riskAcknowledged?:boolean; limitOverride?:boolean
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
    if (!finite(r?.maintenancePct) || r.maintenancePct < 0 || r.maintenancePct > 1000 || !r?.maintenanceSource?.trim()) missing.push(`${p.symbol}: broker maintenance evidence missing`)
  }
  return missing
}
export function protectionStress(input: ProtectionInput, candidate?: { quote: ProtectionQuote; contracts: number }) {
  const close = candidate ? input.positions.find(p=>p.id===input.closePositionId) : undefined
  const closing = close ? input.quotes.find(q=>q.symbol.replace(/\s/g,'')===close.symbol.replace(/\s/g,'')) : undefined
  const slippage=(input.survivalSettings?.slippagePct??0)/100
  const premium=candidate?candidate.quote.ask!*100*candidate.contracts*(1+slippage):0
  const closeCredit=close&&closing?.multiplier===100?(closing.bid??0)*100*close.shares*(1-slippage):0
  const fees=candidate?input.feePerContract*(candidate.contracts+(close?.shares??0)):0
  return PROTECTION_SHOCKS.map(declinePct=>{
    const path=simulateSurvival(input,{id:candidate?'candidate':'hold',label:candidate?'Change':'Hold',quote:candidate?.quote,contracts:candidate?.contracts,closeContracts:close?.shares??0},{id:`crash-${declinePct}`,label:`Crash −${declinePct}%`,declinePct,kind:'crash'},input.survivalSettings,input.broker)
    const point=path.points.at(-1)!
    const portfolioLoss=input.positions.filter(p=>!p.isOption).reduce((n,p)=>n+Math.min(p.shares*p.lastPrice,p.shares*p.lastPrice*(input.risks[riskKey(p)]?.beta??1)*declinePct/100),0)
    const floorGap=Math.max(0,...path.points.map(p=>p.gross*(input.survivalSettings?.floorPct??50)/100-p.equity))
    return {declinePct,portfolioLoss,putChange:point.hedgeValue-input.positions.filter(p=>p.isOption&&p.id!==close?.id).reduce((n,p)=>n+p.shares*p.lastPrice,0),newPayoff:candidate?point.hedgeValue:0,premium,closeCredit,fees,netDebit:premium+fees-closeCredit,financing:point.interest,gross:point.gross,debt:point.debt,equity:point.equity,equityPct:point.equityPct,floorGap,maintenanceGap:path.minExcess==null?null:path.maxDeficiency,omitted:path.minExcess==null?['Maintenance evidence incomplete']:[],lossFromToday:input.gross-input.debt-point.equity}
  })
}
function survivalEntry(input:ProtectionInput,result:StrategyResult) {
  const p=result.scenarios[0].points.find(p=>p.phase==='Replacement filled')??result.scenarios[0].points[0]
  return {gross:p.gross,debt:p.debt,equity:p.equity,equityPct:p.equityPct,floorGap:Math.max(0,p.gross*(input.survivalSettings?.floorPct??50)/100-p.equity),maintenanceGap:result.immediateExcess==null?null:Math.max(0,-result.immediateExcess)}
}
export function protectionEntry(input:ProtectionInput,quote:ProtectionQuote,contracts:number) {
  const path=simulateSurvival(input,{id:'entry',label:'Entry',quote,contracts,closeContracts:input.positions.find(p=>p.id===input.closePositionId)?.shares??0},{id:'flat',label:'Unchanged market',declinePct:0,kind:'sideways'},input.survivalSettings,input.broker)
  const p=path.points.find(p=>p.phase==='Replacement filled')??path.points[0]
  return {gross:p.gross,debt:p.debt,equity:p.equity,equityPct:p.equityPct,floorGap:Math.max(0,p.gross*(input.survivalSettings?.floorPct??50)/100-p.equity),maintenanceGap:p.maintenanceExcess==null?null:Math.max(0,-p.maintenanceExcess)}
}
export function rankPortfolioProtection(input: ProtectionInput) {
  const report=buildSurvivalReport(input,input.survivalSettings,input.broker)
  const hold=protectionStress(input)
  const candidates=report.strategies.filter(r=>r.id.startsWith('roll-')).flatMap(r=>{
    const quote=input.quotes.find(q=>r.id.startsWith(`roll-${q.symbol}-`))
    const contracts=Number(r.id.slice(r.id.lastIndexOf('-')+1))
    if(!quote||!Number.isSafeInteger(contracts))return []
    const stress=PROTECTION_SHOCKS.map(declinePct=>{
      const path=r.scenarios.find(p=>p.id===`crash-${declinePct}`)!,point=path.points.at(-1)!
      const fees=r.fees??0,premium=r.hedgeCost-fees,closeCredit=r.hedgeCost-r.netDebit
      return {declinePct,portfolioLoss:0,putChange:0,newPayoff:point.hedgeValue,premium,closeCredit,fees,netDebit:premium+fees-closeCredit,financing:point.interest,gross:point.gross,debt:point.debt,equity:point.equity,equityPct:point.equityPct,floorGap:Math.max(0,...path.points.map(p=>p.gross*(input.survivalSettings?.floorPct??50)/100-p.equity)),maintenanceGap:path.minExcess==null?null:path.maxDeficiency,omitted:[] as string[],lossFromToday:input.gross-input.debt-point.equity}
    })
    const entry=survivalEntry(input,r)
    const worstGap=Math.max(...stress.map(p=>p.floorGap+(p.maintenanceGap??0)))
    return [{quote,contracts,stress,entry,worstGap,debit:r.hedgeCost,withinBudget:r.hedgeCost<=input.budget,meetsFloor:r.qualifies,score:r.maxDeficiency*1e6+worstGap*1e3+r.financing+Math.max(0,r.netDebit),survival:r}]
  }).sort((a,b)=>Number(b.meetsFloor)-Number(a.meetsFloor)||a.score-b.score)
  const holdMeetsFloor=report.strategies[0].qualifies
  const recommended=report.recommended
  const recommendation=recommended?.id.startsWith('roll-')?candidates.find(c=>c.survival.id===recommended.id)??null:null
  return {hold,holdMeetsFloor,candidates,missing:report.missing,ready:report.missing.length===0,recommendation,survival:report}
}

export interface ProtectionAiScenario {
  declinePct: number; equity: number; equityPct: number; floorGap: number
  maintenanceGap: number | null; premium: number; closeCredit: number; fees: number; financing: number
}
export interface ProtectionAiEvidence {
  survival?: {minimumExcess:number|null;maximumDeficiency:number;firstDeficiency:string|null;scenarioCount:number;policy:string}
  userDirected?: boolean
  quoteCurrent?: boolean
  targetEquityPct: number; horizonDays: number; ratePct: number; evidenceComplete: boolean
  missingCount: number; quoteFetchedAt: string; hold: ProtectionAiScenario[]
  candidate: { meetsTargets: boolean; withinBudget: boolean; entryEquityPct: number; entryFloorGap: number; action: 'ADD' | 'ROLL'; strike: number; expiration: string; contracts: number; stress: ProtectionAiScenario[] } | null
}
// Send only aggregate comparison values. No account identifiers, raw positions,
// free-text evidence labels, or credentials belong in an AI request.
export function protectionAiEvidence(input: ProtectionInput, balancesConfirmed: boolean, selection?: {symbol:string;contracts:number}, evaluated?: ReturnType<typeof rankPortfolioProtection>, chosen?: ReturnType<typeof protectionChoice>): ProtectionAiEvidence {
  const ranking = evaluated ?? rankPortfolioProtection(input)
  const scenario = (s: ReturnType<typeof protectionStress>[number]): ProtectionAiScenario => ({declinePct:s.declinePct,equity:s.equity,equityPct:s.equityPct,floorGap:s.floorGap,maintenanceGap:s.maintenanceGap,premium:s.premium,closeCredit:s.closeCredit,fees:s.fees,financing:s.financing})
  const candidate = selection ? chosen ?? protectionChoice(input,selection) : ranking.recommendation ?? ranking.candidates[0]
  const age=(input.now??Date.now())-Date.parse(input.quoteFetchedAt??'')
  const contractAge=candidate?(input.now??Date.now())-(candidate.quote.quoteTime??NaN):0
  return {...(selection ? {userDirected:true} : {}),quoteCurrent:Number.isFinite(age)&&age>=0&&age<=5*60000&&Number.isFinite(contractAge)&&contractAge>=0&&contractAge<=300000&&input.delayed===false,targetEquityPct:input.survivalSettings?.floorPct??50,horizonDays:ranking.survival.strategies[0].scenarios[0].points.at(-1)!.day,survival:{minimumExcess:ranking.survival.strategies[0].minExcess,maximumDeficiency:ranking.survival.strategies[0].maxDeficiency,firstDeficiency:ranking.survival.strategies[0].firstDeficiency,scenarioCount:ranking.survival.strategies[0].scenarios.length,policy:ranking.survival.policy},ratePct:input.ratePct,evidenceComplete:ranking.ready && balancesConfirmed,missingCount:ranking.missing.length + Number(!balancesConfirmed),quoteFetchedAt:input.quoteFetchedAt ?? '',hold:ranking.hold.map(scenario),candidate:candidate ? {meetsTargets:candidate.meetsFloor,withinBudget:candidate.withinBudget,entryEquityPct:candidate.entry.equityPct,entryFloorGap:candidate.entry.floorGap,action:input.closePositionId?'ROLL':'ADD',strike:candidate.quote.strike,expiration:candidate.quote.expiration,contracts:candidate.contracts,stress:candidate.stress.map(scenario)} : null}
}

// Quotes that a user may explicitly choose, independent of model sizing or
// the model's preferred roll window. Contract identity and deliverable still apply.
export function protectionTradeQuotes(input: ProtectionInput) {
  const close=input.positions.find(p=>p.id===input.closePositionId)
  return input.quotes.filter(q=>finite(q.ask)&&q.ask>0&&finite(q.bid)&&q.bid>=0&&q.bid<=q.ask&&q.multiplier===100
    &&q.expiration>input.today&&(!close||q.symbol.replace(/\s/g,'')!==close.symbol.replace(/\s/g,''))
    &&putPlanMatchesContract({optionSymbol:q.symbol,proxy:'QQQ',strike:q.strike,expiration:q.expiration,contracts:1,premiumPerShare:q.ask},input.today))
}
export function protectionChoice(input: ProtectionInput, selection: {symbol:string;contracts:number}) {
  if(!Number.isSafeInteger(selection.contracts)||selection.contracts<1||selection.contracts>100)return null
  const quote=protectionTradeQuotes(input).find(q=>q.symbol===selection.symbol)
  if(!quote)return null
  const report=buildSurvivalReport(input,input.survivalSettings,input.broker,[{id:'manual-choice',label:'Your selected hedge',quote,contracts:selection.contracts,closeContracts:input.positions.find(p=>p.id===input.closePositionId)?.shares??0}])
  const survival=report.strategies.find(r=>r.id==='manual-choice')!
  const stress=protectionStress(input,{quote,contracts:selection.contracts})
  const entry=survivalEntry(input,survival)
  const worstGap=Math.max(survival.maxDeficiency,...survival.scenarios.flatMap(path=>path.points.map(p=>Math.max(0,p.gross*(input.survivalSettings?.floorPct??50)/100-p.equity))))
  return {quote,contracts:selection.contracts,stress,entry,worstGap,debit:survival.hedgeCost,withinBudget:survival.hedgeCost<=input.budget&&selection.contracts<=(input.maxContracts??30),meetsFloor:survival.qualifies,survival}
}

export type ProtectionOrderDraft = Omit<HedgeRoll, 'id' | 'createdAt'>
export function buildProtectionOrderDraft(input: ProtectionInput, selection: {symbol:string;contracts:number}, accountId: string, balancesConfirmed: boolean, mode: 'model' | 'on-demand' = 'model'): ProtectionOrderDraft | null {
  if (!balancesConfirmed || (input.accountCount??1)!==1 || !finite(input.gross) || input.gross<=0 || !finite(input.debt) || input.debt<0 || !accountId || accountId.startsWith('csv:') || input.positions.some(p=>p.shares!==0 && p.accountId!==accountId)) return null
  const close = input.closePositionId ? input.positions.find(p=>p.id===input.closePositionId) : undefined
  if (input.closePositionId && (!close || !isActiveProtectivePut(close,input.today) || close.underlying?.toUpperCase()!=='QQQ' || !Number.isSafeInteger(close.shares) || close.shares<=0)) return null
  const fetched=Date.parse(input.quoteFetchedAt??'')
  const age=(input.now??Date.now())-fetched
  if(!Number.isFinite(age)||age < -60000||age>5*60000||input.delayed!==false)return null
  if(survivalEvidence(input,input.survivalSettings,input.broker).length)return null
  const ranking=mode==='model'?rankPortfolioProtection(input):null
  if(ranking&&(!ranking.ready||ranking.holdMeetsFloor))return null
  const candidate=ranking?ranking.candidates.find(c=>c.quote.symbol===selection.symbol&&c.contracts===selection.contracts):protectionChoice(input,selection)
  if(!candidate||(mode==='model'&&(!candidate.meetsFloor||!candidate.withinBudget)))return null
  const contractAge=(input.now??Date.now())-(candidate.quote.quoteTime??NaN)
  if(!Number.isFinite(contractAge)||contractAge<0||contractAge>300000)return null
  if(mode==='on-demand'&&((!candidate.meetsFloor&&!input.riskAcknowledged)||(!candidate.withinBudget&&!input.limitOverride)))return null
  const closeQuote = close ? input.quotes.find(q=>q.symbol.replace(/\s/g,'')===close.symbol.replace(/\s/g,'')) : undefined
  if (close && (!finite(closeQuote?.bid) || closeQuote.bid<=0 || closeQuote.multiplier!==100)) return null
  return {
    survivalPolicy:{settings:{...DEFAULT_SURVIVAL,...input.survivalSettings,riskWeights:{...DEFAULT_SURVIVAL.riskWeights,...input.survivalSettings?.riskWeights}},ratePct:input.ratePct,horizonDays:input.horizonDays,budget:input.budget,maxContracts:input.maxContracts??30,feePerContract:input.feePerContract},
    proxy:'QQQ',accountId,optionSymbol:candidate.quote.symbol,contracts:candidate.contracts,
    strike:candidate.quote.strike,expiration:candidate.quote.expiration,
    premiumPerShare:candidate.quote.ask!,grossPremium:candidate.stress[0].premium,rollDate:input.today,
    status:'queued',source:mode==='on-demand'?'manual':'planning',previewState:'not_previewed',
    ...(close ? {closeOptionSymbol:close.symbol,closeContracts:close.shares,closeLimitCredit:closeQuote!.bid!,
      closeCostBasis:close.avgCost*close.shares,closeEstimatedValue:close.shares*close.lastPrice,
      closeEstimatedPL:(close.lastPrice-close.avgCost)*close.shares,closePreviewState:'not_previewed' as const} : {}),
  }
}
