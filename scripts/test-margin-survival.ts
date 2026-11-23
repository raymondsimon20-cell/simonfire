import { strict as a } from 'node:assert'
import { simulateSurvival, buildSurvivalReport, cashToEquity, policyState, putValue, survivalEvidence, type SurvivalSettings } from '../src/lib/margin-survival'
import type { ProtectionInput } from '../src/lib/portfolio-protection'
import type { Position } from '../src/lib/types'
const stock={id:'s',accountId:'a',symbol:'QQQ',shares:200,lastPrice:500} as Position
const put={id:'p',accountId:'a',symbol:'QQQ261204P00500000',shares:2,lastPrice:1000,isOption:true,optionType:'Put',underlying:'QQQ',strike:500,expiration:'2026-12-04'} as Position
const input:ProtectionInput={positions:[stock,put],risks:{'a|QQQ':{beta:1,correlation:1,source:'history',maintenancePct:30,maintenanceSource:'Schwab position maintenance'}},gross:102000,debt:45000,qqqPrice:500,today:'2026-11-23',horizonDays:30,ratePct:0,feePerContract:0,budget:10000,quotes:[{symbol:put.symbol,strike:500,expiration:put.expiration!,ask:10,bid:10,multiplier:100,quoteTime:Date.parse('2026-11-23T12:00:00Z')}],quoteFetchedAt:'2026-11-23T12:00:00Z',now:Date.parse('2026-11-23T12:00:01Z'),delayed:false}
const settings:Partial<SurvivalSettings>={minimumDays:30,optionMaintenance:'full-value',maintenanceCushion:0}
const crash={id:'crash',label:'crash',declinePct:20,kind:'crash' as const}
const run=simulateSurvival(input,{id:'hold',label:'Hold'},crash,settings)
a.equal(run.points[11].hedgeValue,0,'expired puts leave inventory')
a.ok(run.points[11].debt<45000-19000,'expiration payoff repays margin; never discarded')
a.equal(run.points[11].coverage,0)
a.ok(run.points[10].hedgeValue>=20000)
a.ok(run.points[11].equity>=run.points[10].equity-1,'settlement preserves net equity')
a.equal(run.minExcess,Math.min(...run.points.map(p=>p.maintenanceExcess!)))
const high={...input,debt:40000,risks:{'a|QQQ':{...input.risks['a|QQQ'],maintenancePct:80}}}
const highRun=simulateSurvival(high,{id:'hold',label:'Hold'},crash,settings)
a.ok(highRun.points[0].equityPct>50&&highRun.points[0].maintenanceExcess!<0,'maintenance can fail above50% equity')
a.equal(policyState(65,-1,0,false),'EMERGENCY')
a.equal(policyState(59,1000,0,false),'CAUTION')
a.equal(cashToEquity(100000,45000,.6),5000)
const sale=simulateSurvival(input,{id:'sale',label:'Sell',saleAmount:10000},{...crash,declinePct:0},settings)
a.equal(sale.points[0].equity,57000,'assets sale repays debt without inventing equity')
a.equal(sale.points[0].gross,92000)
a.equal(sale.points[0].debt,35000)
const missing=buildSurvivalReport({...input,risks:{}},settings)
a.equal(missing.recommended,null)
a.ok(missing.missing.length>0)
a.ok(putValue(500,500,0,.3,.04)===0)
const mtm=putValue(500,500,30/365,.3,.04)
a.ok(mtm>0&&putValue(500,500,30/365,.6,.04)>mtm)
const stale=buildSurvivalReport({...input,now:input.now!+600000},settings)
a.equal(stale.recommended,null)
const rebound=simulateSurvival(input,{id:'hold',label:'Hold'},{...crash,kind:'rebound'},settings)
a.ok(rebound.points[5].equity<rebound.points.at(-1)!.equity,'rebound restores net equity; settlement can reduce gross assets and debt together')
const raised=simulateSurvival(input,{id:'hold',label:'Hold'},{...crash,declinePct:0,maintenanceIncrease:40},settings)
a.ok(raised.minExcess!<run.points[0].maintenanceExcess!)
const flow=simulateSurvival(input,{id:'hold',label:'Hold'},{...crash,declinePct:0,dividendFactor:0},{...settings,monthlyDividend:3000})
const normal=simulateSurvival(input,{id:'hold',label:'Hold'},{...crash,declinePct:0},{...settings,monthlyDividend:3000})
a.ok(flow.points.at(-1)!.debt>normal.points.at(-1)!.debt)
console.log('Daily settlement, cash conservation, maintenance, policy, time/volatility pricing and missing/stale evidence passed')


