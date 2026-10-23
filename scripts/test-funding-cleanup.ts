import assert from 'node:assert/strict'
import { fundingLedger, bankFundingCandidates, saveBankFundingBatch } from '../src/lib/funding-cleanup'
import { isFundingCash, fundingTransfers } from '../src/lib/funding-review'
import { transactionReviewFingerprint } from '../src/lib/transaction-review'
import type { Account, AppData, StatementTransactions, Transaction } from '../src/lib/types'
import type { StatementMonth } from '../src/lib/statement-history'
const accounts=[{id:'a',mask:'1234'} as Account]
const bank:Transaction={id:'bank',accountId:'a',date:'2026-09-01',type:'Transfer',description:'Deposit Journaled Funds TRANSFER FUNDS FROM SCHW AB BANK - 999999999999',amount:2000,units:0,tags:[],statement:{key:'bank-key',date:'2026-09-01',page:3,row:1,fileName:'fixture.pdf'}}
const journal={...bank,id:'journal',description:'JOURNAL',amount:12,statement:undefined}
const snapshot={accountMask:'1234',month:'2026-09',source:'Schwab statement',deposits:2000,withdrawals:0} as StatementMonth['statements'][number]
const rows=[{month:'2026-09',statements:[snapshot]} as StatementMonth]
const group={accountMask:'1234',month:'2026-09',fileName:'fixture.pdf',importedAt:'2026-10-01',issues:[],complete:true,transactions:[{...bank,type:'Contribution'}]} as StatementTransactions
const resolved=fundingLedger(rows,[bank,journal],accounts,[group])
assert.equal(resolved.transactions.length,1)
assert.equal(resolved.transactions[0].type,'Contribution')
assert.equal(resolved.verifiedMonths.size,1)
assert.equal(fundingLedger(rows,[bank,journal],accounts,[{...group,complete:false}]).verifiedMonths.size,0)
assert.equal(fundingLedger(rows,[journal],accounts,[group]).verifiedMonths.size,0,'missing funding rows cannot be silently approved')
assert.equal(fundingLedger(rows,[bank,journal],accounts,[{...group,transactions:[{...bank,type:'Contribution',amount:1999}]}]).verifiedMonths.size,0)
assert.equal(fundingLedger(rows,[{...bank,classificationSource:'manual'},journal],accounts,[group]).transactions[0].type,'Transfer','explicit manual categories are preserved')
assert.equal(isFundingCash({...bank,description:'BROKERAGE SWEEP TO BANK'}),false)
assert.equal(isFundingCash({...bank,description:'BANK SWEEP FR BROKERAGE'}),false)
assert.equal(isFundingCash({...bank,description:'OBATCH SMA ADJPRBADSNA',amount:2}),false)
assert.equal(isFundingCash(journal),true,'an unexplained journal remains unresolved')
const candidates=bankFundingCandidates([bank,journal])
assert.equal(candidates.length,1)
const data={accounts,transactions:[bank,journal],transactionOverrides:{}} as AppData
assert.equal(saveBankFundingBatch(data,candidates),1)
assert.equal(data.transactions[0].fundingReview?.kind,'external')
assert.equal(data.transactions[0].type,'Contribution')
assert.equal(fundingTransfers(data.transactions).pairs.length,0)
const changed={...bank,amount:2001}
assert.equal(saveBankFundingBatch({...data,transactions:[changed]},[{id:bank.id,fingerprint:transactionReviewFingerprint(bank)}]),0)
assert.equal(bankFundingCandidates([{...bank,fundingReview:{kind:'internal',pairId:'reserved'}}]).length,0)
console.log('Funding statement authority, bookkeeping exclusions and guarded bulk decisions passed')
import { equityGrowth } from '../src/lib/equity-growth'
import { snapshotFlows } from '../src/lib/balance-snapshots'
import { cleanTransactionOverrides, applyTransactionOverrides } from '../src/lib/transaction-overrides'
const fullRows=[{...rows[0],complete:true,openingEquity:1000,closingEquity:3000,deposits:2000,withdrawals:0,statements:[{...snapshot,openingEquity:1000,closingEquity:3000}]}] as StatementMonth[]
const journalRows=[{...bank,type:'Transfer' as const,classificationSource:undefined,fundingReview:undefined},journal,{...journal,id:'duplicate-out',type:'Bill Payment' as const,amount:-12}]
const cleanResult=equityGrowth(fullRows,journalRows,accounts,'','2026-09-30',[group])
assert.equal(cleanResult.fundingNeedsReview,false)
assert.equal(cleanResult.value,0)
assert.equal(cleanResult.funding[0].ledgerDeposits,2000)
assert.equal(Math.abs(cleanResult.funding[0].ledgerWithdrawals),0)
assert.equal(cleanResult.funding[0].statementVerified,true)
assert.equal(equityGrowth(fullRows,[...journalRows,{...bank,id:'same-key'}],accounts,'','2026-09-30',[group]).fundingNeedsReview,true,'duplicate saved statement identities remain blocked')
assert.equal(snapshotFlows([{...bank,type:'Transfer',description:'OBATCH SMA ADJPRBADSNA',fundingReview:undefined}], 'a','2026-09-30',true).reviewRequired,false)
const otherAccount={...bank,id:'bank-out',accountId:'b',amount:-2000,type:'Withdrawal' as const,description:'TRANSFER FUNDS TO SCHWAB BANK - 999999999999',fundingReview:undefined}
assert.equal(fundingTransfers([{...bank,type:'Contribution',fundingReview:undefined},otherAccount]).pairs.length,0,'bank-boundary flows never auto-match just because amounts agree')
const persisted=cleanTransactionOverrides(JSON.parse(JSON.stringify(data.transactionOverrides)))
const reloaded:Transaction[]=[{...bank,id:'new-id',type:'Transfer' as const,fundingReview:undefined}]
applyTransactionOverrides(reloaded,accounts,persisted)
assert.equal(reloaded[0].fundingReview?.kind,'external','batch decisions survive changed API ids and reload')
console.log('Statement-ledger reconciliation, mismatch guards, snapshot bookkeeping and durable batch decisions passed')
const explicitExtra={...journal,id:'manual-extra',type:'Contribution' as const,fundingReview:{kind:'external' as const}}
assert.equal(equityGrowth(fullRows,[...journalRows,explicitExtra],accounts,'','2026-09-30',[group]).fundingNeedsReview,true,'statement authority must not discard an explicit funding decision on an extra row')
const manualExtra={...journal,id:'manual-category-extra',type:'Contribution' as const,fundingReview:undefined,classificationSource:'manual' as const}
assert.equal(equityGrowth(fullRows,[...journalRows,manualExtra],accounts,'','2026-09-30',[group]).fundingNeedsReview,true,'manual funding categories on extra rows must stay visible')
assert.equal(snapshotFlows([journal], 'a','2026-09-30',true).reviewRequired,true,'unexplained API journals cannot be dismissed without statement evidence')
