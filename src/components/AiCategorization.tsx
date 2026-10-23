import { useState } from 'react'
import { AI_BATCH_SIZE, AI_CATEGORIES, aiCategoryInput, aiCategoryFingerprint, suggestionIsCurrent, type PendingAiCategory } from '../lib/ai-categorization'
import { isTransactionReviewed } from '../lib/transaction-review'
import { normalizeTransactionPattern, transactionPatternMatches } from '../lib/transaction-classification'
import { shortDate, usd } from '../lib/format'
import { useStore } from '../lib/store'
import type { Transaction, TxnType } from '../lib/types'
import { Button } from './ui'

export function AiCategorization({ transactions, selectedIds }: { transactions: Transaction[]; selectedIds: string[] }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [suggestions, setSuggestions] = useState<PendingAiCategory[]>([])
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const candidates = selectedIds.length ? transactions.filter((t) => selectedIds.includes(t.id) && !skipped.has(t.id)) : transactions.filter((t) => ['Other', 'Transfer'].includes(t.type) && !['manual', 'rule'].includes(t.classificationSource ?? '') && !isTransactionReviewed(t) && !skipped.has(t.id))
  const run = async () => {
    const batch = candidates.slice(0, AI_BATCH_SIZE)
    if (!batch.length) return
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch('/.netlify/functions/ai-categorize', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Simonfire-Ai-Request': '1' }, body: JSON.stringify({ transactions: batch.map(aiCategoryInput) }), signal: AbortSignal.timeout(35_000) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'AI is unavailable. No categories were changed.')
      setSuggestions(body.suggestions.map((s: PendingAiCategory) => {
        const row = batch[Number(s.id.slice(1))]
        if (!row) throw new Error('Invalid AI response. Please retry.')
        return { ...s, transactionId: row.id, fingerprint: aiCategoryFingerprint(row) }
      }))
    } catch (e) { setError(e instanceof Error && e.name !== 'SyntaxError' ? e.message : 'AI needs the deployed Netlify functions. No categories were changed.') }
    finally { setBusy(false) }
  }
  const dismiss = (s: PendingAiCategory, accepted: boolean) => {
    setSuggestions((rows) => rows.filter((r) => r.transactionId !== s.transactionId))
    setSkipped((old) => new Set([...old, s.transactionId]))
    setMessage(accepted ? 'Category saved. Review status remains separate.' : 'Suggestion skipped. The transaction is unchanged.')
  }
  return <section className="card mb-4 p-4" aria-label="AI categorization">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Let AI help categorize</h2><p className="mt-1 text-xs text-muted">{selectedIds.length ? `${candidates.length} selected transactions` : `${candidates.length} recent unresolved transactions in this view`}. Review up to {AI_BATCH_SIZE} suggestions at a time.</p></div><Button onClick={run} disabled={busy || !candidates.length || !!suggestions.length}>{busy ? 'Finding categories…' : selectedIds.length ? 'Suggest for selected' : 'Suggest categories'}</Button></div>
    <p className="mt-3 text-xs text-faint">Requesting suggestions sends descriptions (with long numeric references redacted), symbols, amounts, units, and current categories to OpenAI. Account, balance, and date fields are excluded. Nothing changes until you accept. Confidence is the AI’s assessment, not a guarantee.</p>
    {error && <p role="alert" className="mt-3 text-xs text-neg">{error}</p>}
    {message && <p role="status" className="mt-3 text-xs text-muted">{message}</p>}
    {!!suggestions.length && <div className="mt-4 space-y-3"><div className="flex justify-between text-xs text-muted"><span>{suggestions.length} suggestions to review</span><button onClick={() => setSuggestions([])} className="text-brand">Dismiss batch</button></div>{suggestions.map((s) => <Suggestion key={s.transactionId} suggestion={s} onDone={(accepted) => dismiss(s, accepted)}/>)}</div>}
  </section>
}
function Suggestion({ suggestion: s, onDone }: { suggestion: PendingAiCategory; onDone: (accepted: boolean) => void }) {
  const { data, updateTransaction, addRule } = useStore()
  const row = data.transactions.find((t) => t.id === s.transactionId)
  const [category, setCategory] = useState<TxnType>(s.category)
  const [remember, setRemember] = useState(false)
  const current = suggestionIsCurrent(s, row)
  const pattern = row ? normalizeTransactionPattern(row.description) : ''
  const direction = row && row.amount > 0 ? 'positive' : row && row.amount < 0 ? 'negative' : 'zero'
  const matches = data.transactions.filter((t) => pattern && transactionPatternMatches(t.description, pattern) && (direction === 'positive' ? t.amount > 0 : direction === 'negative' ? t.amount < 0 : t.amount === 0) && t.classificationSource !== 'manual').length
  const accept = () => {
    if (!row || !suggestionIsCurrent(s, row)) return
    updateTransaction(row.id, { type: category })
    if (remember && pattern.length >= 10) addRule({ contains: pattern, amountDirection: direction, setType: category, tag: '', enabled: true })
    onDone(true)
  }
  return <div className="rounded-xl border border-border-soft p-4 text-xs">
    <div className="flex flex-wrap justify-between gap-2"><strong>{row?.description ?? 'Transaction removed'}</strong><span>{row ? `${shortDate(row.date)} · ${usd(row.amount, { sign: true })}` : ''}</span></div>
    <div className="mt-2 text-muted">Current: {row?.type ?? 'Unavailable'} · Suggested: {s.category} · {s.confidence} confidence</div><p className="mt-2 leading-5 text-muted">{s.reason}</p>
    {!current && <p className="mt-2 text-neg">This transaction changed or was removed. Request a new suggestion before accepting.</p>}
    <div className="mt-3 flex flex-wrap items-center gap-3"><label>Category <select aria-label={`Category for ${row?.description ?? s.transactionId}`} value={category} onChange={(e) => setCategory(e.target.value as TxnType)} className="ml-2 rounded-lg border border-border bg-surface-2 px-2 py-1.5">{AI_CATEGORIES.map((type) => <option key={type}>{type}</option>)}</select></label><Button disabled={!current} onClick={accept}>Accept category</Button><Button onClick={() => onDone(false)}>Skip</Button></div>
    <label className="mt-3 flex items-start gap-2 text-faint"><input type="checkbox" checked={remember} disabled={!current || pattern.length < 10} onChange={(e) => setRemember(e.target.checked)}/><span>Also save a rule for matching descriptions and cash direction. This may reclassify {matches} existing non-manual records across accounts and applies to future imports.</span></label>
  </div>
}
