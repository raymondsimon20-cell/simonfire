import assert from 'node:assert/strict'
import { parseStatementHoldings, applyStatementCostBasis } from '../src/lib/statement-holdings'
import type { PdfTextPage } from '../src/lib/statement-transactions'
import type { Account, HistoricalBalance, Position } from '../src/lib/types'
const item=(str:string,x:number,y:number,width=30)=>({str,x,y,width})
const page: PdfTextPage={page:3,items:[item('Positions - Equities',10,500),item('Symbol',10,480),item('Description',60,480),item('Quantity',300,480),item('Price($)',360,480),item('Market Value($)',410,480,55),item('Cost Basis($)',495,480,50),item('Gain/(Loss)($)',570,480,50),item('Yield',650,480),item('Income($)',700,480),item('ABC',10,460),item('Example company',60,460),item('2.0000',300,460),item('50.00000',360,460),item('100.00',435,460),item('90.00',515,460),item('10.00',590,460),item('2.00%',650,460),item('2.00',700,460),item('Total Equities',10,440),item('$100.00',435,440),item('$90.00',515,440),item('$10.00',590,440)]}
const snapshot=parseStatementHoldings([page],'2026-09')
assert.equal(snapshot.complete,true)
assert.equal(snapshot.holdings[0].costBasis,90)
assert.equal(snapshot.holdings[0].annualIncome,2)
assert.equal(snapshot.holdings[0].page,3)
const account={id:'a',mask:'123'} as Account
const p={id:'p',accountId:'a',symbol:'ABC',shares:2,avgCost:35,lastPrice:60,prevClose:59,dividendsReceived:0} as Position
const balance={accountMask:'123',month:'2026-09',fileName:'statement.pdf',statementSnapshot:snapshot} as HistoricalBalance
const updated=applyStatementCostBasis([account],[p],[balance])
assert.equal(updated[0].avgCost,45)
assert.equal(updated[0].lastPrice,60)
assert.equal(updated[0].dataSource,'statement')
assert.equal(applyStatementCostBasis([account],[{...p,shares:3}],[balance])[0].avgCost,35)
assert.equal(parseStatementHoldings([{...page,items:page.items.filter(t=>t.str!=='Total Equities')}],'2026-09').complete,false)
assert.equal(parseStatementHoldings([{...page,items:page.items.map(t=>t.str==='$100.00'?{...t,str:'$110.00'}:t)}],'2026-09').complete,false)
console.log('Statement holding validation, provenance and cost-basis checks passed')
import { cleanStatementSnapshot } from '../src/lib/statement-holdings'
const cleaned=cleanStatementSnapshot({...snapshot,sourceFile:'statement.pdf',importedAt:'2026-10-01T00:00:00Z',privateOwner:'omitted'})!
assert.equal(cleaned.complete,true)
assert.equal(cleaned.sourceFile,'statement.pdf')
assert.equal(JSON.stringify(cleaned).includes('privateOwner'),false)
assert.equal(cleanStatementSnapshot({...snapshot,holdings:[{...snapshot.holdings[0],quantity:Infinity}]}),undefined)
assert.equal(applyStatementCostBasis([account],[p],[{...balance,importedAt:'2026-09-01'}],[{accountMask:'123',importedAt:'2026-10-02',position:p}])[0].avgCost,35)
assert.equal(applyStatementCostBasis([account],[p],[{...balance,statementSnapshot:{...snapshot,costBasisEnabled:false}}])[0].avgCost,35)
const optionPage={...page,items:page.items.map(t=>({...t,str: t.str==='Positions - Equities'?'Positions - Options':t.str==='Total Equities'?'Total Options':t.str==='ABC'?'ABC 12/18/20':t.str==='50.00000'?'0.50000':t.str})).concat([item('26 650.00 P',10,450)])}
const option=parseStatementHoldings([optionPage],'2026-09')
assert.equal(option.complete,true)
assert.equal(option.holdings[0].symbol,'ABC   261218P00650000')
assert.equal(option.holdings[0].option?.strike,650)
console.log('Statement snapshot persistence, precedence and wrapped option checks passed')
import { mergeHistoricalBalances } from '../src/lib/statement-history'
assert.equal(applyStatementCostBasis([account],updated,[{...balance,statementSnapshot:{...snapshot,costBasisEnabled:false}}])[0].avgCost,35,'disabling restores the original basis')
const merged=mergeHistoricalBalances([{...balance,closingEquity:100}],[{...balance,closingEquity:100,statementSnapshot:{holdings:[],complete:false,issues:['unreadable'],categoryTotals:[]}}],[account])
assert.equal(merged[0].statementSnapshot?.complete,true,'an incomplete retry cannot erase verified evidence')
assert.ok(merged[0].statementSnapshotWarning)
assert.equal(applyStatementCostBasis([account],[{...p,dataSource:'manual'}],[balance])[0].avgCost,35)
console.log('Disabled overlay restoration and failed-reimport preservation passed')
const dated={...balance,closingEquity:100,importedAt:'2026-10-02T00:00:00Z',statementSnapshot:{...snapshot,sourceFile:'new.pdf',importedAt:'2026-10-02T00:00:00Z'}}
const older={...dated,importedAt:'2026-10-01T00:00:00Z',statementSnapshot:{...snapshot,sourceFile:'old.pdf',importedAt:'2026-10-01T00:00:00Z'}}
assert.equal(mergeHistoricalBalances([dated],[older],[account])[0].statementSnapshot?.sourceFile,'new.pdf','stale device saves cannot replace newer verified holdings')
assert.equal(mergeHistoricalBalances([dated],[],[])[0].statementSnapshot?.sourceFile,'new.pdf','older clients omitting snapshots do not delete them')
console.log('Stale-device snapshot preservation passed')
// Earlier Schwab PDFs join or omit optional headings without changing the value columns.
const fullGain={...page,items:page.items.filter(t=>!['Yield','Income($)','2.00%','2.00'].includes(t.str)).map(t=>t.str==='Gain/(Loss)($)'?{...t,str:'Unrealized Gain/(Loss)($)'}:t)}
assert.equal(parseStatementHoldings([fullGain],'2025-09').complete,true)
const joinedGain={...page,items:page.items.filter(t=>t.str!=='Yield').map(t=>t.str==='Gain/(Loss)($)'?{...t,str:'Gain/(Loss)($) Est. Yield',width:110}:t)}
assert.equal(parseStatementHoldings([joinedGain],'2025-10').complete,true)
const zeroPage: PdfTextPage={page:3,items:[item('Positions - Summary',10,500),...['0.00','0.00','0.00','0.00','0.00','510.00','0.00','0.00'].map((n,i)=>item(n,20+i*90,460)),item('Transactions - Summary',10,400),...['510.00','0.00','0.00','0.00','0.00','0.00','0.00','510.00'].map((n,i)=>item(n,20+i*90,360)),item('Other Activity',10,340),item('$0.00',150,340)]}
assert.equal(parseStatementHoldings([zeroPage],'2026-04',510).complete,true)
assert.equal(parseStatementHoldings([zeroPage],'2026-04',510).cashOnly,true)
assert.equal(cleanStatementSnapshot(parseStatementHoldings([zeroPage],'2026-04',510))?.complete,true)
assert.equal(parseStatementHoldings([zeroPage],'2026-04',511).complete,false)
import { parseStatementTransactions } from '../src/lib/statement-transactions'
assert.equal(parseStatementTransactions([zeroPage],'2026-04','123','zero.pdf').complete,true)
assert.equal(parseStatementTransactions([zeroPage],'2026-04','123','zero.pdf').noActivity,true)
const moneyPage={...zeroPage,items:[...zeroPage.items,item('Cash and Cash Investments',10,700),item('Symbol',80,680),item('Description',130,680),item('Quantity',300,680),item('Price($)',360,680),item('Ending',480,690,55),item('Money Fund (Non-Sweep)',10,660,60),item('CASHX',80,660,25),item('Example money fund',130,660,100),item('100.00',300,660),item('1.00',360,660),item('100.00',505,660),item('Total Cash and Cash Investments',10,640)]}
const cashFund=parseStatementHoldings([moneyPage],'2026-04',610)
assert.equal(cashFund.complete,true)
assert.equal(cashFund.cashInvestments?.[0].marketValue,100)
assert.equal(cashFund.summaryCostBasis,0,'money-fund market value never fabricates securities cost basis')
assert.equal(cleanStatementSnapshot(JSON.parse(JSON.stringify(cashFund)))?.complete,true)
assert.equal(cleanStatementSnapshot({...cashFund,cashInvestments:[{...cashFund.cashInvestments![0],marketValue:Infinity}]}),undefined)
assert.equal(parseStatementTransactions([{...zeroPage,items:zeroPage.items.map(t=>t.y===340&&t.x===150?{...t,str:'1.00'}:t)}],'2026-04','123','nonzero-other.pdf').complete,false)
const offsetting={...zeroPage,items:zeroPage.items.map(t=>t.y===360&&t.x===110?{...t,str:'5.00'}:t.y===360&&t.x===200?{...t,str:'(5.00)'}:t)}
assert.equal(parseStatementTransactions([offsetting],'2026-04','123','offsetting.pdf').complete,false,'net-zero cash does not mean no activity')
console.log('Earlier layouts, cash-only months, non-sweep funds and verified inactivity passed')
