import assert from 'node:assert/strict'
import { planAccountImport } from '../src/lib/account-import'
import type { Account, Position, Transaction } from '../src/lib/types'
const account = { id: 'live', mask: '1234', name: 'Main' } as Account
const row: Transaction = { id: 't1', accountId: 'live', date: '2026-09-01', symbol: 'ABC', type: 'Buy', description: 'Bought ABC', amount: -100, units: 2, tags: ['saved'], fundingReview: {kind:'external'}, classificationSource:'manual' }
const position = { id:'p1', accountId:'live', symbol:'ABC', shares:2, avgCost:40, lastPrice:70, dividendsReceived:10 } as Position
const imported = { accounts:[{...account,id:'csv'}], positions:[{...position,id:'cp',accountId:'csv',avgCost:50,lastPrice:50}], transactions:[{...row,id:'ct',accountId:'csv',tags:[]}] }
const plan = planAccountImport(account,[position],[row],imported)
assert.equal(plan.matched.length,1)
assert.equal(plan.added.length,0)
assert.equal(plan.positions[0].avgCost,50)
assert.equal(plan.positions[0].lastPrice,70)
assert.equal(plan.positions[0].dividendsReceived,10)
assert.equal(plan.transactions[0].id,'t1')
assert.deepEqual(plan.transactions[0].tags,['saved'])
assert.deepEqual(plan.transactions[0].fundingReview,{kind:'external'})
assert.equal(planAccountImport(account,plan.positions,plan.transactions,imported).added.length,0)
const fresh = {...row,id:'new',date:'2026-10-01',accountId:'csv'}
const added = planAccountImport(account,[position],[row],{...imported,transactions:[fresh]})
assert.equal(added.added.length,1)
assert.equal(planAccountImport(account,added.positions,added.transactions,{...imported,transactions:[fresh]}).added.length,0)
assert.equal(planAccountImport(account,[position],[row],{...imported,transactions:[{...fresh,date:'2026-09-02'}]}).held.length,1)
assert.equal(planAccountImport(account,[position],[],{...imported,transactions:[fresh,{...fresh,id:'new2'}]}).held.length,2)
assert.throws(()=>planAccountImport(account,[position],[row],{...imported,accounts:[{...account,id:'csv',mask:'9999'}]}))
assert.equal(planAccountImport(account,[position],[row],{...imported,positions:[{...imported.positions[0],shares:3}]}).positionHeld.length,1)
console.log('Account import reconciliation passed')
import { positionSources } from '../src/lib/position-sources'
import { parseSchwabFiles } from '../src/lib/import'
import type { HistoricalBalance } from '../src/lib/types'
const authority = [{accountMask:'1234',importedAt:'2026-01-01',position:{...position,dataSource:'csv' as const}}]
assert.equal(positionSources([account],[{...position,dataSource:'csv'}],authority,[]).csvCount,1)
assert.equal(positionSources([{...account,id:'other',mask:'5678'}],[],authority,[]).csvCount,0)
assert.equal(positionSources([account],[{...position,dataSource:'csv',shares:3}],authority,[]).quantityChanges,1)
assert.equal(positionSources([account],[position],authority,[{accountMask:'1234',month:'2026-09',source:'Schwab statement'} as HistoricalBalance]).latestStatement,'2026-09')
assert.equal(planAccountImport(account,[position],[row],{...imported,positions:[{...imported.positions[0],costBasisUnavailable:true}]}).positionUpdates.length,0)
assert.equal(planAccountImport(account,[position],[],{...imported,transactions:[fresh]},[{...fresh,accountId:'live'}]).held.length,1)
assert.equal(planAccountImport(account,[position],[],{...imported,transactions:[fresh,{...fresh,id:'different-description',description:'CSV different wording'}]}).added.length,0)
const missingBasis = parseSchwabFiles([{name:'positions.csv',text:'Symbol,Description,Quantity,Price,Market Value,Cost Basis\nABC,ABC,2,50,100,N/A'}],{broker:'Schwab',name:'Main',mask:'1234',isMargin:false})
assert.equal(missingBasis.positions[0].costBasisUnavailable,true)
console.log('Position source, missing basis and archived-record checks passed')
const trade={...fresh,type:'Buy' as const,amount:-100,units:2}
const overlapping=planAccountImport(account,[],[],{...imported,positions:[],transactions:[trade,{...trade,id:'fill1',amount:-40,units:.8},{...trade,id:'fill2',amount:-60,units:1.2}]})
assert.equal(overlapping.added.length,0)
assert.equal(overlapping.held.length,3)
assert.equal(planAccountImport({...account,mask:'123'},[],[],{...imported,accounts:[{...account,id:'csv',mask:'0123'}],positions:[],transactions:[]}).added.length,0)
console.log('Aggregate/fill overlap and account suffix checks passed')
assert.equal(positionSources([account],[{...position,dataSource:'statement'}],authority,[]).csvCount,0,'old CSV authority is not shown when a statement actually supplies basis')
assert.equal(positionSources([account],[{...position,dataSource:'statement'}],authority,[]).statementCostCount,1)
