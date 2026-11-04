import { useMemo, useState } from 'react'
import { ArrowRight, ArrowLeftRight, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { fundingTransfers, transferSuggestions, unmatchedTransfers, type TransferSuggestion } from '../lib/funding-review'
import { shortDate, usd } from '../lib/format'
import { useStore } from '../lib/store'
import type { Transaction } from '../lib/types'
import { Button } from './ui'

// Moving money between your own Schwab accounts is not spending. This panel
// pairs the money-out leg with the matching deposit so only money that really
// leaves Schwab is counted once.
export function TransferMatcher({ onSelect }: { onSelect: (t: Transaction) => void }) {
  const { data, reviewFunding } = useStore()
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? id
  const { pairs, suggestions, unmatched } = useMemo(() => {
    const suggestions = transferSuggestions(data.transactions)
    const suggested = new Set(suggestions.map((s) => s.outgoing.id))
    return { pairs: fundingTransfers(data.transactions).pairs.sort((a, b) => b.outgoing.date.localeCompare(a.outgoing.date)), suggestions, unmatched: unmatchedTransfers(data.transactions, suggested) }
  }, [data.transactions])
  const todo = suggestions.length + unmatched.length
  const [open, setOpen] = useState(todo > 0)
  const [limit, setLimit] = useState(10)
  const notTransfer = (out: Transaction, deposit: Transaction) => { reviewFunding(out.id, 'external'); reviewFunding(deposit.id, 'external') }

  return <details className="card mb-4 p-0" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4">
      <ArrowLeftRight size={17} className="text-brand" />
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Transfers between your accounts</h2>
        <p className="text-xs text-muted">{pairs.length} matched · not counted as spending{todo > 0 && <span className="text-[#e7c88f]"> · {todo} to review</span>}</p>
      </div>
      <ChevronRight size={16} className={clsx('ml-auto text-faint transition-transform', open && 'rotate-90')} />
    </summary>
    <div className="space-y-5 border-t border-border-soft p-4">
      <p className="text-xs text-muted">When money moves from one of your Schwab accounts to another, match the two sides. Matched transfers are left out of spending, bill averages and cash flow, so only money that leaves Schwab counts.</p>

      {suggestions.length > 0 && <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[.12em] text-faint">Possible transfers · {suggestions.length}</h3>
        <div className="space-y-2">{suggestions.slice(0, limit).map((s) => <SuggestionRow key={s.outgoing.id} suggestion={s} accountName={accountName} onSelect={onSelect}
          onMatch={(depositId) => reviewFunding(s.outgoing.id, 'internal', depositId)} onOutside={() => reviewFunding(s.outgoing.id, 'external')} />)}</div>
        {suggestions.length > limit && <button onClick={() => setLimit(limit + 20)} className="mt-2 text-xs font-semibold text-brand">Show {Math.min(20, suggestions.length - limit)} more</button>}
      </section>}

      {unmatched.length > 0 && <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-[.12em] text-faint">Transfers with no match · {unmatched.length}</h3>
        <p className="mb-2 text-xs text-faint">No equal deposit in your other accounts. If the money went to a Schwab account that isn't in the app, connect or import it. If it went to an outside bank or bill, mark it as leaving Schwab.</p>
        <div className="space-y-2">{unmatched.slice(0, 10).map((t) => <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border-soft bg-surface-2/30 p-3 text-xs">
          <button onClick={() => onSelect(t)} className="min-w-0 flex-1 text-left hover:text-[#e1c887]"><span className="font-medium">{shortDate(t.date)} · {accountName(t.accountId)}</span><span className="block truncate text-faint">{t.description}</span></button>
          <span className={clsx('num font-semibold', t.amount < 0 ? 'text-neg' : 'text-pos')}>{usd(t.amount, { sign: true })}</span>
          <Button onClick={() => reviewFunding(t.id, 'external')}>{t.amount < 0 ? 'It left Schwab' : 'Outside deposit'}</Button>
        </div>)}</div>
      </section>}

      {todo === 0 && <p role="status" className="text-xs text-pos">Nothing to review. Every transfer with a matching deposit is paired.</p>}

      {pairs.length > 0 && <details className="text-xs">
        <summary className="cursor-pointer font-semibold text-muted">Matched transfers · {pairs.length}</summary>
        <div className="mt-2 space-y-2">{pairs.slice(0, 50).map((p) => <div key={p.outgoing.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border-soft p-2.5">
          <span className="text-faint">{shortDate(p.outgoing.date)}</span>
          <button onClick={() => onSelect(p.outgoing)} className="font-medium hover:text-[#e1c887]">{accountName(p.outgoing.accountId)}</button>
          <ArrowRight size={12} className="text-faint" />
          <button onClick={() => onSelect(p.incoming)} className="font-medium hover:text-[#e1c887]">{accountName(p.incoming.accountId)}</button>
          <span className="num">{usd(-p.outgoing.amount)}</span>
          <span className="text-faint">{p.outgoing.fundingReview?.kind === 'internal' ? 'matched by you' : 'matched automatically'}</span>
          <button onClick={() => p.outgoing.fundingReview?.kind === 'internal' ? reviewFunding(p.outgoing.id, 'auto') : notTransfer(p.outgoing, p.incoming)} className="ml-auto text-muted underline hover:text-ink">{p.outgoing.fundingReview?.kind === 'internal' ? 'Unmatch' : 'Not a transfer'}</button>
        </div>)}</div>
      </details>}
    </div>
  </details>
}

function SuggestionRow({ suggestion: { outgoing, candidates }, accountName, onMatch, onOutside, onSelect }: {
  suggestion: TransferSuggestion; accountName: (id: string) => string; onMatch: (depositId: string) => void; onOutside: () => void; onSelect: (t: Transaction) => void
}) {
  const [pick, setPick] = useState(candidates[0].id)
  const chosen = candidates.find((c) => c.id === pick) ?? candidates[0]
  const days = Math.round(Math.abs(Date.parse(chosen.date) - Date.parse(outgoing.date)) / 86_400_000)
  return <div className="rounded-lg border border-[#c7a96b]/20 bg-[#c7a96b]/[.03] p-3 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => onSelect(outgoing)} className="text-left hover:text-[#e1c887]"><span className="font-medium">{accountName(outgoing.accountId)}</span> <span className="text-faint">{shortDate(outgoing.date)} · {outgoing.type}</span></button>
      <ArrowRight size={12} className="text-faint" />
      {candidates.length === 1
        ? <button onClick={() => onSelect(chosen)} className="text-left hover:text-[#e1c887]"><span className="font-medium">{accountName(chosen.accountId)}</span> <span className="text-faint">{shortDate(chosen.date)}</span></button>
        : <select aria-label="Matching deposit" value={pick} onChange={(e) => setPick(e.target.value)} className="rounded-md border border-border bg-surface-2 px-2 py-1 text-ink">{candidates.map((c) => <option key={c.id} value={c.id}>{accountName(c.accountId)} · {shortDate(c.date)}</option>)}</select>}
      <span className="num ml-auto font-semibold">{usd(-outgoing.amount)}</span>
    </div>
    <p className="mt-1 truncate text-faint">{outgoing.description}{days > 0 ? ` · deposit ${days} day${days === 1 ? '' : 's'} apart` : ' · same day'}{candidates.length > 1 ? ` · ${candidates.length} possible deposits` : ''}</p>
    <div className="mt-2 flex flex-wrap gap-2"><Button variant="primary" onClick={() => onMatch(chosen.id)}>Match transfer</Button><Button onClick={onOutside}>It left Schwab</Button></div>
  </div>
}
