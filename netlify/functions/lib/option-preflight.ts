/* eslint-disable @typescript-eslint/no-explicit-any */
import { API_BASE, MARKET_BASE } from './schwab'
import type { OrderDependencies } from '../schwab-order'
import type { Position } from '../../../src/lib/types'
import { priceRisk, riskKey, type ProtectionInput, type ProtectionQuote } from '../../../src/lib/portfolio-protection'
import { impliedPutVol, simulateSurvival, survivalEvidence, survivalScenarios, type SurvivalStrategy } from '../../../src/lib/margin-survival'

import type { SurvivalPolicy } from '../../../src/lib/survival-policy'

const DAY = 86400000
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
const key = (value: string) => value.replace(/\s+/g, '').toUpperCase()
const funded = (value: unknown) => value === 'FULLY_FUNDED' || value === 'FULL_VALUE' || value === 'full-value'
const contract = (symbol: string) => {
  const match = /^(QQQ)(\d{6})P(\d{8})$/.exec(key(symbol))
  if (!match) return null
  const expiration = `20${match[2].slice(0,2)}-${match[2].slice(2,4)}-${match[2].slice(4,6)}`
  if (!Number.isFinite(Date.parse(`${expiration}T12:00:00Z`)) || new Date(`${expiration}T12:00:00Z`).toISOString().slice(0,10) !== expiration) return null
  return { expiration, strike: Number(match[3])/1000 }
}

