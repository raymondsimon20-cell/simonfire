import { strict as assert } from 'node:assert'
import { schwabProtectionData } from '../src/lib/schwab-protection-data'
const raw = [{ securitiesAccount: { accountNumber: '12345678', currentBalances: { cashBalance: 0, marginBalance: -2500, maintenanceRequirement: 9999 }, positions: [
  { instrument: { symbol: 'TEST' }, longQuantity: 10, marketValue: 1000, maintenanceRequirement: 300 },
  { instrument: { symbol: 'MISSING' }, longQuantity: 5, marketValue: 500 },
  { instrument: { symbol: 'ZERO' }, longQuantity: 5, marketValue: 500, maintenanceRequirement: 0 },
  { instrument: { symbol: 'BAD' }, longQuantity: 5, marketValue: 500, maintenanceRequirement: null },
] } }]
const account = schwabProtectionData(raw)[0]
assert.equal(account.accountId,'acc_5678')
assert.equal(account.cash,0)
assert.equal(account.debt,2500)
assert.equal(account.positions[0].maintenancePct,30,'position requirement is dollars divided by its own market value')
assert.equal(account.positions[1].maintenancePct,undefined,'aggregate account requirement must never be allocated to individual holdings')
assert.equal(account.positions[2].maintenancePct,0,'explicit zero is valid; absence is not zero')
assert.equal(account.positions[3].maintenancePct,undefined)
assert.ok(!JSON.stringify(account).includes('12345678'),'only masked identity leaves the handler')
assert.equal(schwabProtectionData([{securitiesAccount:{accountNumber:'98765432',positions:[]}}])[0].debt,null,'missing balances are unknown')
assert.throws(()=>schwabProtectionData({}),/account/)
assert.throws(()=>schwabProtectionData([raw[0],raw[0]]),/uniquely/)
console.log('Schwab protection data: exact account identity, optional per-position requirements, missing balances and zero values passed')

import { reconcileProtectionHoldings } from '../src/lib/schwab-protection-data'
import type { Position } from '../src/lib/types'
const savedHolding={id:'saved',accountId:'acc_5678',symbol:'TEST',shares:10,lastPrice:100,avgCost:100,prevClose:100,dividendsReceived:0} as Position
const currentHoldings=[{symbol:'TEST',shares:10,lastPrice:70}]
const reconciled=reconcileProtectionHoldings([savedHolding],currentHoldings)
assert.equal(reconciled.matches,true)
assert.equal(reconciled.positions[0].lastPrice,70,'same quantities must use refreshed Schwab marks with refreshed debt')
assert.equal(reconcileProtectionHoldings([savedHolding],[{symbol:'TEST',shares:7,lastPrice:100}]).matches,false,'a sale must not pair old assets with new lower debt')
assert.equal(reconcileProtectionHoldings([savedHolding],[]).matches,false)
assert.equal(reconcileProtectionHoldings([savedHolding],[...currentHoldings,{symbol:'NEW',shares:1,lastPrice:20}]).matches,false)
assert.equal(reconcileProtectionHoldings([{...savedHolding,shares:4},{...savedHolding,id:'lot2',shares:6}],currentHoldings).matches,true,'saved lots can match one aggregate broker position')