const failures:string[]=[]
function check(name:string, test:()=>void) {try {test();console.log('PASS',name)}catch(error){failures.push(name);console.error(name,error)}}
const flat={id:'flat',label:'Flat',declinePct:0,kind:'sideways' as const}
const stocksOnly:ProtectionInput={...input,positions:[stock],gross:100000,debt:20000,quotes:[]}
check('cash targets reconcile even for zero assets and insolvency',()=>{
  for(const [gross,debt] of [[100000,45000],[100000,120000],[0,1000]]) {
    const cash=cashToEquity(gross,debt,.6)
    a.equal(cash,Math.max(0,debt-(1-.6)*gross))
  }
})
check('daily checkpoints extend through 365 and every expiration',()=>{
  const year={...stocksOnly,horizonDays:365}
  a.ok(simulateSurvival(year,{id:'hold',label:'Hold'},flat,settings).points.some(p=>p.day===365))
  const expiration='2029-01-01', day=Math.round((Date.parse(expiration)-Date.parse(input.today))/86400000)
  const far={...input,positions:[stock,{...put,expiration}]}
  a.equal(simulateSurvival(far,{id:'hold',label:'Hold'},flat,settings).points.at(-1)!.day,day)
})
check('asset purchases spend cash and receive returns only after purchase',()=>{
  const run=simulateSurvival(stocksOnly,{id:'hold',label:'Hold'},{...flat,kind:'historical',returns:[-.2,.25]}, {...settings,flows:[{day:1,kind:'investment',amount:1000}]})
  a.equal(run.points[1].equity,60000,'purchase is asset transfer, not income')
  a.equal(run.points[2].equity,80250,'new investment earns only the subsequent 25% rebound')
  a.equal(run.points[1].debt,21000)
})
check('salary is external income invested at its purchase-day price',()=>{
  const base=simulateSurvival(stocksOnly,{id:'hold',label:'Hold'}, {...flat,kind:'crash',declinePct:20},settings)
  const salary=simulateSurvival(stocksOnly,{id:'hold',label:'Hold'}, {...flat,kind:'crash',declinePct:20},{...settings,monthlySalary:1000})
  a.equal(salary.points[30].equity-base.points[30].equity,1000)
})
check('day-zero expenses decrease equity and deposits remain distinct from investments',()=>{
  const run=simulateSurvival(stocksOnly,{id:'hold',label:'Hold'},flat,{...settings,flows:[{day:0,kind:'expense',amount:500}]})
  a.equal(run.points[0].equity,79500)
})
check('maintenance rates above 100% remain intact',()=>{
  const run=simulateSurvival({...stocksOnly,risks:{'a|QQQ':{...input.risks['a|QQQ'],maintenancePct:150}}},{id:'hold',label:'Hold'},flat,settings)
  a.equal(run.points[0].maintenance,150000)
})
check('forced liquidation consumes actual holdings at their own maintenance rates',()=>{
  const second={...stock,id:'second',symbol:'LOW',shares:10,lastPrice:1000}
  const portfolio={...stocksOnly,positions:[{...stock,shares:10,lastPrice:1000},second],gross:20000,debt:15000,risks:{'a|QQQ':{...input.risks['a|QQQ'],maintenancePct:80},'a|LOW':{...input.risks['a|QQQ'],maintenancePct:20}}}
  const point=simulateSurvival(portfolio,{id:'hold',label:'Hold'}, {...flat,kind:'crash',declinePct:50},settings).points[1]
  // Both holdings now $5k. Deficiency $10k exceeds all available $5k relief.
  a.equal(point.forcedLiquidation,null,'insufficient sale relief cannot be reported as a finite successful sale')
  const p=simulateSurvival({...portfolio,debt:11000},{id:'hold',label:'Hold'},flat,settings).points[0]
  a.equal(p.forcedLiquidation,1250,'$1000 deficiency / 80% verified relief')
})
check('live maintenance excess uses explicit broker margin equity',()=>{
  const run=simulateSurvival(stocksOnly,{id:'hold',label:'Hold'},flat,settings,{maintenanceRequirement:30000,marginEquity:25000,maintenanceExcess:-5000})
  a.equal(run.points[0].maintenanceExcess,-5000)
})
check('no options need neither option-treatment gate nor chain freshness',()=>{
  const issues=survivalEvidence({...stocksOnly,quoteFetchedAt:undefined,delayed:undefined},{...settings,optionMaintenance:'unknown'})
  a.deepEqual(issues,[])
})
check('zero-valued active options still require known maintenance treatment',()=>{
  const run=simulateSurvival({...input,positions:[stock,{...put,lastPrice:0}],gross:100000},{id:'hold',label:'Hold'},flat,{...settings,optionMaintenance:'unknown'})
  a.equal(run.points[0].maintenanceExcess,null)
})
const candidate={symbol:'QQQ271217P00500000',strike:500,expiration:'2027-12-17',ask:50,bid:49,multiplier:100,quoteTime:input.now!}
check('candidate validation blocks malformed, non-QQQ, stale and missing timestamp evidence',()=>{
  for(const quote of [{...candidate,symbol:'QQQX271217P00500000'},{...candidate,symbol:'SPY271217P00500000'}, {...candidate,strike:450},{...candidate,expiration:'2027-12-16'}, {...candidate,bid:-1},{...candidate,quoteTime:undefined},{...candidate,quoteTime:input.now!-300001}]) {
    const report=buildSurvivalReport(stocksOnly,{...settings,maintenanceCushion:0},{optionMaintenanceVerified:true},[{id:'invalid',label:'Invalid',quote,contracts:1}])
    a.equal(report.strategies.find(s=>s.id==='invalid')!.qualifies,false,JSON.stringify(quote))
  }
  for(const contracts of [0,-1,.5,31]) {
    const report=buildSurvivalReport(stocksOnly,settings,{optionMaintenanceVerified:true},[{id:'invalid',label:'Invalid',quote:candidate,contracts}])
    a.equal(report.strategies.find(s=>s.id==='invalid')!.qualifies,false,`contracts=${contracts}`)
  }
})
check('no replacement can qualify with unknown option treatment',()=>{
  const report=buildSurvivalReport(stocksOnly,{...settings,optionMaintenance:'unknown'},{optionMaintenanceVerified:true},[{id:'candidate',label:'Candidate',quote:candidate,contracts:1}])
  a.equal(report.strategies.find(s=>s.id==='candidate')!.qualifies,false)
  const unverified=buildSurvivalReport(stocksOnly,settings,{optionMaintenanceVerified:undefined},[{id:'candidate',label:'Candidate',quote:candidate,contracts:1}])
  a.equal(unverified.strategies.find(s=>s.id==='candidate')!.qualifies,false)
})
check('one versus two nonmarginable puts follows premium and spread accounting',()=>{
  const portfolio={...stocksOnly,debt:68000}
  const quote={...candidate,bid:10,ask:12}
  const one=simulateSurvival(portfolio,{id:'one',label:'One',quote,contracts:1},flat,settings).points[0]
  const two=simulateSurvival(portfolio,{id:'two',label:'Two',quote,contracts:2},flat,settings).points[0]
  const equity=portfolio.gross-portfolio.debt, premium=quote.ask*100, mark=quote.bid*100
  a.equal(one.equity,equity-(premium-mark),'buying a put decreases net equity by the spread')
  a.equal(two.equity,equity-2*(premium-mark))
  a.equal(one.maintenanceExcess,equity-portfolio.gross*.3-premium)
  a.equal(two.maintenanceExcess,one.maintenanceExcess!-premium)
  a.ok(one.maintenanceExcess!>=0&&two.maintenanceExcess!<0,'anomaly is derived from full-value option maintenance, not a Schwab confirmation')
})
check('all strategies share horizon; roll reports completed trade and worst gap',()=>{
  const longer={...candidate,symbol:'QQQ280121P00500000',expiration:'2028-01-21'}
  const report=buildSurvivalReport({...input,closePositionId:put.id,quotes:[...input.quotes,candidate,longer]},settings,{optionMaintenanceVerified:true},[{id:'roll-test',label:'Roll',closeContracts:2,quote:candidate,contracts:1}])
  a.equal(new Set(report.strategies.map(s=>s.scenarios[0].points.at(-1)!.day)).size,1)
  const roll=report.strategies.find(s=>s.id==='roll-test')!, points=roll.scenarios[0].points
  const fill=points.find(p=>p.phase==='Replacement filled')!
  a.equal(roll.postDebt,fill.debt)
  a.equal(roll.postEquityPct,fill.equityPct)
  a.equal(roll.immediateExcess,Math.min(...roll.scenarios.flatMap(path=>path.points.filter(p=>p.day<=fill.day).map(p=>p.maintenanceExcess!))))
})
check('invalid policy bands block qualification without breaking simulation',()=>{
  const report=buildSurvivalReport(stocksOnly,{...settings,normalPct:50,cautionPct:60,floorPct:55})
  a.equal(report.recommended?.id,undefined)
  a.ok(report.missing.some(m=>/policy|threshold/i.test(m)))
})
check('invalid dates are rejected explicitly instead of crashing Date formatting',()=>{
  a.throws(()=>simulateSurvival({...stocksOnly,today:''},{id:'hold',label:'Hold'},flat,settings),/date/i)
})
check('requirement alone never supplies live broker maintenance excess',()=>{
  const point=simulateSurvival(stocksOnly,{id:'hold',label:'Hold'},flat,settings,{maintenanceRequirement:30000}).points[0]
  a.equal(point.maintenanceExcess,null)
})
check('add-only replacement retains existing puts and receives no close credit',()=>{
  const source={...input,closePositionId:'',quotes:[...input.quotes,candidate]}
  const report=buildSurvivalReport(source,settings,{optionMaintenanceVerified:true})
  const added=report.strategies.find(s=>s.trade?.symbol===candidate.symbol&&s.trade.contracts===1)!
  a.equal(added.netDebit,candidate.ask*100)
  a.equal(added.postDebt,input.debt+candidate.ask*100)
  a.equal(added.executionGapDays,0)
  a.equal(report.strategies.some(s=>s.id==='partial'),false)
  const path=added.scenarios[0]
  a.ok(path.points[0].hedgeValue>=put.lastPrice*put.shares+candidate.bid*100)
})
check('late crash exposes expired hedge instead of crediting its earlier crash payoff',()=>{
  const vulnerable={...input,debt:65000}
  const early=simulateSurvival(vulnerable,{id:'hold',label:'Hold'},{...crash,declinePct:40},{...settings,optionMaintenance:'zero'})
  const late=simulateSurvival(vulnerable,{id:'hold',label:'Hold'},{...crash,declinePct:40,shockDay:45},{...settings,optionMaintenance:'zero'})
  a.equal(early.survives,true,'under an explicitly hypothetical zero option-maintenance assumption')
  a.equal(late.survives,false)
  a.equal(late.points[45].hedgeValue,0)
  a.ok(late.points[45].maintenanceExcess!<0)
  const report=buildSurvivalReport(input,settings,{optionMaintenanceVerified:true})
  for(const day of [12,45,60,90])a.ok(report.strategies[0].scenarios.some(s=>s.id===`late-crash-${day}-40`),`late day ${day}`)
})
check('bounded candidates diversify four maturities and nearby strikes',()=>{
  const expirations=['2027-03-19','2027-06-18','2027-09-17','2027-12-17']
  const quotes=expirations.flatMap(expiration=>[450,490,500,510,550].map(strike=>({...candidate,expiration,strike,symbol:`QQQ${expiration.replace(/-/g,'').slice(2)}P${String(strike*1000).padStart(8,'0')}`})))
  const report=buildSurvivalReport({...stocksOnly,quotes},settings,{optionMaintenanceVerified:true})
  const trades=report.strategies.flatMap(s=>s.trade?[s.trade]:[])
  a.equal(new Set(trades.map(t=>t.symbol.slice(3,9))).size,4)
  a.equal(new Set(trades.map(t=>t.symbol)).size,8)
  a.ok(trades.every(t=>Math.abs(Number(t.symbol.slice(-8))/1000-input.qqqPrice)<=10))
})
check('invalid QQQ spot preserves unverified marks without fabricated expiration cash',()=>{
  for(const qqqPrice of [0,-1,NaN,undefined as unknown as number]){
    const source={...input,qqqPrice}
    const path=simulateSurvival(source,{id:'hold',label:'Hold'},flat,settings)
    a.equal(path.minExcess,null)
    a.ok(path.points.every(p=>p.debt===input.debt),'no invented payoff repays debt')
    a.ok(path.points.every(p=>p.equity===input.gross-input.debt),'fixed option marks are unverified, not synthetic gains')
    const replacement=simulateSurvival({...stocksOnly,qqqPrice},{id:'candidate',label:'Candidate',quote:candidate,contracts:1},flat,settings)
    a.equal(replacement.minExcess,null)
    a.ok(replacement.points.every(p=>p.hedgeValue===0&&p.debt===stocksOnly.debt))
    const report=buildSurvivalReport(source,settings,{optionMaintenanceVerified:true})
    a.equal(report.recommended?.id,undefined)
    a.equal(report.strategies[0].minExcess,null)
  }
})
check('uncurable or unknown maintenance keeps deleveraging unknown',()=>{
  const impossible=simulateSurvival({...stocksOnly,debt:120000},{id:'hold',label:'Hold'},flat,settings)
  a.ok(impossible.maxDeficiency>0)
  a.equal(impossible.points[0].forcedLiquidation,null)
  a.equal(impossible.deleveraging,null)
  const unknown=simulateSurvival({...input,qqqPrice:0},{id:'hold',label:'Hold'},flat,settings)
  a.equal(unknown.deleveraging,null)
  const report=buildSurvivalReport({...stocksOnly,debt:120000},settings)
  a.equal(report.strategies[0].deleveraging,null)
})
if(failures.length)throw new Error('Failed regression checks: '+failures.join('; '))
