import type { ProtectionInput, ProtectionQuote } from './portfolio-protection'

export interface SurvivalSettings {
  minimumDays:number; maintenanceCushion:number; optionMaintenance:'unknown'|'full-value'|'zero'
  monthlyDividend:number; monthlyExpense:number; monthlyDeposit:number; monthlySalary:number
  riskFreeRate:number; volatility:number; slippagePct:number; closeGapDays:number
  normalPct:number; cautionPct:number; floorPct:number; interestBudget:number
  monteCarloPaths:number; seed:number; historicalReturns:number[]
  flows:{day:number;amount:number;kind:'deposit'|'expense'|'dividend'|'investment'}[]
  riskWeights:{deficiency:number;uncovered:number;financing:number;cost:number}
}
export const DEFAULT_SURVIVAL:SurvivalSettings={minimumDays:90,maintenanceCushion:5000,optionMaintenance:'unknown',monthlyDividend:0,monthlyExpense:0,monthlyDeposit:0,monthlySalary:0,riskFreeRate:.04,volatility:.3,slippagePct:0,closeGapDays:1,normalPct:60,cautionPct:55,floorPct:50,interestBudget:1000,monteCarloPaths:0,seed:417,historicalReturns:[],flows:[],riskWeights:{deficiency:1,uncovered:1,financing:1,cost:1}}
export interface SurvivalBroker {
  maintenanceRequirement?:number|null; maintenanceExcess?:number|null; marginEquity?:number|null
  initialMargin?:number|null; sma?:number|null; buyingPower?:number|null; withdrawable?:number|null
  optionMaintenanceVerified?:boolean
}
export interface SurvivalPoint {day:number;date:string;gross:number;equity:number;debt:number;equityPct:number;maintenance:number|null;maintenanceExcess:number|null;hedgeValue:number;intrinsic:number;timeValue:number;interest:number;coverage:number;liquidity:number|null;forcedLiquidation:number|null;brokerEquity:number|null;phase?:string}
export interface SurvivalScenario {id:string;label:string;declinePct:number;kind:'gradual'|'crash'|'rebound'|'sideways'|'volatility'|'correlation'|'historical'|'monte-carlo';volatilityMultiplier?:number;maintenanceIncrease?:number;dividendFactor?:number;returns?:number[];shockDay?:number}
export interface SurvivalStrategy {id:string;label:string;closeContracts?:number;quote?:ProtectionQuote;contracts?:number;saleAmount?:number;deposit?:number}
export interface ScenarioResult {id:string;label:string;declinePct:number;minExcess:number|null;maxDeficiency:number;firstDeficiency:string|null;survives:boolean;points:SurvivalPoint[];deleveraging:number|null}
export interface StrategyResult {id:string;label:string;netDebit:number;postDebt:number;postEquityPct:number;immediateExcess:number|null;minExcess:number|null;maxDeficiency:number;firstDeficiency:string|null;financing:number;hedgeCost:number;coverageDays:number;qualifies:boolean;failures:string[];scenarios:ScenarioResult[];deleveraging:number|null;trade?:{symbol:string;contracts:number};executionGapDays?:number;fees?:number}
export interface SurvivalReport {strategies:StrategyResult[];recommended:StrategyResult|null;missing:string[];alerts:{id:string;message:string;severity:'info'|'warning'|'danger'}[];policy:'NORMAL'|'CAUTION'|'DEFENSIVE'|'CRITICAL'|'EMERGENCY';cashTargets:{target:number;cash:number}[];brokerMaintenanceExcess:number|null;currentEquityPct:number;currentDebt:number;dailyInterest:number;monthlyInterest:number;hedgeValue:number;daysToExpiration:number|null;coverage:number;explanation:string}
const DAY=86400000
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)
const dateMs=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(`${s}T12:00:00Z`))&&new Date(`${s}T12:00:00Z`).toISOString().slice(0,10)===s?Date.parse(`${s}T12:00:00Z`):NaN
const dte=(expiration:string,today:string)=>Math.round((dateMs(expiration)-dateMs(today))/DAY)
const key=(p:ProtectionInput['positions'][number])=>`${p.accountId}|${p.symbol.trim().toUpperCase()}`
const same=(a:string,b:string)=>a.replace(/\s/g,'').toUpperCase()===b.replace(/\s/g,'').toUpperCase()
const bounded=(n:unknown,fallback:number,lo:number,hi:number)=>finite(n)?Math.max(lo,Math.min(hi,n)):fallback
const settingsFor=(partial:Partial<SurvivalSettings>):SurvivalSettings=>{
  const s={...DEFAULT_SURVIVAL,...partial,riskWeights:{...DEFAULT_SURVIVAL.riskWeights,...partial.riskWeights}}
  s.minimumDays=Math.floor(bounded(s.minimumDays,90,0,36500))
  s.closeGapDays=Math.floor(bounded(s.closeGapDays,1,0,365))
  s.slippagePct=bounded(s.slippagePct,0,0,100)
  s.volatility=bounded(s.volatility,.3,.001,5)
  s.riskFreeRate=bounded(s.riskFreeRate,.04,-.1,1)
  for(const field of ['maintenanceCushion','monthlyDividend','monthlyExpense','monthlyDeposit','monthlySalary','interestBudget'] as const)s[field]=bounded(s[field],DEFAULT_SURVIVAL[field],0,1e12)
  s.monteCarloPaths=Math.floor(bounded(s.monteCarloPaths,0,0,100))
  s.flows=(Array.isArray(s.flows)?s.flows:[]).filter(f=>Number.isSafeInteger(f.day)&&f.day>=0&&finite(f.amount)&&f.amount>=0&&['deposit','expense','dividend','investment'].includes(f.kind))
  s.historicalReturns=(Array.isArray(s.historicalReturns)?s.historicalReturns:[]).map(n=>bounded(n,0,-.99,10))
  for(const field of ['deficiency','uncovered','financing','cost'] as const)s.riskWeights[field]=bounded(s.riskWeights[field],DEFAULT_SURVIVAL.riskWeights[field],0,1e6)
  return s
}
const policyValid=(s:SurvivalSettings)=>[s.normalPct,s.cautionPct,s.floorPct].every(finite)&&s.normalPct<100&&s.normalPct>s.cautionPct&&s.cautionPct>s.floorPct&&s.floorPct>0
function contractIdentity(q:ProtectionQuote) {
  const match=/^QQQ(\d{6})P(\d{8})$/.exec(q.symbol.replace(/\s/g,'').toUpperCase())
  return !!match&&finite(dateMs(q.expiration))&&q.expiration===`20${match[1].slice(0,2)}-${match[1].slice(2,4)}-${match[1].slice(4,6)}`&&finite(q.strike)&&q.strike>0&&Number(match[2])/1000===q.strike
}
function quoteIssues(q:ProtectionQuote,input:ProtectionInput):string[] {
  const issues:string[]=[]
  if(!finite(input.qqqPrice)||input.qqqPrice<=0)issues.push('Valid QQQ underlying price required for option valuation')
  if(!contractIdentity(q)||dte(q.expiration,input.today)<=0)issues.push('Contract must be an active exact QQQ put with matching strike and expiration')
  if(q.multiplier!==100||!finite(q.bid)||!finite(q.ask)||q.bid<0||q.ask<=0||q.ask<q.bid)issues.push('Contract bid/ask or standard multiplier unverified')
  const age=finite(q.quoteTime)?(input.now??Date.now())-q.quoteTime:NaN
  const chainAge=(input.now??Date.now())-Date.parse(input.quoteFetchedAt??'')
  if(!finite(age)||age<0||age>300000||!finite(chainAge)||chainAge<0||chainAge>300000||input.delayed!==false)issues.push('Fresh non-delayed contract quote timestamp required; contract quote is stale or missing')
  return issues
}
function sharedHorizon(input:ProtectionInput,s:SurvivalSettings,extras:ProtectionQuote[]=[]) {
  const days=[90,s.minimumDays,input.horizonDays,...input.positions.filter(p=>p.isOption&&p.expiration).map(p=>dte(p.expiration!,input.today)),...[...input.quotes,...extras].filter(contractIdentity).map(q=>dte(q.expiration,input.today))].filter(finite)
  const horizon=Math.ceil(Math.max(...days))
  if(horizon>36500)throw new Error('Simulation date horizon exceeds 100 years')
  return horizon
}
function cdf(x:number) {const t=1/(1+.2316419*Math.abs(x)),d=.3989422804014327*Math.exp(-x*x/2);const p=1-d*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x>=0?p:1-p}
// European Black–Scholes approximation. American exercise, dividends and dealer
// marks differ: anchor to today's midpoint; never describe it as a broker mark.
export function putValue(spot:number,strike:number,years:number,vol:number,rate:number) {
  if(years<=0)return Math.max(0,strike-spot)
  if(spot<=0)return strike
  const sigma=Math.max(.001,vol),t=Math.sqrt(years),d1=(Math.log(spot/strike)+(rate+sigma*sigma/2)*years)/(sigma*t),d2=d1-sigma*t
  return Math.max(Math.max(0,strike-spot),strike*Math.exp(-rate*years)*cdf(-d2)-spot*cdf(-d1))
}
export function impliedPutVol(spot:number,strike:number,years:number,mid:number,rate:number) {
  if(years<=0||mid<Math.max(0,strike-spot)-.01||mid>=strike)return null
  let lo=.001,hi=5
  if(putValue(spot,strike,years,hi,rate)<mid)return null
  for(let i=0;i<35;i++){const v=(lo+hi)/2;if(putValue(spot,strike,years,v,rate)<mid)lo=v;else hi=v}
  const v=(lo+hi)/2
  return Math.abs(putValue(spot,strike,years,v,rate)-mid)<=Math.max(.05,mid*.01)?v:null
}
export function cashToEquity(gross:number,debt:number,target:number) {
  if(!finite(gross)||gross<0||!finite(debt)||debt<0||!finite(target)||target<=0||target>=1)return 0
  // A deposit repays debt first. At zero assets this is the amount to clear
  // insolvency; a positive remaining balance is needed for a defined ratio.
  return Math.max(0,debt-(1-target)*gross)
}
export function policyState(equityPct:number,excess:number|null,cushion:number,modeledDeficiency:boolean,partial:Partial<SurvivalSettings>={}):SurvivalReport['policy'] {
  const supplied=settingsFor(partial),s=policyValid(supplied)?supplied:DEFAULT_SURVIVAL
  if((excess!=null&&excess<0)||modeledDeficiency)return 'EMERGENCY'
  if(equityPct<s.floorPct||(excess!=null&&excess<cushion))return 'CRITICAL'
  return equityPct<s.cautionPct?'DEFENSIVE':equityPct<=s.normalPct?'CAUTION':'NORMAL'
}
function priceFactor(s:SurvivalScenario,day:number,horizon:number) {
  const shock=s.declinePct/100
  if(s.returns){let f=1;for(let i=0;i<day;i++)f*=Math.max(.01,1+(s.returns[i]??0));return f}
  if(s.kind==='sideways'||s.kind==='volatility')return 1
  if(s.kind==='crash')return day<Math.max(1,Math.floor(bounded(s.shockDay,1,1,36500)))?1:Math.max(0,1-shock)
  if(s.kind==='rebound')return day===0?1:day<=5?1-shock*day/5:1-shock*Math.max(0,1-(day-5)/Math.max(1,horizon-5))
  return 1-shock*Math.min(1,day/30)
}
function cashFlow(amount:number,state:{cash:number;debt:number}) {
  if(amount>=0){const repay=Math.min(state.debt,amount);state.debt-=repay;state.cash+=amount-repay}
  else{const use=Math.min(state.cash,-amount);state.cash-=use;state.debt+=-amount-use}
}
interface ModelOption {symbol:string;strike:number;expiration:string;contracts:number;spot:number;beta:number;vol:number;spread:number;initial:number;settled:boolean;starts:number}
export function simulateSurvival(input:ProtectionInput,strategy:SurvivalStrategy,scenario:SurvivalScenario,partial:Partial<SurvivalSettings>={},broker:SurvivalBroker={}):ScenarioResult {
  const s=settingsFor(partial)
  if(!finite(dateMs(input.today)))throw new Error('Valid simulation date required')
  if(!finite(input.gross)||input.gross<0||!finite(input.debt)||input.debt<0)throw new Error('Valid simulation balances required')
  const horizon=sharedHorizon(input,s,strategy.quote?[strategy.quote]:[])
  // Local cumulative factors make historical/Monte Carlo paths linear in days.
  const marketFactors:number[]=[1]
  for(let day=1;day<=horizon;day++)marketFactors.push(scenario.returns?marketFactors[day-1]*Math.max(.01,1+bounded(scenario.returns[day-1],0,-.99,10)):priceFactor(scenario,day,horizon))
  const ratePct=bounded(input.ratePct,0,0,100),fee=bounded(input.feePerContract,0,0,1e6)
  const selected=input.closePositionId?input.positions.find(p=>p.id===input.closePositionId&&p.isOption):undefined
  const closeQty=Math.min(Math.max(0,strategy.closeContracts??0),Math.max(0,selected?.shares??0))
  const state={cash:Math.max(0,input.gross-input.positions.reduce((n,p)=>n+p.lastPrice*p.shares,0)),debt:Math.max(0,input.debt)}
  const sale=Math.min(Math.max(0,strategy.saleAmount??0),input.debt,input.positions.filter(p=>!p.isOption&&p.shares>0).reduce((n,p)=>n+p.lastPrice*p.shares,0))
  const stocks=input.positions.filter(p=>!p.isOption&&p.shares!==0)
  const totalStock=stocks.reduce((n,p)=>n+Math.max(0,p.shares*p.lastPrice),0)
  const fraction=totalStock?1-sale/totalStock:1
  cashFlow(sale+(strategy.deposit??0),state)
  const oldQuote=selected?input.quotes.find(q=>same(q.symbol,selected.symbol)):undefined
  if(closeQty)cashFlow(closeQty*(oldQuote?.bid??0)*100*(1-s.slippagePct/100)-closeQty*fee,state)
  const options:ModelOption[]=[]
  const addOption=(symbol:string,strike:number,expiration:string,contracts:number,initial:number,underlying:string,q?:ProtectionQuote,starts=0)=>{
    if(contracts<=0)return
    const stock=stocks.find(p=>p.symbol.toUpperCase()===underlying.toUpperCase())
    const spot=underlying==='QQQ'?input.qqqPrice:stock?.lastPrice??input.qqqPrice
    const beta=underlying==='QQQ'?1:stock?input.risks[key(stock)]?.beta??1:1
    const days=dte(expiration,input.today),mid=q&&finite(q.bid)&&finite(q.ask)?(q.bid+q.ask)/2:initial/100
    const vol=impliedPutVol(spot,strike,days/365,mid,s.riskFreeRate)??s.volatility
    options.push({symbol,strike,expiration,contracts,initial,spot,beta,vol,spread:q&&finite(q.ask)&&finite(q.bid)?Math.max(0,q.ask-q.bid)/2:0,settled:false,starts})
  }
  const validUnderlying=finite(input.qqqPrice)&&input.qqqPrice>0
  const supported=(p:ProtectionInput['positions'][number])=>validUnderlying&&p.isOption&&p.shares>0&&Number.isSafeInteger(p.shares)&&p.optionType==='Put'&&p.underlying==='QQQ'&&!!p.expiration&&finite(dateMs(p.expiration))&&finite(p.strike)&&p.strike>0
  const unsupported=input.positions.filter(p=>p.isOption&&p.shares!==0&&!supported(p))
  for(const p of input.positions.filter(supported))addOption(p.symbol,p.strike!,p.expiration!,p.shares-(p.id===selected?.id?closeQty:0),p.lastPrice,p.underlying??'QQQ',input.quotes.find(q=>same(q.symbol,p.symbol)))
  const newOption=validUnderlying&&strategy.quote&&contractIdentity(strategy.quote)&&Number.isSafeInteger(strategy.contracts)&&strategy.contracts!>0&&finite(strategy.quote.ask)&&finite(strategy.quote.bid)?strategy.quote:undefined
  const starts=closeQty?Math.max(1,s.closeGapDays):0
  let bought=false,interest=0
  const investments:{amount:number;factor:number}[]=[]
  const invest=(amount:number,day:number)=>{if(amount<=0)return;cashFlow(-amount,state);investments.push({amount,factor:marketFactors[day]})}
  const flow=(day:number)=>{for(const f of s.flows.filter(f=>f.day===day)){if(f.kind==='investment')invest(f.amount,day);else cashFlow((f.kind==='expense'?-1:1)*f.amount*(f.kind==='dividend'?(scenario.dividendFactor??1):1),state)}}
  const points:SurvivalPoint[]=[]
  const observe=(day:number,phase?:string)=>{
    const market=marketFactors[day],increase=day>0?(scenario.maintenanceIncrease??0):0
    const invested=investments.reduce((sum,lot)=>sum+lot.amount*market/lot.factor,0)
    // Unsupported options remain at unverified inventory marks; they cannot
    // generate a modeled exercise payoff or become usable collateral.
    let assets=invested+unsupported.reduce((sum,p)=>sum+p.lastPrice*(p.shares-(p.id===selected?.id?closeQty:0)),0),maintenance=0,known=unsupported.length===0&&!(strategy.quote&&!validUnderlying)
    const collateral:{value:number;rate:number}[]=[]
    for(const p of stocks){const risk=input.risks[key(p)],beta=risk?.beta??1,unstable=scenario.kind==='correlation'?Math.max(beta,1.5)+Math.max(0,1-Math.abs(risk?.correlation??0)):beta
      const value=Math.max(0,p.shares*p.lastPrice*fraction*(1+unstable*(market-1)))
      assets+=value
      if(finite(risk?.maintenancePct)&&risk.maintenancePct>=0){const rate=Math.max(0,risk.maintenancePct+increase)/100;maintenance+=value*rate;collateral.push({value,rate})}
      else known=false
    }
    if(invested>0)known=false // Future purchases have no verified security-specific requirements.
    let hedge=0,intrinsic=0,coverage=0
    for(const o of options){if(o.settled||day<o.starts)continue
      const spot=Math.max(0,o.spot*(1+o.beta*(market-1))),days=dte(o.expiration,input.today)-day
      const iv=o.vol*(scenario.volatilityMultiplier??(scenario.kind==='volatility'?1.8:1))
      const intrinsicPer=Math.max(0,o.strike-spot)
      if(days<=0){cashFlow(intrinsicPer*100*o.contracts-o.contracts*fee,state);o.settled=true;continue}
      const theoretical=putValue(spot,o.strike,days/365,iv,s.riskFreeRate)
      const per=day===0?o.initial/100:Math.max(intrinsicPer,theoretical-o.spread)
      hedge+=per*100*o.contracts;intrinsic+=intrinsicPer*100*o.contracts
      coverage+=spot*100*o.contracts
    }
    assets+=hedge+state.cash
    if(s.optionMaintenance==='unknown'&&options.some(o=>!o.settled&&day>=o.starts))known=false
    if(s.optionMaintenance==='full-value')maintenance+=hedge
    const equity=assets-state.debt
    // A reported account requirement is authoritative only at the live checkpoint.
    // Future requirements use position-specific model assumptions.
    const live=day===0&&strategy.id==='hold'&&!closeQty&&!newOption&&!sale&&!strategy.deposit&&!s.flows.some(f=>f.day===0)
    const req=live&&finite(broker.maintenanceRequirement)?broker.maintenanceRequirement:known?maintenance:null
    const excess=live&&finite(broker.maintenanceExcess)?broker.maintenanceExcess:live&&finite(broker.maintenanceRequirement)?finite(broker.marginEquity)?broker.marginEquity-broker.maintenanceRequirement:null:req==null?null:equity-req
    // Best-case asset-sale estimate under unchanged house rates, without fees.
    // Consume today's marked collateral at its own rate; null means unavailable
    // or the deficiency cannot be cured by selling the modeled collateral.
    let forced:number|null=excess==null?null:0
    if(excess!=null&&excess<0){
      let remaining=-excess,sold=0
      if(known)for(const holding of collateral.sort((a,b)=>b.rate-a.rate)){
        if(holding.rate<=0)continue
        const amount=Math.min(holding.value,remaining/holding.rate)
        sold+=amount;remaining-=amount*holding.rate
        if(remaining<=1e-8)break
      }
      forced=known&&remaining<=1e-8?sold:null
    }
    points.push({day,date:new Date(dateMs(input.today)+day*DAY).toISOString().slice(0,10),gross:assets,equity,debt:state.debt,equityPct:assets>0?equity/assets*100:0,maintenance:req,maintenanceExcess:excess,hedgeValue:hedge,intrinsic,timeValue:Math.max(0,hedge-intrinsic),interest,coverage:totalStock>0?coverage/(totalStock*fraction+invested):0,liquidity:live&&finite(broker.withdrawable)?broker.withdrawable:null,forcedLiquidation:forced,brokerEquity:live&&finite(broker.marginEquity)?broker.marginEquity:null,...(phase?{phase}:{})})
  }
  const buy=()=>{if(!newOption||bought)return;cashFlow(-(newOption.ask??0)*100*strategy.contracts!*(1+s.slippagePct/100)-fee*strategy.contracts!,state);addOption(newOption.symbol,newOption.strike,newOption.expiration,strategy.contracts!,newOption.bid!*100,'QQQ',newOption,starts);bought=true}
  if(!closeQty)buy()
  flow(0)
  observe(0,closeQty&&newOption?'Close filled; replacement not filled':'Immediate')
  for(let day=1;day<=horizon;day++){
    const cost=state.debt*ratePct/100/365;interest+=cost;cashFlow(-cost,state)
    if(day%30===0){cashFlow(s.monthlyDividend*(scenario.dividendFactor??1)+s.monthlyDeposit-s.monthlyExpense,state)
      // Follow the user's salary policy: pause new investments under the equity
      // floor/cushion, direct salary to debt, resume once the policy recovers.
      const previous=points.at(-1)!,pause=previous.equityPct<s.cautionPct||previous.maintenanceExcess==null||previous.maintenanceExcess<s.maintenanceCushion
      cashFlow(s.monthlySalary,state);if(!pause)invest(s.monthlySalary,day)
    }
    flow(day)
    if(newOption&&day===starts){observe(day,'Replacement not filled');buy()}
    observe(day,newOption&&day===starts?'Replacement filled':undefined)
  }
  const known=points.every(p=>p.maintenanceExcess!=null),min=known?Math.min(...points.map(p=>p.maintenanceExcess!)):null
  const maxDeficiency=Math.max(0,...points.map(p=>Math.max(0,-(p.maintenanceExcess??0))))
  const first=points.find(p=>p.maintenanceExcess!=null&&p.maintenanceExcess<-.01)
  const deleveraging=!known||points.some(p=>p.maintenanceExcess!<0&&p.forcedLiquidation==null)?null:Math.max(0,...points.map(p=>Math.max(0,p.gross-p.equity/(s.floorPct/100))),...points.map(p=>p.forcedLiquidation??0))
  return {id:scenario.id,label:scenario.label,declinePct:scenario.declinePct,minExcess:min,maxDeficiency,firstDeficiency:first?.date??null,survives:known&&maxDeficiency<.01,points,deleveraging}
}
export function survivalScenarios(partial:Partial<SurvivalSettings>={},shockDays:number[]=[45,60,90]):SurvivalScenario[] {
  const s=settingsFor(partial),out:SurvivalScenario[]=[]
  for(const n of [5,10,15,20,30,40])for(const kind of ['gradual','crash','rebound'] as const)out.push({id:`${kind}-${n}`,label:`${kind} −${n}%`,declinePct:n,kind})
  for(const day of [...new Set(shockDays)].filter(n=>Number.isSafeInteger(n)&&n>1))for(const declinePct of [5,10,15,20,30,40])out.push({id:`late-crash-${day}-${declinePct}`,label:`Day ${day} crash −${declinePct}%`,declinePct,kind:'crash',shockDay:day})
  out.push({id:'sideways',label:'Sideways / decay',declinePct:0,kind:'sideways'},{id:'volatility',label:'Volatility spike',declinePct:0,kind:'volatility',volatilityMultiplier:2},{id:'correlation',label:'Correlation breakdown −30%',declinePct:30,kind:'correlation',volatilityMultiplier:1.5},{id:'house',label:'Maintenance +20 points / −20%',declinePct:20,kind:'crash',maintenanceIncrease:20},{id:'dividend',label:'Distributions cut 50% / −20%',declinePct:20,kind:'gradual',dividendFactor:.5})
  if(s.historicalReturns.length)out.push({id:'historical',label:'Imported historical daily returns',declinePct:0,kind:'historical',returns:s.historicalReturns.slice(0,36500)})
  let seed=s.seed>>>0
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed+.5)/4294967296}
  for(let i=0;i<Math.min(100,Math.max(0,s.monteCarloPaths));i++){
    const returns=Array.from({length:Math.max(730,s.minimumDays)},()=>Math.max(-.95,s.volatility/Math.sqrt(252)*Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random())))
    out.push({id:`mc-${i}`,label:`Monte Carlo ${i+1} (hypothetical)`,declinePct:0,kind:'monte-carlo',returns})
  }
  return out
}
export function survivalEvidence(input:ProtectionInput,partial:Partial<SurvivalSettings>={},broker:SurvivalBroker={}):string[] {
  const s=settingsFor(partial),missing:string[]=[]
  if(!finite(input.gross)||input.gross<=0||!finite(input.debt)||input.debt<0||!finite(input.qqqPrice)||input.qqqPrice<=0)missing.push('Valid reconciled account balances and QQQ price required')
  if(!finite(dateMs(input.today)))missing.push('Valid simulation date required')
  if(!policyValid(s))missing.push('Policy thresholds must satisfy 100 > normal > caution > floor > 0')
  if(!finite(input.ratePct)||input.ratePct<0||!finite(input.feePerContract)||input.feePerContract<0||!finite(input.budget)||input.budget<0)missing.push('Valid interest, fee and budget inputs required')
  if((input.accountCount??1)!==1||new Set(input.positions.filter(p=>p.shares).map(p=>p.accountId)).size>1)missing.push('Select one account; collateral cannot be shared across accounts')
  if(input.positions.reduce((sum,p)=>sum+p.shares*p.lastPrice,0)>input.gross+.01)missing.push('Position marks exceed reconciled gross assets')
  for(const p of input.positions.filter(p=>p.shares!==0)){
    if(!finite(p.shares)||!finite(p.lastPrice)||p.lastPrice<0||p.shares<0)missing.push(`${p.symbol}: invalid mark or unsupported short exposure`)
    if(!p.isOption){const r=input.risks[key(p)];if(!finite(r?.beta)||Math.abs(r.beta)>8||!finite(r?.correlation)||Math.abs(r.correlation)>1||!r.source?.trim())missing.push(`${p.symbol}: historical exposure unverified`);if(!finite(r?.maintenancePct)||r.maintenancePct<0||!r?.maintenanceSource?.trim()||/assumption|estimate/i.test(r.maintenanceSource))missing.push(`${p.symbol}: broker maintenance unverified`)}
    else{
      const q=input.quotes.find(q=>same(q.symbol,p.symbol))
      if(p.optionType!=='Put'||!p.expiration||!finite(p.strike)||p.strike<=0||p.underlying!=='QQQ'||!Number.isSafeInteger(p.shares))missing.push(`${p.symbol}: unsupported option exposure`)
      if(!q)missing.push(`${p.symbol}: current contract quote/multiplier unverified`)
      else {
        missing.push(...quoteIssues(q,input).map(issue=>`${p.symbol}: ${issue}`))
        if(q.expiration!==p.expiration||q.strike!==p.strike)missing.push(`${p.symbol}: quote does not match held contract`)
        if(!finite(q.bid)||!finite(q.ask)||impliedPutVol(input.qqqPrice,q.strike,dte(q.expiration,input.today)/365,(q.bid+q.ask)/2,s.riskFreeRate)==null)missing.push(`${p.symbol}: pricing cannot be calibrated to current quote`)
      }
    }
  }
  const hasOptions=input.positions.some(p=>p.isOption&&p.shares!==0)
  if(hasOptions&&broker.optionMaintenanceVerified!==true)missing.push('Option-specific broker maintenance treatment unverified')
  if(hasOptions&&s.optionMaintenance==='unknown')missing.push('Option maintenance treatment unknown; scenario estimates cannot authorize orders')
  if(finite(broker.marginEquity)&&Math.abs(broker.marginEquity-(input.gross-input.debt))>.01)missing.push('Broker margin equity differs from model net equity; future margin-equity treatment unverified')
  return [...new Set(missing)]
}
export function buildSurvivalReport(input:ProtectionInput,partial:Partial<SurvivalSettings>={},broker:SurvivalBroker={},extraStrategies:SurvivalStrategy[]=[]):SurvivalReport {
  const s=settingsFor(partial),missing=survivalEvidence(input,s,broker)
  if(!finite(dateMs(input.today)))throw new Error('Valid simulation date required')
  const horizon=sharedHorizon(input,s,extraStrategies.flatMap(strategy=>strategy.quote?[strategy.quote]:[]))
  const simulationSettings={...s,minimumDays:horizon}
  const held=input.closePositionId?input.positions.find(p=>p.id===input.closePositionId&&p.isOption):undefined
  const cashTargets=[50,55,60].map(target=>({target,cash:cashToEquity(input.gross,input.debt,target/100)}))
  const base:SurvivalStrategy[]=[{id:'hold',label:'Hold existing protection'}]
  if(held&&held.shares>1)base.push({id:'partial',label:'Realize one contract; retain remaining',closeContracts:1})
  const quotes=input.quotes.filter(q=>quoteIssues(q,input).length===0&&q.expiration>(held?.expiration??input.today)&&dte(q.expiration,input.today)>=Math.max(input.horizonDays,s.minimumDays))
  // Full paths for the best liquid candidates; hard safety constraints, not
  // premium released, determine the final ranking. Bound workload on the UI.
  const shortlist=quotes.sort((a,b)=>Math.abs(dte(a.expiration,input.today)-Math.max(90,input.horizonDays))-Math.abs(dte(b.expiration,input.today)-Math.max(90,input.horizonDays)))
  const unique=new Map<string,ProtectionQuote>();for(const q of shortlist)if(!unique.has(`${q.expiration}|${q.strike}`))unique.set(`${q.expiration}|${q.strike}`,q)
  // Bounded search: four distinct maturities and two strikes nearest spot each.
  // This is a representative candidate set, not an exhaustive optimizer.
  const distinct=[...unique.values()],expirations=[...new Set(distinct.map(q=>q.expiration))]
  const maturities:string[]=[]
  for(const target of [Math.max(90,input.horizonDays,s.minimumDays),180,270,365]){
    const next=expirations.filter(e=>!maturities.includes(e)).sort((a,b)=>Math.abs(dte(a,input.today)-target)-Math.abs(dte(b,input.today)-target)||a.localeCompare(b))[0]
    if(next)maturities.push(next)
  }
  const available=maturities.flatMap(expiration=>distinct.filter(q=>q.expiration===expiration).sort((a,b)=>Math.abs(a.strike-input.qqqPrice)-Math.abs(b.strike-input.qqqPrice)||a.ask!-a.bid!-(b.ask!-b.bid!)).slice(0,2))
  for(const q of available)for(const contracts of [...new Set([1,2,Math.min(input.maxContracts??30,Math.max(1,Math.ceil(input.gross/(input.qqqPrice*100))))])].filter(n=>Number.isSafeInteger(n)&&n>0&&n<=Math.min(30,input.maxContracts??30)))base.push({id:`roll-${q.symbol}-${contracts}`,label:`${held?'Roll':'Buy'} ${contracts} × $${q.strike} · ${q.expiration}`,closeContracts:held?.shares??0,quote:q,contracts})
  const saleTarget=Math.min(input.debt,Math.max(0,input.gross-(input.gross-input.debt)/.6))
  base.push({id:'delever',label:'Sell assets to target 60% equity',saleAmount:saleTarget},{id:'deposit',label:'Deposit cash to target 60% equity',deposit:cashTargets[2].cash})
  if(available[0])base.push({id:'combined',label:'One put + debt reduction',saleAmount:saleTarget,quote:available[0],contracts:1,closeContracts:held?.shares??0})
  base.push(...extraStrategies)
  const expirationDays=[...input.positions.filter(p=>p.isOption&&p.expiration).map(p=>dte(p.expiration!,input.today)+1),...base.flatMap(strategy=>strategy.quote?[dte(strategy.quote.expiration,input.today)+1]:[])]
  const shockDays=[45,60,90,horizon,...expirationDays].filter(day=>finite(day)&&day>1&&day<=horizon)
  const scenarios=survivalScenarios(simulationSettings,shockDays)
  const results=base.map((strategy):StrategyResult=>{
    const paths=scenarios.map(scenario=>simulateSurvival(input,strategy,scenario,simulationSettings,broker)),first=paths[0].points.find(p=>p.phase==='Replacement filled')??paths[0].points[0]
    const old=held?input.quotes.find(q=>same(q.symbol,held.symbol)):undefined
    const credit=(strategy.closeContracts??0)*(old?.bid??0)*100*(1-s.slippagePct/100),cost=(strategy.quote?.ask??0)*100*(strategy.contracts??0)*(1+s.slippagePct/100),fees=((strategy.contracts??0)+(strategy.closeContracts??0))*input.feePerContract
    const minExcess=paths.every(p=>p.minExcess!=null)?Math.min(...paths.map(p=>p.minExcess!)):null
    const maxDeficiency=Math.max(...paths.map(p=>p.maxDeficiency)),failures:string[]=[]
    if(missing.length)failures.push('Required evidence is unverified')
    if(minExcess==null)failures.push('Maintenance excess cannot be verified')
    else if(minExcess<s.maintenanceCushion)failures.push(`Modeled maintenance cushion below $${s.maintenanceCushion.toFixed(0)}`)
    if(maxDeficiency>.01)failures.push('Modeled maintenance deficiency')
    if(paths.some(p=>p.points.some(p=>p.equityPct<s.floorPct)))failures.push(`Equity below ${s.floorPct}% policy floor`)
    if(cost+fees>input.budget)failures.push('Purchase budget exceeded')
    if(strategy.quote&&impliedPutVol(input.qqqPrice,strategy.quote.strike,dte(strategy.quote.expiration,input.today)/365,(strategy.quote.ask!+strategy.quote.bid!)/2,s.riskFreeRate)==null)failures.push('Replacement quote cannot be calibrated')
    if(strategy.quote){
      failures.push(...quoteIssues(strategy.quote,input))
      if(broker.optionMaintenanceVerified!==true||s.optionMaintenance==='unknown')failures.push('Replacement option maintenance treatment unverified')
      if(!Number.isSafeInteger(strategy.contracts)||strategy.contracts!<=0||strategy.contracts!>Math.min(30,input.maxContracts??30))failures.push('Invalid replacement contract quantity or contract limit exceeded')
      if(dte(strategy.quote.expiration,input.today)<Math.max(input.horizonDays,s.minimumDays))failures.push('Replacement expires before required protection duration')
    }else if(strategy.contracts!=null)failures.push('Replacement quote required for contract quantity')
    if(strategy.quote&&(strategy.closeContracts??0)>0&&dte(strategy.quote.expiration,input.today)<=Math.max(1,s.closeGapDays))failures.push('Replacement expires before modeled fill')
    if(strategy.closeContracts!=null&&(!Number.isSafeInteger(strategy.closeContracts)||strategy.closeContracts<0||strategy.closeContracts>(held?.shares??0)))failures.push('Invalid close contract quantity')
    if((strategy.saleAmount!=null&&(!finite(strategy.saleAmount)||strategy.saleAmount<0))||(strategy.deposit!=null&&(!finite(strategy.deposit)||strategy.deposit<0)))failures.push('Invalid sale or deposit amount')
    const expiry=Math.max(0,...paths[0].points.filter(p=>p.hedgeValue>0).map(p=>p.day))
    return {id:strategy.id,label:strategy.label,netDebit:cost+fees-credit,postDebt:first.debt,postEquityPct:first.equityPct,immediateExcess:paths.every(path=>path.points.filter(p=>p.day<=first.day).every(p=>p.maintenanceExcess!=null))?Math.min(...paths.flatMap(path=>path.points.filter(p=>p.day<=first.day).map(p=>p.maintenanceExcess!))):null,minExcess,maxDeficiency,firstDeficiency:paths.map(p=>p.firstDeficiency).filter((d):d is string=>!!d).sort()[0]??null,financing:Math.max(...paths.map(p=>p.points.at(-1)!.interest)),hedgeCost:cost+fees,coverageDays:expiry,qualifies:failures.length===0,failures,scenarios:paths,deleveraging:paths.every(p=>p.deleveraging!=null)?Math.max(...paths.map(p=>p.deleveraging!)):null,...(strategy.quote?{trade:{symbol:strategy.quote.symbol,contracts:strategy.contracts??0}}:{}),executionGapDays:strategy.quote&&(strategy.closeContracts??0)>0?Math.max(1,s.closeGapDays):0,fees}
  })
  const hold=results[0],score=(r:StrategyResult)=>r.maxDeficiency*s.riskWeights.deficiency*1e6+Math.max(0,s.maintenanceCushion-(r.minExcess??-1e6))*1e3+Math.max(0,Math.max(90,input.horizonDays)-r.coverageDays)*s.riskWeights.uncovered+r.financing*s.riskWeights.financing+Math.max(0,r.netDebit)*s.riskWeights.cost
  const recommended=results.filter(r=>r.qualifies).sort((a,b)=>score(a)-score(b))[0]??null
  const hedgeValue=input.positions.filter(p=>p.isOption).reduce((n,p)=>n+p.shares*p.lastPrice,0),days=input.positions.filter(p=>p.isOption&&p.expiration&&p.shares>0).map(p=>dte(p.expiration!,input.today)),daysToExpiration=days.length?Math.min(...days):null
  const currentEquityPct=input.gross>0?(input.gross-input.debt)/input.gross*100:0,brokerExcess=finite(broker.maintenanceExcess)?broker.maintenanceExcess:finite(broker.maintenanceRequirement)&&finite(broker.marginEquity)?broker.marginEquity-broker.maintenanceRequirement:null
  const policy=policyState(currentEquityPct,brokerExcess,s.maintenanceCushion,hold.maxDeficiency>.01,s)
  const alerts:SurvivalReport['alerts']=[]
  const alert=(id:string,message:string,severity:'info'|'warning'|'danger')=>alerts.push({id,message,severity})
  if(currentEquityPct<55)alert('equity-55','Equity is below your 55% operating buffer','warning')
  if(currentEquityPct<50)alert('equity-50','Equity is below your 50% policy floor','danger')
  if(brokerExcess!=null&&brokerExcess<s.maintenanceCushion)alert('cushion','Broker maintenance excess is below your cushion','danger')
  if(hold.maxDeficiency>.01)alert(`deficiency-${hold.firstDeficiency}`,`Modeled deficiency begins ${hold.firstDeficiency}; this is not a broker-issued margin call`,'danger')
  if(daysToExpiration!=null&&daysToExpiration<45){const threshold=[14,21,30,45].find(n=>daysToExpiration<n)!;alert(`expiry-${threshold}`,`Protection expires in ${daysToExpiration} days (under ${threshold})`,'warning')}
  if(missing.some(m=>/quotes required|quote is stale/.test(m)))alert('stale','Refresh option quotes before any trade review','warning')
  if(hold.financing/horizon*30>s.interestBudget)alert('interest','Projected monthly financing exceeds your budget','warning')
  if(input.positions.some(p=>!p.isOption&&Math.abs(input.risks[key(p)]?.correlation??0)<.5))alert('correlation','Some holdings have weak QQQ correlation; proxy protection may deteriorate','warning')
  if(held&&available.length)alert('roll-gap','Sequential rolls include a close-before-replacement coverage gap','warning')
  return {strategies:results,recommended,missing,alerts,policy,cashTargets,brokerMaintenanceExcess:brokerExcess,currentEquityPct,currentDebt:input.debt,dailyInterest:input.debt*input.ratePct/100/365,monthlyInterest:input.debt*input.ratePct/100/365*30,hedgeValue,daysToExpiration,coverage:hold.scenarios[0].points[0].coverage,explanation:recommended?`${recommended.label}: satisfies the modeled maintenance cushion and equity floor across tested paths. Model estimates only; finite scenarios do not guarantee protection or establish Schwab approval. Sequential replacement fills assume the quoted ask after the modeled gap, with configured slippage and per-contract fees.`:'NO QUALIFYING HEDGE — RISK REDUCTION REQUIRED. '+(missing.length?'Broker or pricing evidence is incomplete. ':'No tested strategy satisfies the maintenance cushion and equity floor throughout the timeline. ')+'Review modeled asset sales and cash deposits for each scenario.'}
}
