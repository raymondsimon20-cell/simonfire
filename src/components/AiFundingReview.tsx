import { useLayoutEffect, useRef, useState } from 'react'
import type { EquityGrowth } from '../lib/equity-growth'
import { fundingInput, validateFundingAdvice, type FundingAdvice } from '../lib/ai-funding'
import { useReviewCache } from '../lib/use-review-cache'
import { useStore } from '../lib/store'
import { monthLabel } from '../lib/format'
interface SavedReview { fingerprint: string; advice: FundingAdvice; createdAt: string }
export function AiFundingReview({ result, onImport }: { result: EquityGrowth; onImport: () => void }) {
  const { data, scope } = useStore()
  const groups = result.funding.filter(f => f.issues.length).slice(0, 6)
  const input = fundingInput(result)
  const cacheScope = `${data.source ?? 'sample'}:${scope}`
  // Include complete records and manual decisions locally; none of these identifiers go to AI.
  const fingerprint = JSON.stringify([cacheScope, result.from, result.to, result.funding])
  const current = useRef(fingerprint)
  useLayoutEffect(() => { current.current = fingerprint }, [fingerprint])
  const [cache, setCache, saveError] = useReviewCache<Record<string, SavedReview>>('simonfire:ai-funding:v1', {})
  const saved = cache[cacheScope]
  const stale = !!saved && saved.fingerprint !== fingerprint
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function review() {
    if (busy || !groups.length) return
    setBusy(true); setError('')
    const started = fingerprint
    try {
      const response = await fetch('/.netlify/functions/ai-funding', { method: 'POST', signal: AbortSignal.timeout(35000), headers: { 'Content-Type': 'application/json', 'x-simonfire-ai-request': '1' }, body: JSON.stringify(input) })
      const body = await response.json()
      if (!response.ok) throw Error(typeof body.error === 'string' ? body.error : 'AI is unavailable. Please retry.')
      const advice = validateFundingAdvice(body, input)
      if (current.current !== started) throw Error('Funding data changed during the review. Run it again for the current records.')
      setCache(previous => ({ ...previous, [cacheScope]: { fingerprint: started, advice, createdAt: new Date().toISOString() } }))
    } catch (e) { setError(e instanceof Error ? e.message : 'AI could not finish. Please retry.') }
    finally { setBusy(false) }
  }
  return <section aria-label="AI funding assistance" className="mt-4 space-y-3 rounded-lg border border-[#c7a96b]/25 bg-black/10 p-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-3"><strong>AI funding assistance</strong><button disabled={busy || !groups.length} onClick={review} className="rounded-lg border border-[#c7a96b]/30 px-3 py-2 text-[#e1c887] disabled:opacity-40">{busy ? 'Reviewing funding…' : saved ? 'Refresh AI funding review' : 'Review funding with AI'}</button></div>
    <p className="leading-5 text-muted">Sends monthly funding totals and up to 12 redacted transaction descriptions per month to OpenAI for up to six account/months needing review. Account names and identifiers are excluded. AI explains possible causes; confirm changes using the funding controls below.</p>
    {result.funding.filter(f => f.issues.length).length > 6 && <p className="text-muted">Reviewing the first six account/months. Resolve those issues to bring the next ones into view.</p>}
    {error && <p role="alert" className="text-[#e1c887]">{error}</p>}
    {saveError && <p role="alert" className="text-[#e1c887]">This review could not be saved on this device. Keep this page open or try again after enabling browser storage.</p>}
    {saved && <><p className="text-faint">Saved {new Date(saved.createdAt).toLocaleString()} · guidance only</p>{stale ? <p role="status" className="text-[#e1c887]">Funding records or the selected range changed. Refresh the AI review for current guidance.</p> : saved.advice.advice.map(a => {
      const group = groups[Number(a.id.slice(1))]
      return group && <div key={a.id} className="space-y-2 border-t border-white/10 pt-3"><strong>{group.account} · {monthLabel(group.month)}</strong><p className="leading-5 text-muted">{a.explanation}</p><p className="leading-5">Next step: {a.nextStep}</p><p className="text-faint">Inspect this account/month below to confirm transfers or edit categories.</p></div>
    })}</>}
    <button onClick={onImport} className="text-[#e1c887] underline">Import missing records</button>
  </section>
}