// The reviewed user policy supplies assumptions, never broker verification.
// Optional broker extensions (maintenanceRequirement, optionMarginTreatment) must
// actually be present. Standard Schwab responses may omit them; never infer them
// from SMA, buying power, a put's asset type, or a generic maintenance percentage.
export async function optionPreflight(deps: OrderDependencies, hash: string, token: string, order: any, survivalPolicy: SurvivalPolicy) {
  const leg = order.orderLegCollection[0], now = deps.now(), today = new Date(now).toISOString().slice(0,10)
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  const issues: string[] = []
  let account: any = null, quote: any = null
  let heldQuantity: number | null = null
  const positions: Position[] = [], risks: ProtectionInput['risks'] = {}, quotes: ProtectionQuote[] = []
  let modeledRisk: any = null
  const read = async (url: string) => {
    const res = await deps.fetch(url, { headers, cache: 'no-store' })
    if (!res.ok) throw new Error('broker evidence unavailable')
    return res.json()
  }
  const current = (timestamp: unknown) => number(timestamp) != null && now >= (timestamp as number) && now - (timestamp as number) <= 60_000
  try {
    account = (await read(`${API_BASE}/accounts/${encodeURIComponent(hash)}?fields=positions`)).securitiesAccount
    if (!account?.currentBalances || !Array.isArray(account.positions)) throw new Error('incomplete account')
    if (account.positions.length > 80) throw new Error('inventory exceeds execution model limit')
    const matching = account.positions.filter((p: any) => key(String(p.instrument?.symbol ?? '')) === key(leg.instrument.symbol) && p.instrument?.assetType === 'OPTION')
    heldQuantity = matching.reduce((sum: number, p: any) => sum + (number(p.longQuantity) ?? NaN), 0)
    if (!Number.isSafeInteger(heldQuantity) || heldQuantity! < 0 || matching.length > 1) { heldQuantity = null; issues.push('Live contract quantity is unverified.') }
    if (leg.instruction === 'SELL_TO_CLOSE' && (heldQuantity == null || heldQuantity < leg.quantity)) issues.push('Insufficient verified live contracts for this exact close quantity.')
    const seen = new Set<string>()
    for (const raw of account.positions) {
      const symbol = String(raw.instrument?.symbol ?? '').trim().toUpperCase(), long = number(raw.longQuantity), short = number(raw.shortQuantity), value = number(raw.marketValue)
      if (long === 0 && short === 0) continue
      if (long == null || short !== 0 || long <= 0 || value == null || value <= 0 || seen.has(key(symbol))) { issues.push(`${symbol}: invalid, duplicate or unsupported short inventory.`); continue }
      seen.add(key(symbol))
      const isOption = raw.instrument?.assetType === 'OPTION', option = isOption ? contract(symbol) : null
      if ((!isOption && raw.instrument?.assetType !== 'EQUITY') || (isOption && (!option || !Number.isSafeInteger(long)))) { issues.push(`${symbol}: unsupported exposure (execution model supports equities and standard QQQ puts).`); continue }
      const p: Position = { id: key(symbol), accountId: 'selected-account', symbol, name: symbol, shares: long, lastPrice: value/long, prevClose: value/long, avgCost: 0, dividendsReceived: 0, isOption, ...(option ? { ...option, optionType: 'Put', underlying: 'QQQ' } : {}) }
      positions.push(p)
      const requirement = number(raw.maintenanceRequirement)
      if (requirement == null || requirement < 0 || requirement > value) issues.push(`${symbol}: full broker position maintenance requirement unavailable or unsupported.`)
      if (!isOption) {
        if (raw.marginEligible !== true && raw.marginEligible !== false) issues.push(`${symbol}: broker margin eligibility unavailable.`)
        if (raw.marginEligible === false && requirement !== value) issues.push(`${symbol}: non-marginable holding must be fully funded.`)
        risks[riskKey(p)] = { ...(requirement != null ? { maintenancePct: requirement/value*100, maintenanceSource: 'Fresh broker position maintenanceRequirement (includes house adjustments)' } : {}) }
      } else if (!funded(raw.optionMarginTreatment)) issues.push(`${symbol}: explicit broker optionMarginTreatment is missing or unsupported.`)
      else if (requirement == null || Math.abs(requirement-value) > .01) issues.push(`${symbol}: option requirement does not reconcile with explicit full-value treatment.`)
    }
  } catch { account = null; issues.push('Fresh broker balances and positions are unavailable.') }
  const balances = account?.currentBalances
  const maintenanceRequirement = number(balances?.maintenanceRequirement), marginEquity = number(balances?.equity)
  const maintenanceExcess = maintenanceRequirement != null && marginEquity != null ? marginEquity-maintenanceRequirement : null
  if (maintenanceExcess == null) issues.push('Broker maintenance equity or requirement is unavailable; buying power and SMA cannot substitute.')
  else if (maintenanceExcess < 0) issues.push('Current broker maintenance deficiency detected.')
  const rawDebt = number(balances?.marginBalance), cash = number(balances?.cashBalance), nlv = number(balances?.liquidationValue)
  const debt = rawDebt == null ? null : Math.abs(rawDebt)
  const assetValue = positions.reduce((sum,p) => sum+p.shares*p.lastPrice,0)
  const gross = cash != null && cash >= 0 ? assetValue+cash : null
  if (gross == null || debt == null || nlv == null || marginEquity == null || Math.abs(gross-debt-nlv) > 1 || Math.abs(nlv-marginEquity) > 1) issues.push('Live assets, cash, margin debit and broker equity do not reconcile within $1.')
  const totalRequirement = (account?.positions ?? []).filter((p: any) => p.longQuantity !== 0 || p.shortQuantity !== 0).reduce((sum: number,p: any) => sum+(number(p.maintenanceRequirement) ?? NaN),0)
  if (maintenanceRequirement == null || maintenanceRequirement < 0 || !Number.isFinite(totalRequirement) || Math.abs(totalRequirement-maintenanceRequirement) > 1) issues.push('Full position maintenance requirements do not reconcile with the broker account total within $1.')
  const wanted = contract(leg.instrument.symbol)
  if (!wanted || wanted.expiration <= today) issues.push('Order must reference an unexpired standard QQQ put.')
  if ([wanted?.expiration,...positions.filter(p=>p.isOption).map(p=>p.expiration)].some(expiration=>expiration && Date.parse(`${expiration}T12:00:00Z`)-Date.parse(`${today}T12:00:00Z`)>730*DAY)) issues.push('Option expiration exceeds the bounded server simulation limit of 730 days.')
  if (positions.filter(p=>p.isOption).length > 20) issues.push('Option inventory exceeds execution model limit (20).')
  let qqqQuoteTime: number | null = null
  let qqqPrice: number | null = null, candidate: ProtectionQuote | undefined
  try {
    // A compact QQQ chain supplies independent contract metadata. Exact quotes
    // below cover every held contract even when it is outside this chain window.
    const chain = await read(`${MARKET_BASE}/chains?${new URLSearchParams({ symbol: 'QQQ', contractType: 'PUT', strikeCount: '8', includeUnderlyingQuote: 'true', strategy: 'SINGLE' })}`)
    const chainRows: any[] = Object.values(chain.putExpDateMap ?? {}).flatMap((strikes: any) => Object.values(strikes).flat())
    if (chain.isDelayed !== false) issues.push('QQQ option chain is delayed or unverified.')
    const symbols = [...new Set(['QQQ', leg.instrument.symbol, ...positions.filter(p=>p.isOption).map(p=>p.symbol)])]
    const data = await read(`${MARKET_BASE}/quotes?${new URLSearchParams({ symbols: symbols.join(','), fields: 'quote,reference' })}`)
    const entries = new Map(Object.entries(data).map(([symbol,value])=>[key(symbol),value as any]))
    const underlying = entries.get('QQQ')
    qqqPrice = number(underlying?.quote?.lastPrice)
    qqqQuoteTime = number(underlying?.quote?.quoteTime)
    if (!qqqPrice || !current(underlying?.quote?.quoteTime) || underlying?.realtime !== true) issues.push('Fresh real-time QQQ underlying quote unavailable.')
    for (const symbol of symbols.filter(s=>s!=='QQQ')) {
      const entry = entries.get(key(symbol)), q = entry?.quote, parsed = contract(symbol)
      if (key(symbol) === key(leg.instrument.symbol)) quote = q
      if (!q || entry?.realtime !== true || !current(q.quoteTime)) issues.push(`${symbol}: option quote is stale or not verified real-time (60-second limit).`)
      if (number(q?.bidPrice) == null || number(q?.askPrice) == null || q.bidPrice < 0 || q.askPrice <= 0 || q.askPrice < q.bidPrice) { issues.push(`${symbol}: a valid option bid and ask are required.`); continue }
      const chainRow = chainRows.find(row=>key(String(row.symbol??''))===key(symbol))
      const multiplier = number(entry?.reference?.multiplier) ?? number(chainRow?.multiplier)
      if (multiplier !== 100 || entry?.reference?.nonStandard === true || chainRow?.nonStandard === true) issues.push(`${symbol}: standard 100-share multiplier/deliverable is unverified.`)
      if (!parsed) continue
      const item: ProtectionQuote = { symbol, ...parsed, bid: q.bidPrice, ask: q.askPrice, multiplier, quoteTime: number(q.quoteTime) }
      quotes.push(item)
      if (key(symbol)===key(leg.instrument.symbol)) {
        candidate = item
        if (leg.instruction === 'BUY_TO_OPEN' && !funded(entry?.reference?.optionMarginTreatment)) issues.push('Replacement optionMarginTreatment is missing or unsupported; full-value funding cannot be assumed.')
      }
    }
  } catch { issues.push('Fresh broker option quote/QQQ chain is unavailable.') }
  // Avoid unnecessary histories and simulations when inventory or broker rules
  // already fail verification. No client-held inventory or risk flags are used.
  if (!issues.length && account && gross != null && debt != null && qqqPrice && candidate && wanted) {
    try {
      if (!deps.fetchDailyCloses) throw new Error('history provider unavailable')
      const end = deps.now(), start = end-370*DAY, history = new Map<string,Map<string,number>>()
      const symbols = [...new Set(['QQQ',...positions.filter(p=>!p.isOption).map(p=>p.symbol)])]
      for (let i=0;i<symbols.length;i+=4) await Promise.all(symbols.slice(i,i+4).map(async symbol=>{ history.set(symbol,await deps.fetchDailyCloses!(symbol,token,start,end)) }))
      for (const p of positions.filter(p=>!p.isOption)) {
        const closes = history.get(p.symbol)!, benchmark = history.get('QQQ')!
        const exposure = priceRisk(Object.fromEntries(closes),Object.fromEntries(benchmark))
        if (!exposure || Math.abs(exposure.beta)>8 || Date.parse(`${exposure.through}T00:00:00Z`) < end-7*DAY) issues.push(`${p.symbol}: fresh aligned historical priceRisk evidence unavailable (60+ returns, within 7 days).`)
        else Object.assign(risks[riskKey(p)],exposure,{ source: `Server Schwab daily closes ${exposure.from} through ${exposure.through}; price returns, distributions excluded` })
      }
      const policy = survivalPolicy
      const settings = { ...policy.settings, optionMaintenance: 'full-value' as const }
      const input: ProtectionInput = { positions, risks, gross, debt, qqqPrice, today, now, horizonDays: policy.horizonDays, ratePct: policy.ratePct, feePerContract: policy.feePerContract ?? .65, budget: policy.budget, maxContracts: policy.maxContracts, accountCount: 1, quoteFetchedAt: new Date(now).toISOString(), delayed: false, quotes, ...(leg.instruction==='SELL_TO_CLOSE'?{closePositionId:key(leg.instrument.symbol)}:{}) }
      const broker = { maintenanceRequirement, maintenanceExcess, marginEquity, optionMaintenanceVerified: true }
      issues.push(...survivalEvidence(input,settings,broker))
      if (leg.quantity>input.maxContracts!) issues.push(`Order exceeds reviewed contract limit of ${input.maxContracts}.`)
      const years = (Date.parse(`${wanted.expiration}T12:00:00Z`)-Date.parse(`${today}T12:00:00Z`))/DAY/365
      if (impliedPutVol(qqqPrice,wanted.strike,years,(candidate.bid!+candidate.ask!)/2,settings.riskFreeRate)==null) issues.push('Exact order quote cannot be calibrated to the option pricing model.')
      // Simulate the executable leg only. A close receives no credit for an
      // unsubmitted replacement; its entire subsequent unhedged path is tested.
      const strategy: SurvivalStrategy = leg.instruction==='SELL_TO_CLOSE'
        ? { id:'reviewed-close',label:'Exact sell-to-close',closeContracts:leg.quantity }
        : { id:'reviewed-buy',label:'Exact buy-to-open',contracts:leg.quantity,quote:{...candidate,ask:Math.max(candidate.ask!,Number(order.price))} }
      if (leg.instruction==='SELL_TO_CLOSE') candidate.bid = Math.min(candidate.bid!,Number(order.price))
      const premium = leg.quantity*(strategy.quote?.ask??0)*100+leg.quantity*input.feePerContract
      if (leg.instruction==='BUY_TO_OPEN' && premium>input.budget) issues.push(`Order exceeds reviewed purchase budget of $${input.budget} including estimated fees.`)
      if (!issues.length) {
        const expirationDays = [...positions.filter(p=>p.isOption&&p.expiration).map(p=>Math.round((Date.parse(`${p.expiration}T12:00:00Z`)-Date.parse(`${today}T12:00:00Z`))/DAY)),Math.round((Date.parse(`${wanted.expiration}T12:00:00Z`)-Date.parse(`${today}T12:00:00Z`))/DAY)]
        const modelHorizon = Math.max(90,settings.minimumDays,input.horizonDays,...expirationDays)
        const shockDays = [45,60,90,input.horizonDays,modelHorizon,...expirationDays.map(day=>day+1)].filter(day=>day<=modelHorizon)
        const scenarios = survivalScenarios(settings,shockDays).map(scenario=>simulateSurvival(input,strategy,scenario,settings,broker))
        if (scenarios.some(s=>!s.points.length || s.points.some(p=>![p.gross,p.equity,p.debt,p.equityPct,p.maintenanceExcess].every(value=>typeof value==='number' && Number.isFinite(value))))) issues.push('Survival simulation returned incomplete or non-finite risk results.')
        const first = scenarios[0].points[0]
        const minimumExcess = scenarios.every(s=>s.minExcess!=null)?Math.min(...scenarios.map(s=>s.minExcess!)):null
        if (minimumExcess==null || minimumExcess<settings.maintenanceCushion) issues.push(`Modeled maintenance cushion below reviewed minimum of $${settings.maintenanceCushion}.`)
        if (scenarios.some(s=>s.maxDeficiency>.01)) issues.push('Modeled maintenance deficiency during the survival timeline.')
        if (scenarios.some(s=>s.points.some(p=>p.equityPct<settings.floorPct))) issues.push(`Modeled equity below the ${settings.floorPct}% reviewed policy floor.`)
        modeledRisk = { strategy:strategy.id,contracts:strategy.contracts??0,closeContracts:strategy.closeContracts??0,postDebt:first.debt,postEquityPct:first.equityPct,immediateExcess:first.maintenanceExcess,minimumExcess,maximumDeficiency:Math.max(...scenarios.map(s=>s.maxDeficiency)),firstDeficiency:scenarios.map(s=>s.firstDeficiency).filter(Boolean).sort()[0]??null,scenarios:scenarios.map(({id,label,minExcess,maxDeficiency,firstDeficiency,survives,deleveraging})=>({id,label,minExcess,maxDeficiency,firstDeficiency,survives,deleveraging})),policy:{...policy,settings,minimumEquityPct:settings.floorPct,maintenanceCushion:settings.maintenanceCushion},assumptions:{annualInterestPct:input.ratePct,feePerContract:input.feePerContract,monthlyCashFlows:{dividend:settings.monthlyDividend,expense:settings.monthlyExpense,deposit:settings.monthlyDeposit,salary:settings.monthlySalary},scheduledFlows:settings.flows,optionMaintenance:'explicit broker full-value',pricing:'European approximation, managed monetization of intrinsic value at expiration; physical exercise/settlement requires broker handling, not automatic cash settlement or a broker guarantee'} }
      }
    } catch { issues.push('Server survival simulation or fresh historical risk evidence unavailable.') }
  }
  // Histories and scenario calculations must not turn a fresh quote into a stale
  // executable ticket while this request is running.
  if (quotes.some(q=>q.quoteTime == null || deps.now()<q.quoteTime || deps.now()-q.quoteTime>60_000) || (qqqQuoteTime!=null && deps.now()-qqqQuoteTime>60_000) || deps.now()<now || deps.now()-now>60_000) issues.push('Broker evidence became stale during preflight; refresh and review again.')
  return { executable: issues.length===0 && modeledRisk!=null, checkedAt:deps.now(),quantity:leg.quantity,heldQuantity,bid:number(quote?.bidPrice),ask:number(quote?.askPrice),quoteTime:number(quote?.quoteTime),maintenanceRequirement,maintenanceExcess,estimatedPremium:Number(order.price)*leg.quantity*100,issues:[...new Set(issues)],modeledRisk }
}
