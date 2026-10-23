import { bankFundingCandidates } from '../lib/funding-cleanup'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { EquityGrowth } from '../lib/equity-growth'
import type { Transaction } from '../lib/types'
import { canPairFunding, isFundingCash } from '../lib/funding-review'
import { monthLabel, shortDate, usd } from '../lib/format'
import { useStore } from '../lib/store'
import { ImportModal } from './ImportModal'
import { AiFundingReview } from './AiFundingReview'

function FundingRecord({ txn, pool, onSelect }: { txn: Transaction; pool: Transaction[]; onSelect: (t: Transaction) => void }) {
  const { data, reviewFunding } = useStore()
  const [open, setOpen] = useState(false)
  const [partnerId, setPartnerId] = useState('')
  const review = txn.fundingReview
  const candidates = pool.filter((t) => canPairFunding(txn, t) && (t.fundingReview?.kind !== 'internal' || (review?.kind === 'internal' && t.fundingReview.pairId === review.pairId)))
  const partner = review?.kind === 'internal' ? pool.find((t) => t.id !== txn.id && t.fundingReview?.kind === 'internal' && t.fundingReview.pairId === review.pairId) : undefined
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? id
  return <div className="border-t border-white/[.06] py-3 text-xs">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <button onClick={() => onSelect(txn)} className="min-w-0 flex-1 text-left hover:text-[#e1c887]">
        <span className="block">{shortDate(txn.date)} · {txn.type}</span>
        <span className="mt-1 block break-words text-faint">{txn.description || 'No description'}</span>
        <span className="mt-1 block text-[#d8bd7a]">{review?.kind === 'external' ? 'Reviewed · outside funding' : review?.kind === 'internal' ? partner ? `Reviewed · transfer with ${accountName(partner.accountId)}` : 'Saved transfer · other leg missing from this range' : 'Open transaction to edit category'}</span>
      </button>
      <span className="num">{usd(txn.amount, { sign: true })}</span>
      {(isFundingCash(txn) || review?.kind === 'internal') && <button aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-md border border-white/10 px-2 py-1 text-[#e1c887]">{open ? 'Close review' : 'Review funding'}</button>}
    </div>
    {open && <div className="mt-3 space-y-3 rounded-lg bg-black/20 p-3">
      <p className="leading-5 text-muted">Outside funding moves money into or out of the selected portfolio. An internal transfer moves the same cash between two selected accounts.</p>
      {isFundingCash(txn) && <>
        <button onClick={() => reviewFunding(txn.id, 'external')} className="rounded-lg border border-[#c7a96b]/30 px-3 py-2 text-[#e1c887]">{txn.amount > 0 ? 'Mark as outside deposit' : 'Mark as outside withdrawal / spending'}</button>
        <label className="block text-muted">Match an internal transfer
          <select aria-label={`Transfer match for ${txn.id}`} value={candidates.some((t) => t.id === partnerId) ? partnerId : ''} onChange={(e) => setPartnerId(e.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-border bg-surface-2 p-2 text-ink">
            <option value="">Select the other transaction…</option>
            {candidates.map((t) => <option key={t.id} value={t.id}>{shortDate(t.date)} · {accountName(t.accountId)} · {usd(t.amount, { sign: true })} · {t.description}</option>)}
          </select>
        </label>
        {candidates.length === 0 ? <p className="text-faint">No equal, opposite cash movement in another selected account. Include both accounts and dates, or import the missing transaction.</p> : <button disabled={!candidates.some((t) => t.id === partnerId)} onClick={() => reviewFunding(txn.id, 'internal', partnerId)} className="rounded-lg border border-[#c7a96b]/30 px-3 py-2 text-[#e1c887] disabled:opacity-40">Confirm internal transfer</button>}
      </>}
      <div className="flex flex-wrap gap-3">
        <button onClick={() => onSelect(txn)} className="text-[#e1c887] underline">Edit transaction category</button>
        {review && review.kind !== 'auto' && <button onClick={() => reviewFunding(txn.id, 'auto')} className="text-muted underline">Clear funding decision</button>}
      </div>
      <p className="text-faint">Decisions save immediately and persist after sync. Clearing returns transfer matching to automatic; category corrections stay saved.</p>
    </div>}
  </div>
}

function FundingRecords({rows,pool,onSelect}:{rows:Transaction[];pool:Transaction[];onSelect:(t:Transaction)=>void}) {
  const [limit,setLimit]=useState(8)
  return <>{rows.slice(0,limit).map(t=><FundingRecord key={t.id} txn={t} pool={pool} onSelect={onSelect}/>)}{rows.length>limit&&<button onClick={()=>setLimit(limit+20)} className="mt-2 text-xs text-[#e1c887] underline">Show more records · {rows.length-limit} remaining</button>}</>
}
export function FundingAudit({ result: r, onSelect }: { result: EquityGrowth; onSelect: (t: Transaction) => void }) {
  const {data,confirmBankFunding}=useStore()
  const [onlyIssues, setOnlyIssues] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const needsReview = r.funding.filter(f => f.issues.length)
  const shown = r.funding.filter(f => !onlyIssues || f.issues.length).sort((a,b)=>a.month.localeCompare(b.month)||a.account.localeCompare(b.account))
  const pool = r.funding.flatMap(f => f.transactions)
  const matchedIds=new Set(r.transferMatches.flatMap(p=>[p.incoming.id,p.outgoing.id]))
  const unresolvedBankIds=new Set(needsReview.flatMap(f=>f.transactions.filter(t=>t.type==='Transfer').map(t=>t.id)))
  const routine=data.transactions.filter(t=>unresolvedBankIds.has(t.id))
  const bankCandidates=bankFundingCandidates(routine)
  const bankIds=new Set(bankCandidates.map(c=>c.id))
  const bankRows=routine.filter(t=>bankIds.has(t.id))
  const select=(t:Transaction)=>onSelect(data.transactions.find(current=>current.id===t.id)??t)
  return <details className="mt-3 rounded-xl border border-white/[.07] p-4" open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}>
    <summary className="cursor-pointer text-sm text-[#e1c887]">Funding review · {needsReview.length ? `${needsReview.length} account-month${needsReview.length===1?' needs':'s need'} attention` : 'Totals reconciled'}</summary>
    <p className="mt-3 text-xs leading-5 text-muted">Verified statement funding details take precedence over extra API activity for the same month. Your recorded equity growth stays available while any remaining funding exceptions are reviewed.</p>
    {bankCandidates.length>0&&<section aria-label="Routine bank transfer cleanup" className="mt-3 space-y-3 rounded-lg border border-[#c7a96b]/30 p-3 text-xs"><strong>{bankCandidates.length} routine bank transfers can be resolved together</strong><p className="leading-5 text-muted">These records explicitly name Schwab Bank as the source or destination. Confirming treats them as cash entering or leaving the selected brokerage portfolio. Existing internal-transfer decisions are excluded.</p><details><summary className="cursor-pointer text-[#e1c887]">Inspect bank transfers before confirming</summary><div className="mt-2 max-h-56 overflow-auto">{bankRows.map(t=><p key={t.id} className="border-t border-white/10 py-2">{shortDate(t.date)} · {data.accounts.find(a=>a.id===t.accountId)?.name} · {usd(t.amount,{sign:true})} · {t.description}</p>)}</div></details><button onClick={()=>confirmBankFunding(bankCandidates)} className="rounded-lg border border-[#c7a96b]/40 px-3 py-2 font-medium text-[#e1c887]">Confirm {bankCandidates.length} bank transfers as outside funding</button><p className="text-faint">Saves all decisions together and survives sync. Undo is available after applying.</p></section>}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs"><label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={onlyIssues} onChange={e=>setOnlyIssues(e.target.checked)} className="accent-[#c7a96b]"/>Only show months needing attention</label><div className="flex gap-3"><Link to="/transactions" className="text-[#e1c887] underline">Browse transactions</Link><button onClick={()=>setImportOpen(true)} className="text-[#e1c887] underline">Import missing records</button></div></div>
    {!shown.length&&<p role="status" className="mt-3 text-xs text-pos">{r.funding.length?'No funding exceptions in this range. Uncheck the filter to inspect reconciled months.':r.reason||'No funding details available.'}</p>}
    <div className="mt-3 space-y-2">{shown.map(f=>{
      const unresolved=f.transactions.filter(t=>(t.fundingReview?.kind==='internal'&&!matchedIds.has(t.id))||((t.type==='Transfer'||t.type==='Other')&&(isFundingCash(t)||t.units!==0)&&!matchedIds.has(t.id)&&t.fundingReview?.kind!=='external'))
      return <details key={`${f.accountId}-${f.month}`} className="rounded-lg border border-white/[.07] p-3"><summary className="cursor-pointer text-xs">{f.account} · {monthLabel(f.month)} <span className={f.issues.length?'text-[#e1c887]':'text-muted'}>· {f.issues.length?`${f.issues.length} exception${f.issues.length===1?'':'s'}`:'Reconciled'}</span></summary>
        {f.statementVerified&&<p className="mt-2 text-xs text-pos">Verified statement funding details used. Extra saved API activity is not counted again.</p>}
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">{([['Recorded deposits',f.deposits],['Deposit details',f.ledgerDeposits],['Recorded withdrawals',f.withdrawals],['Withdrawal details',f.ledgerWithdrawals],['Internal deposits excluded',f.internalDeposits]] as const).map(([label,amount])=><div key={label} className="flex justify-between gap-2"><dt className="text-muted">{label}</dt><dd className="num">{usd(amount)}</dd></div>)}</dl>
        {f.issues.map(issue=><p key={issue} className="mt-2 text-xs text-[#e1c887]">{issue}</p>)}
        {!!unresolved.length&&<div className="mt-3"><p className="text-xs font-medium">Records needing a decision · {unresolved.length}</p><FundingRecords rows={unresolved} pool={pool} onSelect={select}/></div>}
        <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted">Inspect all {f.transactions.length} cash records</summary>{f.transactions.length?<FundingRecords rows={f.transactions} pool={pool} onSelect={select}/>:<p className="mt-2 text-muted">No cash funding records in the available details. Import missing records if totals do not agree.</p>}</details>
      </details>
    })}</div>
    <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted">AI help for remaining exceptions</summary><AiFundingReview result={r} onImport={()=>setImportOpen(true)}/></details>
    {r.transferMatches.length>0&&<details className="mt-3 text-xs"><summary className="cursor-pointer text-muted">Matched internal transfers · {r.transferMatches.length} pairs</summary>{r.transferMatches.map(pair=><details key={pair.incoming.id} className="mt-2 rounded-lg border border-white/[.07] p-3"><summary className="cursor-pointer">{shortDate(pair.incoming.date)} · {usd(pair.incoming.amount)} · {pair.incoming.fundingReview?.kind==='internal'?'Confirmed':'Automatically matched'}</summary>{[pair.outgoing,pair.incoming].map(t=><FundingRecord key={t.id} txn={t} pool={pool} onSelect={select}/>)}</details>)}</details>}
    {importOpen&&<ImportModal open onClose={()=>setImportOpen(false)}/>}
  </details>
}
