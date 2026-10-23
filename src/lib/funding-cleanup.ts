import type { Account, AppData, StatementTransactions, Transaction } from './types'
import type { StatementMonth } from './statement-history'
import { statementAccount } from './statement-history'
import { isFundingCash, isKnownBankFunding } from './funding-review'
import { transactionReviewFingerprint } from './transaction-review'
import { recordTransactionOverride, applyTransactionOverrides } from './transaction-overrides'

// A verified statement's cash funding rows outrank extra API bookkeeping rows
// for that account/month. Require every funding row to exist in the saved ledger
// and the statement deposits/withdrawals to reconcile independently first.
export function fundingLedger(rows: StatementMonth[], transactions: Transaction[], accounts: Account[], groups: StatementTransactions[]) {
  const replacements=new Map<string,Transaction[]>()
  const verifiedMonths=new Set<string>()
  for(const row of rows)for(const statement of row.statements){
    if(statement.source!=='Schwab statement')continue
    const account=statementAccount(statement,accounts)
    if(!account)continue
    const group=groups.filter(g=>g.complete&&g.month===row.month&&statementAccount(g,accounts)?.id===account.id).sort((a,b)=>b.importedAt.localeCompare(a.importedAt))[0]
    if(!group)continue
    const deposit=group.transactions.filter(t=>t.type==='Contribution').reduce((n,t)=>n+t.amount,0)
    const withdrawal=group.transactions.filter(t=>['Withdrawal','Bill Payment'].includes(t.type)).reduce((n,t)=>n+t.amount,0)
    if(Math.abs(deposit-statement.deposits)>.01||Math.abs(withdrawal-statement.withdrawals)>.01)continue
    const funding=group.transactions.filter(t=>isFundingCash(t as Transaction))
    if(new Set(funding.map(t=>t.statement?.key)).size!==funding.length)continue
    const mapped: Transaction[]=[]
    let valid=true
    for(const raw of funding){
      const matches=transactions.filter(t=>t.accountId===account.id&&!!raw.statement?.key&&t.statement?.key===raw.statement.key)
      if(matches.length!==1||matches[0].amount!==raw.amount||matches[0].units!==raw.units||matches[0].date.slice(0,7)!==row.month){valid=false;break}
      const saved=matches[0]
      mapped.push({...saved,...raw,id:saved.id,accountId:account.id,date:saved.date,review:saved.review,fundingReview:saved.fundingReview,tags:saved.tags,
        ...(saved.classificationSource==='manual'?{type:saved.type,classificationSource:'manual' as const}:{}),
        ...(saved.symbolSource==='manual'?{symbol:saved.symbol,symbolSource:'manual' as const}:{})})
    }
    if(valid){
      const mappedIds=new Set(mapped.map(t=>t.id))
      mapped.push(...transactions.filter(t=>t.accountId===account.id&&t.date.slice(0,7)===row.month&&!mappedIds.has(t.id)&&((!!t.fundingReview&&t.fundingReview.kind!=='auto')||(t.classificationSource==='manual'&&['Contribution','Withdrawal','Bill Payment','Transfer','Other'].includes(t.type)&&(t.amount!==0||t.units!==0)))))
      const key=`${account.id}|${row.month}`;replacements.set(key,mapped);verifiedMonths.add(key)}
  }
  return {transactions:[...transactions.filter(t=>!replacements.has(`${t.accountId}|${t.date.slice(0,7)}`)),...[...replacements.values()].flat()],verifiedMonths}
}
export interface BankFundingCandidate { id: string; fingerprint: string }
export function bankFundingCandidates(transactions: Transaction[]): BankFundingCandidate[] {
  return transactions.filter(t=>isFundingCash(t)&&t.type==='Transfer'&&(!t.fundingReview||t.fundingReview.kind==='auto')&&isKnownBankFunding(t))
    .map(t=>({id:t.id,fingerprint:transactionReviewFingerprint(t)}))
}
export function saveBankFundingBatch(data: AppData, candidates: BankFundingCandidate[]) {
  if(!candidates.length||new Set(candidates.map(c=>c.id)).size!==candidates.length)return 0
  const current=new Map(bankFundingCandidates(data.transactions).map(c=>[c.id,c.fingerprint]))
  if(candidates.some(c=>current.get(c.id)!==c.fingerprint))return 0
  const ids=new Set(candidates.map(c=>c.id)), selected=data.transactions.filter(t=>ids.has(t.id))
  let overrides=data.transactionOverrides??{}
  for(const positive of [true,false]){
    const group=selected.filter(t=>(t.amount>0)===positive).map(t=>t.id)
    if(group.length)overrides=recordTransactionOverride(data.transactions,data.accounts,overrides,group,{fundingReview:{kind:'external'},type:positive?'Contribution':'Withdrawal'})
  }
  data.transactionOverrides=overrides
  applyTransactionOverrides(data.transactions,data.accounts,overrides)
  return selected.length
}
