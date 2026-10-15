import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { EquityGrowth } from '../lib/equity-growth'
import type { Transaction } from '../lib/types'
import { canPairFunding, isFundingCash } from '../lib/funding-review'
import { monthLabel, shortDate, usd } from '../lib/format'
import { useStore } from '../lib/store'
import { ImportModal } from './ImportModal'

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

export function FundingAudit({ result: r, onSelect }: { result: EquityGrowth; onSelect: (t: Transaction) => void }) {
  const [onlyIssues, setOnlyIssues] = useState(true)
  const [expanded, setExpanded] = useState(r.fundingNeedsReview)
  const [importOpen, setImportOpen] = useState(false)
  const needsReview = r.funding.filter((f) => f.issues.length)
  const shown = [...r.funding].filter((f) => !onlyIssues || f.issues.length).sort((a, b) => Number(b.issues.length > 0) - Number(a.issues.length > 0) || a.month.localeCompare(b.month))
  const pool = r.funding.flatMap((f) => f.transactions)
  return <details className="mt-3 rounded-xl border border-white/[.07] p-4" open={expanded} onToggle={(e) => setExpanded(e.currentTarget.open)}>
    <summary className="cursor-pointer text-sm text-[#e1c887]">Review funding by account and month · {needsReview.length ? `${needsReview.length} need review` : 'Totals reconciled'}</summary>
    <p className="mt-3 text-xs leading-5 text-muted">Resolve differences by importing missing transactions, correcting categories, or confirming transfers. A review clears when the totals and classifications reconcile.</p>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
      <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} className="accent-[#c7a96b]"/>Only show accounts and months needing review</label>
      <div className="flex flex-wrap items-center gap-3"><Link to="/transactions" className="text-[#e1c887] underline">Browse transactions</Link><button onClick={() => setImportOpen(true)} className="rounded-lg border border-[#c7a96b]/30 px-3 py-2 text-[#e1c887]">Import missing records</button></div>
    </div>
    {!shown.length && <p role="status" className="mt-3 text-xs text-pos">{r.funding.length ? 'No funding issues in this range. Uncheck the filter to inspect reconciled records.' : r.reason || 'No account funding details are available.'}</p>}
    <div className="mt-3 space-y-2">{shown.map((f) => <details key={`${f.accountId}-${f.month}`} className="rounded-lg border border-white/[.07] p-3" open={f.issues.length > 0}>
      <summary className="cursor-pointer text-xs">{f.account} · {monthLabel(f.month)} <span className={f.issues.length ? 'text-[#e1c887]' : 'text-muted'}>· {f.issues.length ? `${f.issues.length} issue${f.issues.length === 1 ? '' : 's'}` : 'Totals reconciled'}</span></summary>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">{([['Recorded deposits', f.deposits], ['Deposit transaction total', f.ledgerDeposits], ['Recorded withdrawals', f.withdrawals], ['Withdrawal transaction total', f.ledgerWithdrawals], ['Internal deposits excluded', f.internalDeposits]] as const).map(([label, amount]) => <div key={label} className="flex flex-wrap justify-between gap-2"><dt className="text-muted">{label}</dt><dd className="num">{usd(amount)}</dd></div>)}</dl>
      {([['Deposit', f.deposits - f.ledgerDeposits], ['Withdrawal', f.withdrawals - f.ledgerWithdrawals]] as const).filter(([, difference]) => Math.abs(difference) > .01).map(([label, difference]) => <p key={label} className="mt-2 text-xs text-[#e1c887]">{label} difference: <span className="num">{usd(Math.abs(difference))}</span> {difference > 0 ? 'missing from transaction totals' : 'more in transactions than the recorded total'}. Check missing records, duplicate entries, and categories.</p>)}
      {f.issues.map((issue) => <p key={issue} className="mt-2 text-xs text-[#e1c887]">{issue}</p>)}
      <div className="mt-3">{f.transactions.length ? f.transactions.map((t) => <FundingRecord key={t.id} txn={t} pool={pool} onSelect={onSelect}/>) : <p className="text-xs text-muted">No funding transaction details for this account and month. Import its statement with transaction details or a transaction CSV.</p>}</div>
    </details>)}</div>
    {r.transferMatches.length > 0 && <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted">Matched internal transfers · {r.transferMatches.length} pairs</summary>{r.transferMatches.map((pair) => <div key={pair.incoming.id} className="mt-2 rounded-lg border border-white/[.07] p-3">
      <p className="mb-2 text-faint">{pair.incoming.fundingReview?.kind === 'internal' ? 'Confirmed by you' : 'Automatic estimate · review the records to confirm or correct'}</p>
      {[pair.outgoing, pair.incoming].map((t) => <FundingRecord key={t.id} txn={t} pool={pool} onSelect={onSelect}/>)}</div>)}</details>}
    {importOpen && <ImportModal open onClose={() => setImportOpen(false)}/>}
  </details>
}
