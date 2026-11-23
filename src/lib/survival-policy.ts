import type { ScenarioResult, SurvivalSettings } from './margin-survival'

// User assumptions only. Broker inventory, quotes and maintenance verification
// never belong in this object. Store this snapshot with the reviewed ticket.
export interface SurvivalPolicy {
  settings: SurvivalSettings
  ratePct: number
  horizonDays: number
  budget: number
  maxContracts: number
  feePerContract?: number
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const validNumber = (value: unknown, low: number, high: number, integer = false): value is number => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high && (!integer || Number.isSafeInteger(value))
const fail = (): never => { throw new Error('INVALID_SURVIVAL_POLICY') }
function fields(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!object(value) || required.some(key => !Object.hasOwn(value,key)) || Object.keys(value).some(key=>!required.includes(key) && !optional.includes(key))) return fail()
  return value
}

// Reject coercions, unknown fields/authority flags and unbounded work. Return a
// canonical copy so object-key ordering cannot change the preview fingerprint.
export function validateSurvivalPolicy(value: unknown): SurvivalPolicy {
  if (value === undefined) throw new Error('SURVIVAL_POLICY_REQUIRED')
  const p = fields(value, ['settings','ratePct','horizonDays','budget','maxContracts'], ['feePerContract'])
  if (!validNumber(p.ratePct,0,100) || !validNumber(p.horizonDays,1,730,true) || !validNumber(p.budget,0,1e8) || !validNumber(p.maxContracts,1,100,true) || (p.feePerContract!==undefined && !validNumber(p.feePerContract,0,100))) return fail()
  const bounds: Record<string,[number,number,boolean?]> = {
    minimumDays:[0,730,true], maintenanceCushion:[0,1e8], monthlyDividend:[0,1e7],monthlyExpense:[0,1e7],monthlyDeposit:[0,1e7],monthlySalary:[0,1e7],
    riskFreeRate:[-.1,1],volatility:[.001,5],slippagePct:[0,100],closeGapDays:[0,365,true],normalPct:[0,99.99],cautionPct:[0,99.99],floorPct:[.01,99.99],interestBudget:[0,1e8],monteCarloPaths:[0,20,true],seed:[0,4294967295,true],
  }
  const s = fields(p.settings,[...Object.keys(bounds),'optionMaintenance','historicalReturns','flows','riskWeights'])
  for (const [key,[low,high,integer]] of Object.entries(bounds)) if (!validNumber(s[key],low,high,integer)) return fail()
  if (typeof s.optionMaintenance !== 'string' || !['unknown','full-value','zero'].includes(s.optionMaintenance) || (s.normalPct as number)<=(s.cautionPct as number) || (s.cautionPct as number)<=(s.floorPct as number)) return fail()
  if (!Array.isArray(s.historicalReturns) || s.historicalReturns.length>730 || s.historicalReturns.some(n=>!validNumber(n,-.99,10))) return fail()
  if (!Array.isArray(s.flows) || s.flows.length>366) return fail()
  const flows = s.flows.map(value=>{
    const f = fields(value,['day','amount','kind'])
    if (!validNumber(f.day,0,730,true) || !validNumber(f.amount,0,1e8) || typeof f.kind!=='string' || !['deposit','expense','dividend','investment'].includes(f.kind)) return fail()
    return {day:f.day,amount:f.amount,kind:f.kind as SurvivalSettings['flows'][number]['kind']}
  })
  const weights = fields(s.riskWeights,['deficiency','uncovered','financing','cost'])
  if (Object.values(weights).some(n=>!validNumber(n,0,1e6))) return fail()
  const settings = Object.fromEntries(Object.keys(bounds).map(key=>[key,s[key]])) as unknown as SurvivalSettings
  settings.optionMaintenance = s.optionMaintenance as SurvivalSettings['optionMaintenance']
  settings.historicalReturns = [...s.historicalReturns]
  settings.flows = flows
  settings.riskWeights = {deficiency:weights.deficiency as number,uncovered:weights.uncovered as number,financing:weights.financing as number,cost:weights.cost as number}
  return {settings,ratePct:p.ratePct,horizonDays:p.horizonDays,budget:p.budget,maxContracts:p.maxContracts,...(p.feePerContract===undefined?{}:{feePerContract:p.feePerContract})}
}

export interface OrderModeledRisk {
  strategy: string
  contracts: number
  closeContracts: number
  postDebt: number
  postEquityPct: number
  immediateExcess: number | null
  minimumExcess: number | null
  maximumDeficiency: number
  firstDeficiency: string | null
  scenarios: Pick<ScenarioResult, 'id' | 'label' | 'minExcess' | 'maxDeficiency' | 'firstDeficiency' | 'survives' | 'deleveraging'>[]
  policy: SurvivalPolicy & { minimumEquityPct: number; maintenanceCushion: number }
  assumptions: { annualInterestPct: number; feePerContract: number; monthlyCashFlows: { dividend:number;expense:number;deposit:number;salary:number }; scheduledFlows: SurvivalSettings['flows']; optionMaintenance: string; pricing: string }
}
