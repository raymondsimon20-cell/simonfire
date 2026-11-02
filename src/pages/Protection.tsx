import { PortfolioProtection } from '../components/PortfolioProtection'
import { type ProtectionAiEvidence, type ProtectionOrderDraft } from '../lib/portfolio-protection'
import { useReviewCache } from '../lib/use-review-cache'
import { type AiHedgeContext } from '../lib/ai-allocation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Copy, Check, ShieldCheck, LoaderCircle, ChevronRight, ListChecks, ClipboardList } from 'lucide-react'
import { useScoped, useStore } from '../lib/store'
import { normTicker } from '../lib/plan'
import { usd, pct, intfmt, shortDate } from '../lib/format'
import { PageHeader, Button } from '../components/ui'
import { Modal } from '../components/Modal'
import { SummaryMetric } from '../components/SummaryMetric'
import { schwabOrderStatus, schwabPlaceOption, schwabPreviewOption, schwabPutChain, type PutQuote } from '../lib/api'
import clsx from 'clsx'
import type { Account, HedgeRoll, Position } from '../lib/types'
import { existingProxyPutOffset, putPlanMatchesContract, buildPutCloseOrder, buildPutPreviewOrder, isActiveProtectivePut, portfolioPutHedge, protectivePutOutcome, protectivePutPlan, putRollTiming, rankProtectivePut } from '../lib/hedge'
import { usePersistentState } from '../lib/persistent-state'
import { brokerageDate } from '../lib/balance-snapshots'
import { protectionContextKey } from '../lib/protection-context'

export default function Protection() {
  const { positions, scope } = useScoped()
  const { data } = useStore()
  const cacheScope = `${data.source ?? 'sample'}:${scope}`
  const accounts = data.accounts.filter((a) => scope === 'all' || a.id === scope)
  // Saved so the AI review on the Allocation page can include hedge context.
  const [savedHedges, setSavedHedges] = useReviewCache<Record<string, AiHedgeContext>>('simonfire.ai.allocation.hedge-inputs.v1', {})
  const receiveAiHedge = useCallback((value: AiHedgeContext) => setSavedHedges((previous) => ({ ...previous, [cacheScope]: { ...value, alternatives: value.alternatives ?? [] } })), [cacheScope, setSavedHedges])
  const [, setSavedReviews] = useReviewCache<Record<string, { context: string; value: ProtectionAiEvidence }>>('simonfire.ai.allocation.protection-review.v1', {})
  const context = protectionContextKey(scope, positions, data.accounts)
  const receiveProtectionReview = useCallback((value: ProtectionAiEvidence | null) => {
    if (value) setSavedReviews((previous) => ({ ...previous, [cacheScope]: { context, value } }))
  }, [cacheScope, context, setSavedReviews])
  return <div>
    <PageHeader title="Protection" subtitle="Manage protective puts and size new hedges" />
    <HedgeWorkspace key={cacheScope} initialEvidence={savedHedges[cacheScope] ?? undefined} onAiEvidence={receiveAiHedge} onReviewEvidence={receiveProtectionReview} positions={positions} accounts={accounts} />
  </div>
}

function HedgeWorkspace({ positions, accounts, onAiEvidence, initialEvidence, onReviewEvidence }: { positions: Position[]; accounts: Account[]; initialEvidence?: AiHedgeContext; onReviewEvidence: (value: ProtectionAiEvidence | null) => void; onAiEvidence: (value: AiHedgeContext) => void }) {
  const [plan, setPlan] = useState<HedgePlanSnapshot | null>(null)
  const { data, addHedgeRoll } = useStore()
  const activePuts = positions.filter((p) => isActiveProtectivePut(p, brokerageDate())).length
  const openPlans = (data.hedgeRolls ?? []).filter((r) => !['closed', 'rolled'].includes(r.status)).length
  const [mode, setMode] = useState<'manage' | 'portfolio' | 'holding'>(() => activePuts || openPlans ? 'manage' : 'portfolio')
  const holdingChoices = useMemo(() => positions.filter((p) => !p.isOption && p.shares > 0 && p.lastPrice > 0).sort((a, b) => b.shares * b.lastPrice - a.shares * a.lastPrice), [positions])
  const [holdingId, setHoldingId] = useState(() => holdingChoices[0]?.id ?? '')
  const [orderNote, setOrderNote] = useState('')
  const prepareOrder = (draft: ProtectionOrderDraft) => {
    const contractKey = (symbol?: string) => symbol?.replace(/\s+/g, '').toUpperCase()
    const exists = (data.hedgeRolls ?? []).some((roll) =>
      roll.accountId === draft.accountId && !['closed', 'rolled'].includes(roll.status) &&
      (contractKey(roll.optionSymbol) === contractKey(draft.optionSymbol) ||
        (!!draft.closeOptionSymbol && contractKey(roll.closeOptionSymbol) === contractKey(draft.closeOptionSymbol))))
    if (!exists) addHedgeRoll(draft)
    setOrderNote(exists ? 'This order already has a plan in the queue. Review the existing plan below.' : 'Order ready for review. Preview with Schwab before confirming.')
    setMode('manage')
  }
  const tabs = [['manage', `My puts${activePuts + openPlans ? ` · ${activePuts + openPlans}` : ''}`], ['portfolio', 'Protect portfolio'], ['holding', 'Protect a holding']] as const
  return <div className="space-y-4">
    <div className="flex overflow-x-auto rounded-xl border border-border bg-surface/70 p-1">{tabs.map(([key, label]) => <button key={key} onClick={() => setMode(key)} className={clsx('min-w-max flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors', mode === key ? 'bg-[#c7a96b]/15 text-[#e1c887]' : 'text-muted hover:bg-white/[0.03] hover:text-ink')}>{label}</button>)}</div>
    {mode === 'manage' && orderNote && <div role="status" className="rounded-xl border border-pos/20 bg-pos/5 p-4 text-sm text-pos">{orderNote}</div>}
    {mode === 'manage' && <PutRollQueue positions={positions} accounts={accounts} plan={plan && putPlanMatchesContract(plan, brokerageDate()) ? plan : null} onCompare={() => setMode('portfolio')} onProtectHolding={() => setMode('holding')}/>}
    <div hidden={mode !== 'portfolio'} className="space-y-4"><PortfolioProtection positions={positions} accounts={accounts} onReviewEvidence={onReviewEvidence} onPrepareOrder={prepareOrder}/><details className="card p-0"><summary className="cursor-pointer p-4 text-sm text-muted">Older QQQ / SPY proxy estimate · reference only</summary><div className="space-y-4 border-t border-border-soft p-4"><PortfolioHedgeGuide/><LivePutQuotes positions={positions} accounts={accounts} symbolFilter="QQQ,SPY"/><PortfolioHedgeEngine initialEvidence={initialEvidence} positions={positions} onPlan={setPlan} onAiEvidence={onAiEvidence}/></div></details></div>
    {mode === 'holding' && <div className="space-y-4">
      {holdingChoices.length > 0 && <div className="card flex flex-wrap items-end gap-3 p-5"><label className="min-w-64 flex-1 text-xs text-muted">Holding to protect<select value={holdingId} onChange={(e) => setHoldingId(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink">{holdingChoices.map((row) => <option key={row.id} value={row.id}>{row.symbol} · {row.shares} shares · {accounts.find((a) => a.id === row.accountId)?.name ?? row.accountId}</option>)}</select></label><p className="pb-2 text-xs text-faint">1 · Load quotes and pick a contract &nbsp; 2 · Check the cost and outcomes &nbsp; 3 · Copy the ticket</p></div>}
      <LivePutQuotes key={holdingId} positions={positions} accounts={accounts} positionId={holdingId}/>
      <ProtectivePutsEngine positions={positions} accounts={accounts} positionId={holdingId} onPositionChange={setHoldingId}/>
      <ProtectivePutTutorial/>
    </div>}
  </div>
}

function PortfolioHedgeGuide() {
  const steps = [
    ['1 · Choose QQQ or SPY', 'QQQ is a technology-heavy proxy; SPY is broader. Select the one whose risk most closely resembles the portfolio exposure you intend to offset.'],
    ['2 · Estimate exposure', 'Use total long market exposure and a conservative beta to the selected proxy. Beta remains a planning assumption until clean portfolio history supports it.'],
    ['3 · Select a live put', 'Load the selected proxy’s chain and choose a liquid 60–90 DTE contract. Its ask, strike, and expiration feed the sizing model.'],
    ['4 · Roll every 30 days', 'Sell-to-close the existing put before buying its replacement. Do not rely on exercise unless you intentionally hold 100 deliverable shares per contract.'],
  ]
  return <details className="card group p-0"><summary className="flex cursor-pointer list-none items-center gap-3 p-5"><ShieldCheck size={19} className="text-brand"/><div><h3 className="font-semibold">Portfolio QQQ / SPY hedge · monthly roll plan</h3><p className="mt-0.5 text-xs text-faint">Size index puts against portfolio risk—not the number of index shares owned</p></div><ChevronRight size={17} className="ml-auto text-faint transition-transform group-open:rotate-90"/></summary><div className="border-t border-border-soft p-5"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{steps.map(([title, body]) => <div key={title} className="rounded-xl border border-border-soft bg-surface-2/35 p-4"><div className="text-sm font-semibold">{title}</div><p className="mt-2 text-xs leading-5 text-muted">{body}</p></div>)}</div><div className="mt-4 rounded-lg border border-[#5a3a16] bg-[#38240f]/55 p-3 text-xs leading-5 text-[#e7c88f]">Both proxies have basis risk and may not offset CEF, credit, or non-equity losses. Gross premium is not net roll cost because the old put may retain value when sold.</div></div></details>
}

function PortfolioHedgeEngine({ positions, onPlan, onAiEvidence, initialEvidence }: { positions: Position[]; initialEvidence?: AiHedgeContext; onPlan: (plan: HedgePlanSnapshot) => void; onAiEvidence: (value: AiHedgeContext) => void }) {
  const longExposure = positions.filter((p) => !p.isOption && p.shares > 0).reduce((sum, p) => sum + p.shares * p.lastPrice, 0)
  const [hedgeSymbol, setHedgeSymbol] = useState<'QQQ' | 'SPY'>(initialEvidence?.proxy ?? 'QQQ')
  const heldQqq = positions.find((p) => !p.isOption && normTicker(p.symbol) === hedgeSymbol)
  const [qqqPrice, setQqqPrice] = useState(initialEvidence?.price ?? heldQqq?.lastPrice ?? 0)
  const [beta, setBeta] = useState(initialEvidence?.beta ?? .8)
  const [decline, setDecline] = useState(initialEvidence?.declinePct ?? 25)
  const [offset, setOffset] = useState(initialEvidence?.offsetPct ?? 50)
  const [budget, setBudget] = useState(initialEvidence?.annualBudgetPct ?? 3)
  const [rollDays, setRollDays] = useState(30)
  const [strike, setStrike] = useState(initialEvidence?.strike ?? 0)
  const [premium, setPremium] = useState(initialEvidence?.premium ?? 0)
  const [expiry, setExpiry] = useState(initialEvidence?.expiration ?? '')
  const [optionSymbol, setOptionSymbol] = useState('')
  const [quoteIdentity, setQuoteIdentity] = useState<{ strike: number; expiration: string; premium: number; fetchedAt: string; underlyingPrice: number; delayed: boolean; alternatives: { strike: number; premium: number; expiration: string }[] } | null>(() => initialEvidence ? { strike: initialEvidence.strike, expiration: initialEvidence.expiration, premium: initialEvidence.premium, fetchedAt: initialEvidence.quoteFetchedAt, underlyingPrice: initialEvidence.price, delayed: initialEvidence.quoteDelayed, alternatives: initialEvidence.alternatives ?? [] } : null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const applyQuote = (event: Event) => {
      const detail = (event as CustomEvent<{ symbol?: string; optionSymbol?: string; underlyingPrice?: number; strike: number; expiration: string; premium: number; fetchedAt?: string; delayed?: boolean; alternatives?: { strike: number; premium: number; expiration: string }[] }>).detail
      const symbol = normTicker(detail.symbol ?? '')
      if (symbol !== 'QQQ' && symbol !== 'SPY') return
      setHedgeSymbol(symbol)
      if (detail.underlyingPrice) setQqqPrice(detail.underlyingPrice)
      setStrike(detail.strike); setPremium(detail.premium); setExpiry(detail.expiration); setOptionSymbol(detail.optionSymbol ?? ''); setQuoteIdentity({ strike: detail.strike, expiration: detail.expiration, premium: detail.premium, fetchedAt: detail.fetchedAt ?? '', underlyingPrice: detail.underlyingPrice ?? 0, delayed: detail.delayed !== false, alternatives: detail.alternatives ?? [] })
    }
    window.addEventListener('simonfire:put-quote', applyQuote)
    return () => window.removeEventListener('simonfire:put-quote', applyQuote)
  }, [])
  const existingOffset = existingProxyPutOffset(positions, hedgeSymbol, qqqPrice * (1 - decline / 100), expiry || brokerageDate())
  const plan = portfolioPutHedge({ existingOffset, longExposure, qqqPrice, portfolioQqqBeta: beta, targetQqqDeclinePct: decline, lossOffsetPct: offset, strikePrice: strike, premiumPerShare: premium, annualPremiumBudgetPct: budget })
  const todayDate = brokerageDate()
  const expiryDate = expiry ? new Date(`${expiry}T12:00:00Z`) : null
  const daysToExpiry = expiryDate ? Math.round((expiryDate.getTime() - Date.parse(`${todayDate}T12:00:00Z`)) / 86_400_000) : null
  const rollDate = useMemo(() => { const date = new Date(`${todayDate}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + rollDays); return date.toISOString().slice(0, 10) }, [todayDate, rollDays])
  const ticket = `BUY TO OPEN ${plan.contracts} ${hedgeSymbol} PUT ${expiry || '[EXPIRY]'} $${strike.toFixed(2)} @ $${premium.toFixed(2)} LIMIT · PORTFOLIO HEDGE · SELL TO CLOSE BY ${rollDate}`
  useEffect(() => {
    onPlan({ proxy: hedgeSymbol, contracts: plan.contracts, strike, expiration: expiry, premiumPerShare: premium, grossPremium: plan.grossPremium, rollDate: rollDate, optionSymbol, ticket })
  }, [hedgeSymbol, plan.contracts, plan.grossPremium, strike, expiry, premium, rollDays, optionSymbol, ticket, onPlan, rollDate])
  const quoteFetchedAt = quoteIdentity?.strike === strike && quoteIdentity.underlyingPrice === qqqPrice && quoteIdentity.expiration === expiry && quoteIdentity.premium === premium ? quoteIdentity.fetchedAt : ''
  const quoteAlternatives = quoteIdentity?.alternatives
  const quoteDelayed = quoteIdentity?.delayed ?? true
  useEffect(() => { onAiEvidence({ alternatives: quoteAlternatives, proxy: hedgeSymbol, price: qqqPrice, beta, declinePct: decline, offsetPct: offset, annualBudgetPct: budget, strike, premium, expiration: expiry, quoteFetchedAt, quoteDelayed }) }, [onAiEvidence, hedgeSymbol, qqqPrice, beta, decline, offset, budget, strike, premium, expiry, quoteFetchedAt, quoteAlternatives, quoteDelayed])
  const copy = async () => { try { await navigator.clipboard.writeText(ticket); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* unavailable */ } }
  return <div className="space-y-4"><div className="card p-5"><div className="flex items-start gap-3"><ShieldCheck size={20} className="text-brand"/><div><h3 className="font-semibold">Portfolio hedge sizing</h3><p className="mt-1 text-xs text-faint">Scenario-based {hedgeSymbol} proxy hedge with a fixed monthly roll discipline.</p></div><span className="ml-auto rounded-md bg-[#c7a96b]/10 px-2 py-1 text-xs text-[#d8bd7a]">Planning only</span></div><div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><HedgeInput label="Long market exposure" prefix="$" value={longExposure} disabled/><HedgeInput label={`${hedgeSymbol} crash scenario`} suffix="% down" value={decline} onChange={(v) => setDecline(Math.max(1, Math.min(90, v)))}/><HedgeInput label="Loss offset target" suffix="%" value={offset} onChange={(v) => setOffset(Math.max(1, Math.min(100, v)))}/><label className="text-xs text-muted"><span>Expiration</span><input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm [color-scheme:dark]"/></label></div><details className="mt-4 rounded-xl border border-border-soft p-4"><summary className="cursor-pointer text-sm font-semibold">Advanced assumptions and quote adjustments</summary><p className="mt-2 text-xs text-faint">Beta is your estimate of how strongly this portfolio moves with the proxy. Budget warnings compare gross purchase cost with one month of your annual budget; proceeds from selling an old put are shown separately in roll review.</p><div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><HedgeInput label={`${hedgeSymbol} price`} prefix="$" value={qqqPrice} onChange={setQqqPrice}/><HedgeInput label={`Assumed portfolio ${hedgeSymbol} beta`} value={beta} step={.05} onChange={(v) => setBeta(Math.max(0, Math.min(3, v)))}/><HedgeInput label="Annual premium budget" suffix="%" value={budget} step={.25} onChange={(v) => setBudget(Math.max(0, Math.min(20, v)))}/><HedgeInput label="Roll interval" suffix="days" value={rollDays} onChange={(v) => setRollDays(Math.max(7, Math.min(60, v)))}/><HedgeInput label="Selected strike" prefix="$" value={strike} onChange={setStrike}/><HedgeInput label="Selected ask" prefix="$" value={premium} step={.01} onChange={setPremium}/></div></details>{daysToExpiry != null && daysToExpiry < rollDays && <div className="mt-4 rounded-lg border border-neg/30 bg-neg/10 p-3 text-xs text-neg">This contract expires before the planned {rollDays}-day roll. Choose a longer-dated {hedgeSymbol} put.</div>}</div><div className="card p-5"><h3 className="font-semibold">What this protection would do</h3><p className="mt-2 mb-4 text-sm text-muted">In your {decline}% proxy decline scenario, the estimated portfolio loss is {usd(plan.modeledPortfolioLoss)}. Your goal is to offset {offset}% of that loss. {plan.netPayoffPerContract > 0 ? `Each new contract offsets about ${usd(plan.netPayoffPerContract)} after its premium at expiration. Existing same-proxy puts contribute a modeled ${usd(existingOffset)} change, leaving ${plan.contracts} additional contracts to reach the target.` : 'Select a put with a positive payoff after premium in this scenario before sizing protection.'}</p><div className="grid grid-cols-2 gap-5 lg:grid-cols-4"><SummaryMetric label="Modeled portfolio loss" value={usd(plan.modeledPortfolioLoss)} tone="warn"/><SummaryMetric label="Desired dollar offset" value={usd(plan.desiredOffset)}/><SummaryMetric label="Net payoff / contract" value={usd(plan.netPayoffPerContract)}/><SummaryMetric label="Additional contracts needed" value={String(plan.contracts)}/><SummaryMetric label="Gross premium debit" value={usd(plan.grossPremium)} tone={plan.overMonthlyBudget ? 'warn' : undefined}/><SummaryMetric label="Monthly debit budget" value={usd(plan.monthlyGrossDebitBudget)}/><SummaryMetric label="Existing puts · modeled change" value={usd(existingOffset, { sign: true })}/><SummaryMetric label="Modeled net offset" value={usd(plan.modeledNetOffset)}/><SummaryMetric label="Offset achieved" value={pct(plan.offsetAchievedPct * 100)}/><SummaryMetric label="Residual modeled loss" value={usd(plan.residualLoss)} tone="warn"/><SummaryMetric label={`${hedgeSymbol} crash price`} value={usd(plan.crashPrice)}/><SummaryMetric label="Next roll date" value={shortDate(rollDate)}/><SummaryMetric label="Days to expiration" value={daysToExpiry == null ? 'Select contract' : String(daysToExpiry)}/></div>{plan.overMonthlyBudget && <div className="mt-4 rounded-lg border border-[#5a3a16] bg-[#38240f]/55 p-3 text-xs text-[#e7c88f]">The gross purchase debit exceeds one month of the annual premium budget. This is a conservative warning: actual net roll cost depends on proceeds from selling the old put.</div>}</div><div className="card p-5"><div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#cbb77f]">Planned hedge ticket</div><div className="num mt-2 break-words text-sm">{ticket}</div><div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-faint">This ticket adds protection while keeping eligible existing puts. To replace a held put, use Manage existing puts so the close and replacement legs stay linked.</p><Button onClick={copy} disabled={!plan.contracts || !expiry}>{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? 'Copied' : 'Copy ticket'}</Button></div></div></div>
}

function HedgeInput({ label, value, prefix, suffix, step, disabled, onChange }: { label: string; value: number; prefix?: string; suffix?: string; step?: number; disabled?: boolean; onChange?: (v: number) => void }) { return <label className="text-xs text-muted"><span>{label}</span><div className={clsx('mt-1 flex rounded-xl border border-border bg-surface-2 px-3', disabled && 'opacity-60')}>{prefix && <span className="my-auto">{prefix}</span>}<input type="number" value={Number.isFinite(value) ? +value.toFixed(2) : 0} step={step} disabled={disabled} onChange={(e) => onChange?.(+e.target.value)} className="num w-full bg-transparent py-2.5 outline-none"/>{suffix && <span className="my-auto whitespace-nowrap">{suffix}</span>}</div></label> }

type HedgePlanSnapshot = Omit<HedgeRoll, 'id' | 'createdAt' | 'status' | 'source'> & { ticket: string }
const optionSymbolForPosition = (position: Position) => {
  const existing = position.symbol.replace(/\s+/g, '').toUpperCase()
  if (/^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(existing)) return existing
  const root = normTicker(position.underlying ?? position.symbol)
  const date = position.expiration?.replaceAll('-', '').slice(2)
  const side = position.optionType === 'Put' ? 'P' : position.optionType === 'Call' ? 'C' : ''
  const strike = position.strike == null ? '' : String(Math.round(position.strike * 1_000)).padStart(8, '0')
  const reconstructed = `${root}${date ?? ''}${side}${strike}`
  return /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(reconstructed) ? reconstructed : ''
}
function PutRollQueue({ positions, accounts, plan, onCompare, onProtectHolding }: { positions: Position[]; accounts: Account[]; plan: HedgePlanSnapshot | null; onCompare?: () => void; onProtectHolding?: () => void }) {
  const { data, addHedgeRoll, updateHedgeRoll, removeHedgeRoll } = useStore()
  const [selectedOrderAccount, setOrderAccount] = useState(() => accounts[0]?.id ?? '')
  const orderAccount = accounts.some((account) => account.id === selectedOrderAccount) ? selectedOrderAccount : accounts[0]?.id ?? ''
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [confirmRoll, setConfirmRoll] = useState<HedgeRoll | null>(null)
  const [confirmationText, setConfirmationText] = useState('')
  const [placing, setPlacing] = useState(false)
  const [recommending, setRecommending] = useState<string | null>(null)
  const [rollError, setRollError] = useState('')
  const [putChecks, setPutChecks] = useState<Record<string, { bid: number; ask: number; mark: number; value: number; dte: number; rollBy: string; recommendation: 'ROLL' | 'HOLD'; reason: string; checkedAt: string }>>({})
  const [rollWindowDays, setRollWindowDays] = usePersistentState('simonfire.put-roll-window', 60)
  const autoChecked = useRef(false)
  const [quoteClock, setQuoteClock] = useState(() => Date.now())
  const allRolls = (data.hedgeRolls ?? []).filter((roll) => !roll.accountId || accounts.some((account) => account.id === roll.accountId))
  const openRolls = allRolls.filter((roll) => !['closed', 'rolled'].includes(roll.status))
  const rollKey = (roll: HedgeRoll) => `${roll.accountId}|${roll.closeOptionSymbol ?? ''}|${roll.optionSymbol ?? ''}`
  const queued = openRolls.filter((roll, index, rows) => rows.findIndex((candidate) => rollKey(candidate) === rollKey(roll)) === index)
  const duplicateRolls = openRolls.filter((roll, index, rows) => rows.findIndex((candidate) => rollKey(candidate) === rollKey(roll)) !== index)
  const completedRolls = allRolls.filter((roll) => ['closed', 'rolled'].includes(roll.status))
  const livePuts = positions.filter((p) => isActiveProtectivePut(p))
  const planReady = !!plan && putPlanMatchesContract(plan, brokerageDate())
  const add = () => {
    if (!planReady || !plan || !orderAccount) return
    if (openRolls.some((r) => r.accountId === orderAccount && r.optionSymbol === plan.optionSymbol)) { setRollError('This contract already has a plan in the queue. Review it below.'); return }
    const { ticket: _ticket, ...roll } = plan
    addHedgeRoll({ ...roll, accountId: orderAccount, previewState: 'not_previewed', status: 'queued', source: 'planning' })
  }

  const startRoll = useCallback(async (position: Position) => {
    const underlying = normTicker(position.underlying ?? '')
    if ((underlying !== 'QQQ' && underlying !== 'SPY') || !position.accountId) return
    const heldOptionSymbol = optionSymbolForPosition(position)
    if (!heldOptionSymbol) { setRollError('The held position is missing a valid option contract symbol. Sync Schwab and try again.'); return }
    setRecommending(position.id); setRollError('')
    const from = new Date(); const to = new Date(); to.setDate(to.getDate() + 240)
    const result = await schwabPutChain(underlying, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10), heldOptionSymbol, 80)
    setRecommending(null)
    if (!result.ok) { setRollError(result.error ?? 'Unable to refresh the Schwab option chain.'); return }
    const key = (symbol: string) => symbol.replace(/\s+/g, '').toUpperCase()
    const current = (result.contracts ?? []).find((quote) => key(quote.symbol) === key(heldOptionSymbol))
    if (!current) { setRollError('Schwab did not return a quote for the held contract. Confirm that it is still active and try again.'); return }
    const dte = current.daysToExpiration ?? Math.max(0, Math.ceil((new Date(`${current.expiration}T00:00:00`).getTime() - Date.now()) / 86_400_000))
    const rollByDate = new Date(`${current.expiration}T00:00:00`); rollByDate.setDate(rollByDate.getDate() - rollWindowDays)
    const mark = current.mark ?? ((current.bid ?? 0) + (current.ask ?? 0)) / 2
    const shouldRoll = putRollTiming(dte, rollWindowDays).recommendation === 'ROLL'
    setPutChecks((checks) => ({ ...checks, [position.id]: { bid: current.bid ?? 0, ask: current.ask ?? 0, mark, value: mark * 100 * Math.trunc(position.shares), dte, rollBy: rollByDate.toISOString().slice(0, 10), recommendation: shouldRoll ? 'ROLL' : 'HOLD', reason: shouldRoll ? `The put has ${dte} days remaining, inside your ${rollWindowDays}-day roll window.` : `The put has ${dte} days remaining. The review window begins about ${shortDate(rollByDate.toISOString().slice(0, 10))}.`, checkedAt: new Date().toISOString() } }))
  }, [rollWindowDays])
  // Run once when the protective-put workspace opens; manual refresh remains available.
  useEffect(() => {
    if (autoChecked.current || !livePuts.length) return
    autoChecked.current = true
    void Promise.all(livePuts.map((put) => startRoll(put)))
  }, [livePuts, startRoll])
  useEffect(() => { const timer = window.setInterval(() => setQuoteClock(Date.now()), 60_000); return () => window.clearInterval(timer) }, [])
  const preview = async (roll: HedgeRoll) => {
    const order = buildPutPreviewOrder(roll.optionSymbol ?? '', roll.contracts, roll.premiumPerShare)
    if (!order || !roll.accountId) {
      updateHedgeRoll(roll.id, { previewState: 'rejected', previewedAt: new Date().toISOString(), previewError: 'Select a fresh option quote and Schwab account.' })
      return
    }
    setPreviewing(roll.id)
    let closeRequestId: string | undefined
    if (roll.closeOptionSymbol && !roll.closeOrderId && roll.closeContracts && roll.closeLimitCredit) {
      const closeOrder = buildPutCloseOrder(roll.closeOptionSymbol, roll.closeContracts, roll.closeLimitCredit)
      if (!closeOrder) { setPreviewing(null); updateHedgeRoll(roll.id, { closePreviewState: 'rejected', previewError: 'The close-leg payload is invalid.' }); return }
      closeRequestId = crypto.randomUUID()
      const closeResult = await schwabPreviewOption(roll.accountId, closeRequestId, closeOrder)
      if (!closeResult.ok) {
        const closeError = typeof closeResult.error === 'string' ? closeResult.error : closeResult.error ? JSON.stringify(closeResult.error) : 'Schwab rejected the close leg.'
        updateHedgeRoll(roll.id, { closePreviewState: 'rejected', previewState: 'rejected', previewError: `Close preview: ${closeError}` })
        setPreviewing(null)
        return
      }
    }
    const requestId = crypto.randomUUID()
    const result = await schwabPreviewOption(roll.accountId, requestId, order)
    const error = typeof result.error === 'string' ? result.error : result.error ? JSON.stringify(result.error) : 'Schwab rejected this preview.'
    const previewedAt = Date.now()
    setQuoteClock(previewedAt)
    updateHedgeRoll(roll.id, { previewState: result.ok ? 'accepted' : 'rejected', closePreviewState: closeRequestId ? 'accepted' : roll.closePreviewState, closePreviewRequestId: result.ok ? closeRequestId : undefined, previewedAt: new Date(previewedAt).toISOString(), previewRequestId: result.ok ? requestId : undefined, previewError: result.ok ? undefined : error })
    setPreviewing(null)
  }
  // Read the actual click time here, not the display timer; this handler never runs during render.
  // oxlint-disable-next-line react/purity
  const openPlacement = (roll: HedgeRoll) => { if (!previewIsCurrent(roll, Date.now()) || roll.orderId || (roll.closeOrderId && roll.closeOrderStatus !== 'FILLED')) return; setConfirmRoll(roll); setConfirmationText('') }
  const place = async () => {
    // Recheck expiration at submission even if the confirmation dialog has remained open.
    // oxlint-disable-next-line react/purity
    if (placing || !confirmRoll?.accountId || !confirmRoll.previewRequestId || confirmationText !== 'PLACE' || confirmRoll.orderId || !previewIsCurrent(confirmRoll, Date.now())) return
    if (confirmRoll.closeOptionSymbol && !confirmRoll.closeOrderId) {
      const closeOrder = buildPutCloseOrder(confirmRoll.closeOptionSymbol, confirmRoll.closeContracts ?? 0, confirmRoll.closeLimitCredit ?? 0)
      if (!closeOrder || !confirmRoll.closePreviewRequestId) return
      setPlacing(true)
      const closeResult = await schwabPlaceOption(confirmRoll.accountId, confirmRoll.closePreviewRequestId, closeOrder)
      if (!closeResult.ok || !closeResult.orderId) {
        const error = typeof closeResult.error === 'string' ? closeResult.error.replaceAll('_', ' ') : 'Schwab rejected the close order.'
        updateHedgeRoll(confirmRoll.id, { closePreviewState: 'rejected', previewError: `Close order: ${error}` })
        setPlacing(false); setConfirmRoll((current) => current ? { ...current, previewError: `Close order: ${error}` } : current)
        return
      }
      const closeOrderId = closeResult.orderId
      updateHedgeRoll(confirmRoll.id, { closeOrderId, closeOrderStatus: closeResult.status ?? 'ACCEPTED', closePlacedAt: new Date().toISOString() })
      await new Promise((resolve) => setTimeout(resolve, 3000))
      const closeStatus = await schwabOrderStatus(confirmRoll.accountId, closeOrderId)
      if (closeStatus.ok) updateHedgeRoll(confirmRoll.id, { closeOrderStatus: closeStatus.status ?? 'UNKNOWN' })
      setPlacing(false); setConfirmRoll(null)
      return
    }
    if (confirmRoll.closeOrderId && confirmRoll.closeOrderStatus !== 'FILLED') return
    const order = buildPutPreviewOrder(confirmRoll.optionSymbol ?? '', confirmRoll.contracts, confirmRoll.premiumPerShare)
    if (!order) return
    setPlacing(true)
    const result = await schwabPlaceOption(confirmRoll.accountId, confirmRoll.previewRequestId, order)
    if (!result.ok || !result.orderId) {
      const error = typeof result.error === 'string' ? result.error.replaceAll('_', ' ') : result.error ? JSON.stringify(result.error) : 'Schwab rejected the order.'
      updateHedgeRoll(confirmRoll.id, { previewState: 'rejected', previewError: error })
      setPlacing(false)
      setConfirmRoll((current) => current ? { ...current, previewState: 'rejected', previewError: error } : current)
      return
    }
    const orderId = result.orderId
    updateHedgeRoll(confirmRoll.id, { status: 'queued', orderId, orderStatus: result.status ?? 'ACCEPTED', placedAt: new Date().toISOString(), previewError: undefined })
    await new Promise((resolve) => setTimeout(resolve, 3000))
    const status = await schwabOrderStatus(confirmRoll.accountId, orderId)
    if (status.ok) updateHedgeRoll(confirmRoll.id, { orderStatus: status.status ?? 'UNKNOWN', status: status.status === 'FILLED' ? 'active' : 'queued' })
    setPlacing(false)
    setConfirmRoll(null)
  }
  const refreshCloseStatus = async (roll: HedgeRoll) => {
    if (!roll.accountId || !roll.closeOrderId) return
    setPreviewing(roll.id)
    const result = await schwabOrderStatus(roll.accountId, roll.closeOrderId)
    if (result.ok) updateHedgeRoll(roll.id, { closeOrderStatus: result.status ?? 'UNKNOWN' })
    else updateHedgeRoll(roll.id, { previewError: `Close status: ${String(result.error ?? 'unavailable')}` })
    setPreviewing(null)
  }
  const refreshOpenStatus = async (roll: HedgeRoll) => {
    if (!roll.accountId || !roll.orderId) return
    setPreviewing(roll.id)
    const result = await schwabOrderStatus(roll.accountId, roll.orderId)
    if (result.ok) updateHedgeRoll(roll.id, { orderStatus: result.status ?? 'UNKNOWN', status: result.status === 'FILLED' ? 'active' : roll.status })
    else updateHedgeRoll(roll.id, { previewError: `Open status: ${String(result.error ?? 'unavailable')}` })
    setPreviewing(null)
  }
  const previewIsCurrent = (roll: HedgeRoll, now = quoteClock) => accounts.some((account) => account.id === roll.accountId) && roll.expiration >= brokerageDate() && roll.previewState === 'accepted' && (!roll.closeOptionSymbol || roll.closeOrderStatus === 'FILLED' || roll.closePreviewState === 'accepted') && !!roll.previewRequestId && !!roll.previewedAt && now >= new Date(roll.previewedAt).getTime() && now - new Date(roll.previewedAt).getTime() < 10 * 60_000
  const confirmingClose = !!confirmRoll?.closeOptionSymbol && !confirmRoll.closeOrderId
  const confirmSymbol = confirmingClose ? confirmRoll?.closeOptionSymbol : confirmRoll?.optionSymbol
  const confirmContracts = confirmingClose ? confirmRoll?.closeContracts : confirmRoll?.contracts
  const confirmLimit = confirmingClose ? confirmRoll?.closeLimitCredit : confirmRoll?.premiumPerShare
  const confirmTotal = (confirmContracts ?? 0) * (confirmLimit ?? 0) * 100
  const statusStyle: Record<HedgeRoll['status'], string> = { queued: 'bg-[#c7a96b]/10 text-[#d8bd7a]', active: 'bg-pos/10 text-pos', rolled: 'bg-[#10233f] text-[#5aa2ff]', closed: 'bg-surface-2 text-muted' }
  if (!livePuts.length && !queued.length && !plan && !completedRolls.length && !rollError) return <div className="card p-8 text-center">
    <h3 className="font-semibold">You don't hold any protective puts yet</h3>
    <p className="mx-auto mt-2 max-w-md text-sm text-muted">Puts you buy at Schwab show up here after a sync, along with any orders you plan from the other tabs.</p>
    <div className="mt-5 flex flex-wrap justify-center gap-2"><Button variant="primary" onClick={onCompare} disabled={!onCompare}>Protect the portfolio</Button><Button onClick={onProtectHolding} disabled={!onProtectHolding}>Protect a holding</Button></div>
  </div>
  return <div className="space-y-4">
    {!!livePuts.length && <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Puts you hold</h3><label className="text-xs text-muted">Flag for review <span className="ml-2 inline-flex items-center rounded-lg border border-border bg-surface-2 px-2"><input type="number" min="7" max="120" value={rollWindowDays} onChange={(event) => setRollWindowDays(Math.max(7, Math.min(120, Number(event.target.value) || 60)))} className="num w-12 bg-transparent py-1.5 text-right text-ink outline-none"/><span className="ml-1">days</span></span></label></div>}
    {!!queued.length && <div className="card p-4"><RollWorkflow rolls={queued} checked={Object.keys(putChecks).length > 0}/></div>}
    {!!livePuts.length && <div className="grid gap-3 lg:grid-cols-2">{livePuts.map((put) => <CurrentPutCard key={put.id} put={put} account={accounts.find((account) => account.id === put.accountId)} check={putChecks[put.id]} checking={recommending === put.id} now={quoteClock} rollWindowDays={rollWindowDays} onCheck={() => startRoll(put)} onCompare={onCompare}/>)}</div>}
    {(plan || rollError) && <div className="card p-5">
      <div className="flex flex-wrap items-end gap-3">
        <ListChecks size={19} className="mb-2 text-brand"/>
        <div className="mb-1"><h3 className="font-semibold">Put order queue</h3><p className="mt-1 text-xs text-faint">A preview does not place an order. Review each order, then type PLACE to submit. For rolls, the close must fill before you can confirm the replacement purchase.</p></div>
        {plan && <label className="ml-auto text-xs text-muted"><span>Schwab account for legacy plan</span><select value={orderAccount} onChange={(e) => setOrderAccount(e.target.value)} className="mt-1 block rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink"><option value="">Select account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
        {plan && <Button variant="primary" onClick={add} disabled={!planReady || !orderAccount}>Add current hedge to queue</Button>}
      </div>
      {plan && !planReady && <p className="mt-3 text-xs text-muted">Choose a current option quote to prepare a valid hedge. Changing strike or expiration requires selecting the matching contract again.</p>}
      {plan?.optionSymbol && <div className="mt-4 rounded-xl border border-border-soft bg-surface-2/35 p-4"><div className="num text-sm">{plan.ticket}</div><div className="mt-2 text-xs text-faint">Gross debit {usd(plan.grossPremium)} · roll by {shortDate(plan.rollDate)} · {plan.optionSymbol ? `contract ${plan.optionSymbol}` : 'select a live quote to capture the contract symbol'}</div></div>}
      {rollError && <div className="mt-3 rounded-lg border border-neg/30 bg-neg/10 p-3 text-xs text-neg">{rollError}</div>}
    </div>}
    {!!queued.length && <div className="card overflow-x-auto p-0">
      <div className="flex items-center gap-3 p-5"><h3 className="font-semibold">Planned put orders</h3><span className="rounded-md bg-pos/10 px-2 py-1 text-xs text-pos">{livePuts.length} broker holdings</span><span className="rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">{queued.length} tracked rolls</span></div>
      <table className="w-full min-w-[1050px] text-sm"><thead><tr className="border-y border-border-soft text-xs text-muted"><th className="px-4 py-3 text-left">Source</th><th className="px-4 py-3 text-left">Put</th><th className="px-4 py-3 text-right">Contracts</th><th className="px-4 py-3 text-right">Premium / value</th><th className="px-4 py-3 text-left">Expiration</th><th className="px-4 py-3 text-left">Roll by</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Validation</th><th className="px-4 py-3"></th></tr></thead>
        <tbody>
          {livePuts.map((p) => <tr key={`live-${p.id}`} className="border-b border-border-soft bg-pos/[.03]"><td className="px-4 py-3"><span className="rounded-md bg-pos/10 px-2 py-1 text-xs text-pos">Broker holding</span><div className="mt-1 text-[10px] text-faint">{accounts.find((a) => a.id === p.accountId)?.name ?? p.accountId}</div></td><td className="px-4 py-3 font-semibold">{p.underlying ?? p.symbol} ${p.strike?.toFixed(2) ?? '—'} put<div className="mt-1 font-mono text-[10px] font-normal text-faint">{optionSymbolForPosition(p) || p.symbol}</div></td><td className="num px-4 py-3 text-right">{p.shares}</td><td className="num px-4 py-3 text-right">{usd(p.shares * p.lastPrice)}</td><td className="px-4 py-3">{p.expiration ? shortDate(p.expiration) : '—'}</td><td className="px-4 py-3 text-faint">{p.expiration ? `${Math.ceil((new Date(`${p.expiration}T00:00:00`).getTime() - quoteClock) / 86_400_000)} DTE` : 'Set in tracker'}</td><td className="px-4 py-3"><span className="rounded-md bg-pos/10 px-2 py-1 text-xs text-pos">Active</span></td><td className="px-4 py-3"><button onClick={onCompare} disabled={!onCompare} className="rounded-md border border-border px-2 py-1 text-xs text-muted enabled:hover:border-brand enabled:hover:text-brand disabled:opacity-40">Compare protection options</button></td><td></td></tr>)}
          {queued.map((r) => <tr key={r.id} className="border-b border-border-soft"><td className="px-4 py-3"><span className="rounded-md bg-[#c7a96b]/10 px-2 py-1 text-xs text-[#d8bd7a]">{r.closeOptionSymbol ? 'Roll' : 'Planning'}</span><div className="mt-1 text-[10px] text-faint">{accounts.find((a) => a.id === r.accountId)?.name ?? 'No account'}</div></td><td className="px-4 py-3 font-semibold">{r.proxy} ${r.strike.toFixed(2)} replacement<div className="mt-1 font-mono text-[10px] font-normal text-faint">{r.optionSymbol ?? 'Legacy row · quote required'}</div>{r.closeOptionSymbol && <div className="mt-1 font-mono text-[10px] font-normal text-[#d8bd7a]">Close: {r.closeOptionSymbol} @ ${r.closeLimitCredit?.toFixed(2)}</div>}{r.closeOrderId && <div className="mt-1 text-[10px] font-normal text-muted">Close #{r.closeOrderId} · {r.closeOrderStatus ?? 'ACCEPTED'}</div>}{r.orderId && <div className="mt-1 text-[10px] font-normal text-pos">Open #{r.orderId} · {r.orderStatus ?? 'ACCEPTED'}</div>}</td><td className="num px-4 py-3 text-right">{r.contracts}</td><td className="num px-4 py-3 text-right">{usd(r.grossPremium)}</td><td className="px-4 py-3">{shortDate(r.expiration)}</td><td className={clsx('px-4 py-3', r.status !== 'closed' && r.rollDate <= new Date().toISOString().slice(0, 10) ? 'text-neg' : '')}>{shortDate(r.rollDate)}</td><td className="px-4 py-3"><select aria-label="Manual tracking status" disabled={!!r.orderId || !!r.closeOrderId} value={r.status} onChange={(e) => updateHedgeRoll(r.id, { status: e.target.value as HedgeRoll['status'] })} className={clsx('rounded-md border-0 px-2 py-1 text-xs outline-none', statusStyle[r.status])}><option value="queued">Queued</option><option value="active">Active</option><option value="rolled">Rolled</option><option value="closed">Closed</option></select></td><td className="max-w-[240px] px-4 py-3"><div className="flex flex-wrap gap-1"><button onClick={() => preview(r)} disabled={!r.optionSymbol || !r.accountId || r.status === 'closed' || !!r.orderId || previewing === r.id || (!!r.closeOrderId && r.closeOrderStatus !== 'FILLED')} className="rounded-md border border-border px-2 py-1 text-xs text-muted enabled:hover:border-brand enabled:hover:text-brand disabled:opacity-40">{previewing === r.id ? 'Working…' : previewIsCurrent(r) ? 'Preview again' : 'Preview with Schwab'}</button>{r.closeOrderId && r.closeOrderStatus !== 'FILLED' && <button onClick={() => refreshCloseStatus(r)} disabled={previewing === r.id} className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-brand hover:text-brand disabled:opacity-40">Refresh close status</button>}{r.orderId && !['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'].includes(r.orderStatus ?? '') && <button onClick={() => refreshOpenStatus(r)} disabled={previewing === r.id} className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-brand hover:text-brand disabled:opacity-40">Refresh open status</button>}{previewIsCurrent(r) && !r.orderId && (!r.closeOrderId || r.closeOrderStatus === 'FILLED') && <button onClick={() => openPlacement(r)} className="rounded-md bg-neg px-2 py-1 text-xs font-semibold text-white hover:brightness-110">{r.closeOptionSymbol && !r.closeOrderId ? 'Review close order' : r.closeOrderStatus === 'FILLED' ? 'Review replacement order' : 'Review purchase order'}</button>}</div><div className={clsx('mt-1 text-[10px]', r.previewState === 'accepted' ? 'text-pos' : r.previewState === 'rejected' ? 'text-neg' : 'text-faint')}>{r.orderId ? `Replacement submitted ${r.placedAt ? shortDate(r.placedAt) : ''}` : r.closeOrderId && r.closeOrderStatus !== 'FILLED' ? 'Waiting for close fill before replacement' : r.closeOrderStatus === 'FILLED' && !previewIsCurrent(r) ? 'Close filled · preview replacement again' : r.previewState === 'accepted' ? previewIsCurrent(r) ? r.closeOptionSymbol && !r.closeOrderId ? 'Both legs previewed · close submits first' : 'Schwab preview passed · expires in 10 minutes' : 'Preview expired · preview again' : r.previewState === 'rejected' ? r.previewError : 'Not previewed'}</div></td><td className="px-4 py-3 text-right"><button onClick={() => removeHedgeRoll(r.id)} disabled={placing} className="text-xs text-faint hover:text-neg disabled:opacity-40">Remove</button></td></tr>)}
          {!livePuts.length && !queued.length && <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-faint">No puts are being tracked yet. Select a live quote, size the hedge, and add it to the queue.</td></tr>}
        </tbody>
      </table>
    </div>}
    {!!completedRolls.length && <CompletedRollHistory rolls={completedRolls} accounts={accounts}/>}
    {!!duplicateRolls.length && <details className="card p-0"><summary className="cursor-pointer p-5 text-sm font-semibold">Hidden duplicate roll records ({duplicateRolls.length})</summary><div className="border-t border-border-soft p-4 text-xs text-muted">These duplicate planning records are excluded from the active workflow. Remove them from the tracker after confirming they are not distinct Schwab orders.</div></details>}
    <Modal
      open={!!confirmRoll}
      onClose={() => !placing && setConfirmRoll(null)}
      title={confirmingClose ? 'Confirm close order' : confirmRoll?.closeOrderStatus === 'FILLED' ? 'Confirm replacement purchase' : 'Confirm protective-put purchase'}
      subtitle={confirmingClose ? 'The replacement stays blocked until Schwab reports this close order filled.' : 'This sends a real buy-to-open option order to Schwab.'}
      footer={confirmRoll ? <><Button onClick={() => setConfirmRoll(null)} disabled={placing}>Cancel</Button><Button variant="primary" onClick={place} disabled={placing || confirmationText !== 'PLACE'}>{placing ? <><LoaderCircle size={14} className="animate-spin"/> Submitting…</> : confirmingClose ? 'Place close leg' : confirmRoll.closeOrderStatus === 'FILLED' ? 'Place replacement' : 'Place live order'}</Button></> : undefined}
    >
      {confirmRoll && <div className="space-y-4 text-sm">
        <div className="rounded-xl border border-border-soft bg-surface-2/50 p-4">
          <div className="flex justify-between gap-4"><span className="text-muted">Account</span><span>{accounts.find((a) => a.id === confirmRoll.accountId)?.name ?? confirmRoll.accountId}</span></div>
          <div className="mt-2 flex justify-between gap-4"><span className="text-muted">Action</span><span className="font-semibold text-pos">{confirmingClose ? 'SELL TO CLOSE' : 'BUY TO OPEN'}</span></div>
          <div className="mt-2 flex justify-between gap-4"><span className="text-muted">Contract</span><span className="break-all font-mono text-right">{confirmSymbol}</span></div>
          <div className="mt-2 flex justify-between gap-4"><span className="text-muted">Quantity</span><span className="num font-semibold">{confirmContracts} contract{confirmContracts === 1 ? '' : 's'}</span></div>
          <div className="mt-2 flex justify-between gap-4"><span className="text-muted">Limit {confirmingClose ? 'credit' : 'debit'}</span><span className="num font-semibold">${confirmLimit?.toFixed(2)} per share</span></div>
          <div className="mt-2 flex justify-between gap-4"><span className="text-muted">{confirmingClose ? 'Expected credit' : 'Maximum debit'}</span><span className={clsx('num font-semibold', confirmingClose ? 'text-pos' : 'text-neg')}>{usd(confirmTotal)}</span></div>
          <div className="mt-2 flex justify-between gap-4"><span className="text-muted">Timing</span><span>Day · Regular session</span></div>
        </div>
        <div className="rounded-lg border border-neg/40 bg-neg/10 p-3 text-xs leading-5 text-neg">A fill can occur immediately after Schwab accepts this order. Confirm every field above.{confirmRoll.closeOptionSymbol && ' The app will never submit the replacement until the close is reported filled.'}</div>
        {confirmRoll.previewError && <div className="rounded-lg border border-neg/40 bg-neg/10 p-3 text-xs text-neg">{confirmRoll.previewError}</div>}
        <label className="block text-xs text-muted"><span>Type <strong className="text-ink">PLACE</strong> to authorize this live order</span><input autoFocus value={confirmationText} onChange={(e) => setConfirmationText(e.target.value.toUpperCase())} disabled={placing} className="mt-2 w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-mono text-sm text-ink outline-none focus:border-neg"/></label>
      </div>}
    </Modal>
  </div>
}

function CurrentPutCard({ put, account, check, checking, now, rollWindowDays, onCheck, onCompare }: { put: Position; account?: Account; check?: { bid: number; ask: number; mark: number; value: number; dte: number; rollBy: string; recommendation: 'ROLL' | 'HOLD'; reason: string; checkedAt: string }; checking: boolean; now: number; rollWindowDays: number; onCheck: () => void; onCompare?: () => void }) {
  const brokerValue = put.shares * put.lastPrice
  const cost = put.avgCost * put.shares; const pnl = (check?.value ?? brokerValue) - cost; const stale = !!check && now - new Date(check.checkedAt).getTime() > 5 * 60_000
  return <section className="card p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-[10px] font-semibold uppercase tracking-[.14em] text-faint">Current protective put</div><h3 className="mt-1 text-lg font-semibold">{put.underlying ?? put.symbol} ${put.strike?.toFixed(2) ?? '—'} put</h3><div className="mt-1 font-mono text-[10px] text-faint">{optionSymbolForPosition(put) || put.symbol} · {account?.name ?? put.accountId}</div></div>{check ? <span className={clsx('rounded-full px-3 py-1 text-xs font-semibold', check.recommendation === 'ROLL' ? 'bg-[#c7a96b]/15 text-[#e1c887]' : 'bg-pos/10 text-pos')}>{check.recommendation === 'ROLL' ? 'Comparison required' : 'Outside review window'}</span> : <span className="rounded-full bg-surface-2 px-3 py-1 text-xs text-muted">Checking live quote…</span>}</div>{stale && <div className="mt-3 rounded-lg border border-[#c7a96b]/25 bg-[#c7a96b]/5 px-3 py-2 text-xs text-[#e1c887]">Quote is over five minutes old. Refresh before making a decision.</div>}<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><SummaryMetric label="Market value" value={usd(check?.value ?? brokerValue)}/><SummaryMetric label="Original cost" value={usd(cost)}/><SummaryMetric label="Unrealized P/L" value={usd(pnl, { sign: true })} tone={pnl < 0 ? 'warn' : undefined}/><SummaryMetric label="Bid liquidation value" value={check ? usd(check.bid * 100 * Math.trunc(put.shares)) : 'Refreshing'}/><SummaryMetric label="Live mark / share" value={check ? usd(check.mark) : 'Refreshing'}/><SummaryMetric label="Bid / ask" value={check ? `${usd(check.bid)} / ${usd(check.ask)}` : 'Refreshing'}/><SummaryMetric label="Expiration" value={put.expiration ? shortDate(put.expiration) : 'Unknown'}/><SummaryMetric label="Time remaining" value={check ? `${check.dte} DTE` : 'Refreshing'}/></div>{check && <div className={clsx('mt-4 rounded-xl border p-3 text-xs leading-5', check.recommendation === 'ROLL' ? 'border-[#c7a96b]/25 bg-[#c7a96b]/5 text-[#e1c887]' : 'border-pos/20 bg-pos/5 text-muted')}><strong className={check.recommendation === 'ROLL' ? 'text-[#e1c887]' : 'text-pos'}>{check.recommendation === 'ROLL' ? 'Review timing:' : 'Timing note:'}</strong> {check.reason}<div className="mt-1 text-[10px] text-faint">Timing only, not a roll recommendation. Compare holding versus rolling above. Window: your {rollWindowDays}-day timing rule. Liquidity and replacement quality are checked before a ticket is prepared. Quote checked {new Date(check.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</div></div>}<div className="mt-4 flex flex-wrap justify-end gap-2"><Button onClick={onCheck} disabled={checking || !['QQQ', 'SPY'].includes(normTicker(put.underlying ?? ''))}>{checking ? <><LoaderCircle size={14} className="animate-spin"/> Checking Schwab…</> : 'Refresh quote'}</Button><Button onClick={onCompare} disabled={!onCompare}>Compare protection options</Button></div></section>
}

function RollWorkflow({ rolls, checked }: { rolls: HedgeRoll[]; checked: boolean }) {
  const roll = rolls[0]
  const needsClose = !!roll?.closeOptionSymbol
  const commonComplete = [checked, !!roll, roll?.previewState === 'accepted']
  const complete = needsClose
    ? [...commonComplete, !!roll?.closeOrderId, roll?.closeOrderStatus === 'FILLED', !!roll?.orderId]
    : [...commonComplete, !!roll?.orderId]
  const labels = needsClose
    ? ['Check holdings', 'Review plan', 'Preview with Schwab', 'Confirm close', 'Verify close fill', 'Confirm purchase']
    : ['Check holdings', 'Review plan', 'Preview with Schwab', 'Confirm purchase']
  return <div className={clsx('mt-5 grid gap-2', needsClose ? 'grid-cols-3 sm:grid-cols-6' : 'grid-cols-2 sm:grid-cols-4')}>{labels.map((label, index) => <div key={label} className={clsx('rounded-lg border px-2 py-2 text-center text-[10px]', complete[index] ? 'border-pos/20 bg-pos/5 text-pos' : index === complete.findIndex((done) => !done) ? 'border-[#c7a96b]/30 bg-[#c7a96b]/5 text-[#e1c887]' : 'border-border-soft text-faint')}><span className="block font-bold">{index + 1}</span>{label}</div>)}</div>
}

function CompletedRollHistory({ rolls, accounts }: { rolls: HedgeRoll[]; accounts: Account[] }) {
  const total = rolls.reduce((sum, roll) => sum + (roll.closeEstimatedPL ?? 0), 0)
  const cost = rolls.reduce((sum, roll) => sum + roll.grossPremium - (roll.closeLimitCredit ?? 0) * 100 * (roll.closeContracts ?? 0), 0)
  return <details className="card p-0"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5"><div><h3 className="font-semibold">Completed roll history</h3><p className="mt-1 text-xs text-faint">{rolls.length} completed · estimated put P/L <span className={total >= 0 ? 'text-pos' : 'text-neg'}>{usd(total, { sign: true })}</span> · cumulative net hedge cost {usd(cost)}</p></div><ChevronRight size={17} className="text-faint"/></summary><div className="border-t border-border-soft p-4"><div className="space-y-2">{rolls.map((roll) => <div key={roll.id} className="grid gap-2 rounded-lg bg-surface-2/40 p-3 text-xs sm:grid-cols-[1fr_auto_auto]"><div><strong>{roll.proxy} ${roll.strike.toFixed(2)} put</strong><div className="mt-1 text-faint">{accounts.find((account) => account.id === roll.accountId)?.name ?? roll.accountId} · {shortDate(roll.expiration)} · {roll.status}</div></div><div className="num sm:text-right"><span className="text-faint">Net hedge cost</span><div>{usd(roll.grossPremium - (roll.closeLimitCredit ?? 0) * 100 * (roll.closeContracts ?? 0))}</div></div><div className="num sm:text-right"><span className="text-faint">Put P/L</span><div className={(roll.closeEstimatedPL ?? 0) >= 0 ? 'text-pos' : 'text-neg'}>{roll.closeEstimatedPL == null ? 'Unavailable' : `${usd(roll.closeEstimatedPL, { sign: true })} est.`}</div></div></div>)}</div><p className="mt-3 text-[10px] text-faint">P/L is estimated from recorded cost basis and the close limit because Schwab’s current order-status response does not include an execution price. Confirm against brokerage records for tax reporting.</p></div></details>
}

function ProtectivePutTutorial() {
  const steps = [
    ['Choose the holding', 'Select the stock or ETF you want to insure. A standard equity option contract controls 100 shares.'],
    ['Choose coverage', 'Full coverage targets every share. Partial coverage costs less but leaves some downside exposed. Use contract rounding deliberately for odd lots.'],
    ['Set your loss tolerance', 'A 15% drawdown suggests a strike near 15% below today’s price. Premium means the effective loss limit is slightly larger.'],
    ['Load the Schwab chain', 'Open Schwab option-chain quotes, choose the same holding, and load puts expiring roughly 7–240 days from now.'],
    ['Review the ranked matches', 'Set the protection threshold and target horizon. Best match balances the after-premium floor, duration, spread, open interest, volume, and cost—it is not simply the cheapest put.'],
    ['Use a quote', 'Choose a contract near the target strike. Use quote sends its actual strike, expiration, and ask into the engine. The ask is conservative, not a guaranteed fill.'],
    ['Review the hedge', 'Check uncovered shares, maximum loss, break-even, annualized premium drag, Greeks, implied volatility, and expiration scenarios.'],
    ['Verify before trading', 'Copy the ticket and confirm the option symbol, multiplier, deliverable, limit price, expiration, liquidity, and total debit in Schwab.'],
  ]
  return (
    <details className="card group p-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#c7a96b]/10 text-[#d8bd7a]"><ClipboardList size={18}/></div>
        <div><h3 className="font-semibold">How to use protective puts</h3><p className="mt-0.5 text-xs text-faint">An eight-step live-quote walkthrough with an example and Schwab checklist</p></div>
        <ChevronRight size={17} className="ml-auto text-faint transition-transform group-open:rotate-90"/>
      </summary>
      <div className="border-t border-border-soft p-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {steps.map(([title, body], i) => <div key={title} className="rounded-xl border border-border-soft bg-surface-2/35 p-4"><div className="mb-2 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-brand/10 text-xs font-bold text-brand">{i + 1}</span><span className="text-sm font-semibold">{title}</span></div><p className="text-xs leading-5 text-muted">{body}</p></div>)}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[#c7a96b]/20 bg-[#c7a96b]/5 p-4"><div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#cbb77f]">Live-quote example</div><p className="mt-2 text-sm leading-6 text-muted">You own 250 shares at $100 and target protection below $85. Load the chain and select an $85 put offered at $2. Rounding down buys 2 contracts for $400, protects 200 shares, leaves 50 uncovered, and creates an $83 effective floor on protected shares before taxes and fees.</p></div>
          <div className="rounded-xl border border-border-soft bg-surface-2/35 p-4"><div className="text-[10px] font-semibold uppercase tracking-[.14em] text-faint">Reading the quote</div><p className="mt-2 text-sm leading-6 text-muted">Bid is what buyers currently offer; ask is what sellers request; mark is generally between them. Delta estimates price sensitivity, theta estimates daily time decay, and implied volatility reflects option pricing—not a forecast. Quotes and Greeks can move quickly and may be delayed.</p></div>
        </div>
        <div className="mt-4 rounded-lg border border-[#5a3a16] bg-[#38240f]/55 p-3 text-xs leading-5 text-[#e7c88f]">The scenario table models intrinsic value at expiration. It does not predict early-sale value or include dividends, taxes, commissions, volatility changes, or assignment mechanics. Educational planning tool—not individualized investment advice.</div>
      </div>
    </details>
  )
}

function LivePutQuotes({ positions, accounts, symbolFilter, positionId: controlledId }: { positions: Position[]; accounts: Account[]; symbolFilter?: string; positionId?: string }) {
  const eligible = useMemo(() => {
    const allowed = symbolFilter?.split(',').map(normTicker)
    const rows = positions.filter((p) => !p.isOption && p.shares > 0 && p.lastPrice > 0 && (!allowed || allowed.includes(normTicker(p.symbol))))
    for (const symbol of allowed ?? []) if (!rows.some((p) => normTicker(p.symbol) === symbol)) rows.push({ id: `proxy-${symbol}`, accountId: '', symbol, name: `${symbol} hedge proxy`, shares: 0, avgCost: 0, lastPrice: 0, prevClose: 0, dividendsReceived: 0 })
    return rows.sort((a, b) => b.shares * b.lastPrice - a.shares * a.lastPrice)
  }, [positions, symbolFilter])
  const [positionId, setPositionId] = useState(() => eligible[0]?.id ?? '')
  const quoteRequest = useRef(0)
  const [quotes, setQuotes] = useState<PutQuote[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [targetDrawdown, setTargetDrawdown] = useState(15)
  const [targetDays, setTargetDays] = useState(90)
  const [meta, setMeta] = useState<{ fetchedAt?: string; delayed?: boolean; underlyingPrice?: number | null }>({})
  const activeId = controlledId ?? positionId
  const position = eligible.find((p) => p.id === activeId) ?? eligible[0]
  const rankedQuotes = useMemo(() => quotes
    .map((quote) => ({ quote, fit: rankProtectivePut(quote, meta.underlyingPrice ?? position?.lastPrice ?? 0, targetDrawdown, targetDays) }))
    .filter(({ fit }) => fit.eligible)
    .sort((a, b) => b.fit.score - a.fit.score), [quotes, meta.underlyingPrice, position?.lastPrice, targetDrawdown, targetDays])
  const load = async () => {
    if (!position) return
    const request = ++quoteRequest.current
    setLoading(true); setError(''); setQuotes([])
    const from = new Date(); from.setDate(from.getDate() + 7)
    const to = new Date(); to.setDate(to.getDate() + 240)
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const result = await schwabPutChain(position.symbol, iso(from), iso(to))
    if (request !== quoteRequest.current) return
    setLoading(false)
    if (!result.ok) { setQuotes([]); setError(result.error === 'not_connected' || result.error === 'refresh_expired' ? 'Connect or reconnect Schwab to load option quotes.' : result.error || 'Quotes unavailable.'); return }
    setQuotes(result.contracts ?? [])
    setMeta({ fetchedAt: result.fetchedAt, delayed: result.delayed, underlyingPrice: result.underlyingPrice })
  }
  const selectQuote = (quote: PutQuote) => {
    const premium = quote.ask ?? 0
    window.dispatchEvent(new CustomEvent('simonfire:put-quote', { detail: { positionId: position?.id, symbol: position?.symbol, optionSymbol: quote.symbol, underlyingPrice: meta.underlyingPrice ?? undefined, strike: quote.strike, expiration: quote.expiration, premium, fetchedAt: meta.fetchedAt, delayed: meta.delayed !== false, alternatives: rankedQuotes.slice(0, 3).map(({ quote: q }) => ({ strike: q.strike, premium: q.ask!, expiration: q.expiration })) } }))
    document.getElementById('protective-put-inputs')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <details className="card group p-0" open>
      <summary className="flex cursor-pointer list-none items-center gap-3 p-5"><Activity size={19} className="text-pos"/><div><h3 className="font-semibold">Schwab option-chain quotes</h3><p className="mt-0.5 text-xs text-faint">Rank contracts against your protection floor, time horizon, cost, and liquidity</p></div><ChevronRight size={17} className="ml-auto text-faint transition-transform group-open:rotate-90"/></summary>
      <div className="border-t border-border-soft p-5">
        <div className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_160px_160px_auto]">
          <label hidden={!!controlledId} className="text-xs text-muted"><span>{symbolFilter ? 'Hedge proxy' : 'Holding to protect'}</span><select value={position?.id ?? ''} onChange={(e) => { quoteRequest.current++; setLoading(false); setPositionId(e.target.value); setQuotes([]); setError(''); setMeta({}) }} className="mt-1 w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink">{eligible.map((p) => <option key={p.id} value={p.id}>{p.symbol}{p.shares > 0 ? ` · ${p.shares} shares · ${accounts.find((a) => a.id === p.accountId)?.name ?? 'Account'}` : ' · portfolio hedge proxy'}</option>)}</select></label>
          <label className="text-xs text-muted"><span>Protection begins near</span><div className="mt-1 flex rounded-xl border border-border bg-surface-2 px-3"><input type="number" min={1} max={90} value={targetDrawdown} onChange={(e) => setTargetDrawdown(Math.max(1, Math.min(90, +e.target.value)))} className="num w-full bg-transparent py-2.5 outline-none"/><span className="my-auto">% down</span></div></label>
          <label className="text-xs text-muted"><span>Target horizon</span><div className="mt-1 flex rounded-xl border border-border bg-surface-2 px-3"><input type="number" min={7} max={240} value={targetDays} onChange={(e) => setTargetDays(Math.max(7, Math.min(240, +e.target.value)))} className="num w-full bg-transparent py-2.5 outline-none"/><span className="my-auto">days</span></div></label>
          <Button onClick={load} disabled={loading || !position}>{loading ? <LoaderCircle size={14} className="animate-spin"/> : <Activity size={14}/>} {loading ? 'Loading quotes' : 'Load Schwab quotes'}</Button>
        </div>
        <p className="mt-3 text-xs text-faint">Target floor: {position ? usd((meta.underlyingPrice ?? position.lastPrice) * (1 - targetDrawdown / 100)) : '—'}. Scores favor effective protection after premium, target duration, tighter spreads, open interest, volume, and lower premium drag.</p>
        {error && <div className="mt-4 rounded-lg border border-neg/30 bg-neg/10 p-3 text-xs text-neg">{error}</div>}
        {rankedQuotes.length > 0 && <>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint"><span>{rankedQuotes.length} priced puts ranked</span>{meta.underlyingPrice != null && <span>Underlying {usd(meta.underlyingPrice)}</span>}<span>{meta.delayed ? 'Delayed market data' : 'Schwab market data'}</span>{meta.fetchedAt && <span>Fetched {new Date(meta.fetchedAt).toLocaleTimeString()}</span>}</div>
          <div className="mt-3 max-h-[480px] overflow-auto rounded-xl border border-border-soft"><table className="w-full min-w-[1080px] text-sm"><thead className="sticky top-0 z-10 bg-surface"><tr className="text-xs text-muted"><th className="px-3 py-2 text-left">Fit</th><th className="px-3 py-2 text-left">Expiration</th><th className="px-3 py-2 text-right">DTE</th><th className="px-3 py-2 text-right">Strike</th><th className="px-3 py-2 text-right">Effective floor</th><th className="px-3 py-2 text-right">Bid</th><th className="px-3 py-2 text-right">Ask</th><th className="px-3 py-2 text-right">Mark</th><th className="px-3 py-2 text-right">IV</th><th className="px-3 py-2 text-right">Delta</th><th className="px-3 py-2 text-right">Volume</th><th className="px-3 py-2 text-right">Open interest</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>{rankedQuotes.map(({ quote: q, fit }, index) => <tr key={q.symbol} className={clsx('border-t border-border-soft', index === 0 ? 'bg-pos/[.08] shadow-[inset_3px_0_0_#3fd88a]' : index < 3 ? 'bg-[#c7a96b]/[.04]' : '')}><td className="px-3 py-2"><div className="flex items-center gap-2"><span className={clsx('rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide', index === 0 ? 'bg-pos/15 text-pos' : index < 3 ? 'bg-[#c7a96b]/10 text-[#d8bd7a]' : 'bg-surface-2 text-muted')}>{index === 0 ? 'Best match' : index === 1 ? 'Alternative' : index === 2 ? 'Third choice' : fit.score}</span>{index < 3 && <span className="num text-xs text-muted">{fit.score}/100</span>}</div><div className="mt-1 max-w-[190px] text-[10px] text-faint">{fit.reasons.join(' · ')}</div></td><td className="px-3 py-2">{shortDate(q.expiration)}</td><td className="num px-3 py-2 text-right text-muted">{q.daysToExpiration ?? '—'}</td><td className="num px-3 py-2 text-right font-semibold">{usd(q.strike)}</td><td className="num px-3 py-2 text-right text-pos">{usd(fit.effectiveFloor)}</td><td className="num px-3 py-2 text-right">{q.bid == null ? '—' : usd(q.bid)}</td><td className="num px-3 py-2 text-right">{q.ask == null ? '—' : usd(q.ask)}</td><td className="num px-3 py-2 text-right">{q.mark == null ? '—' : usd(q.mark)}</td><td className="num px-3 py-2 text-right text-muted">{q.volatility == null ? '—' : pct(q.volatility)}</td><td className="num px-3 py-2 text-right text-muted">{q.delta?.toFixed(3) ?? '—'}</td><td className="num px-3 py-2 text-right text-muted">{intfmt(q.volume ?? 0)}</td><td className="num px-3 py-2 text-right text-muted">{intfmt(q.openInterest ?? 0)}</td><td className="px-3 py-2 text-right"><Button variant={index === 0 ? 'primary' : undefined} onClick={() => selectQuote(q)}>Use quote</Button></td></tr>)}</tbody>
          </table></div>
          <p className="mt-3 text-xs text-faint">Ranking is decision support, not a recommendation or fill guarantee. “Use quote” starts with the ask; review the spread and choose your actual limit in Schwab.</p>
        </>}
      </div>
    </details>
  )
}

function ProtectivePutsEngine({ positions, accounts, positionId: controlledId, onPositionChange }: { positions: Position[]; accounts: Account[]; positionId?: string; onPositionChange?: (id: string) => void }) {
  const eligible = useMemo(() => positions.filter((p) => !p.isOption && p.shares > 0 && p.lastPrice > 0).sort((a, b) => b.shares * b.lastPrice - a.shares * a.lastPrice), [positions])
  const [positionId, setPositionId] = useState(() => eligible[0]?.id ?? '')
  const [coverage, setCoverage] = useState(100)
  const [drawdown, setDrawdown] = useState(15)
  const [premium, setPremium] = useState(0)
  const [expiry, setExpiry] = useState('')
  const [rounding, setRounding] = useState<'down' | 'nearest' | 'up'>('down')
  const [quoteStrike, setQuoteStrike] = useState<number | undefined>()
  const [copied, setCopied] = useState(false)
  const activeId = controlledId ?? positionId
  const p = eligible.find((row) => row.id === activeId) ?? eligible[0]
  useEffect(() => {
    const applyQuote = (event: Event) => {
      const detail = (event as CustomEvent<{ positionId?: string; strike: number; expiration: string; premium: number }>).detail
      if (detail.positionId) { setPositionId(detail.positionId); onPositionChange?.(detail.positionId) }
      setQuoteStrike(detail.strike)
      setExpiry(detail.expiration)
      setPremium(detail.premium)
    }
    window.addEventListener('simonfire:put-quote', applyQuote)
    return () => window.removeEventListener('simonfire:put-quote', applyQuote)
  }, [onPositionChange])
  if (!p) return <div className="card p-10 text-center text-sm text-muted">No eligible long equity positions are available to hedge.</div>
  const hedge = protectivePutPlan({ shares: p.shares, sharePrice: p.lastPrice, coveragePct: coverage, maxDrawdownPct: drawdown, premiumPerShare: premium, contractRounding: rounding, strikePrice: quoteStrike })
  const { contracts, coveredShares, uncoveredShares, overhedgedShares, strike, premiumCost, protectedNotional: protectedValue, positionValue, effectiveFloor, premiumDrag, breakEvenPrice, maxLoss, maxLossPct } = hedge
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const expiryDate = expiry ? new Date(`${expiry}T00:00:00`) : null
  const daysToExpiry = expiryDate ? Math.ceil((expiryDate.getTime() - today.getTime()) / 86_400_000) : null
  const annualizedDrag = daysToExpiry && daysToExpiry > 0 ? premiumDrag * 365 / daysToExpiry : null
  const scenarios = [25, 15, 0, -drawdown, -30, -50]
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => b - a)
    .map((move) => ({ move, ...protectivePutOutcome(hedge, p.lastPrice * (1 + move / 100)) }))
  const account = accounts.find((a) => a.id === p.accountId)
  const ticket = `BUY TO OPEN ${contracts} ${p.symbol} PUT ${expiry || '[EXPIRY]'} $${strike.toFixed(2)} @ $${premium.toFixed(2)} LIMIT (${account?.name ?? p.accountId})`
  const copy = async () => { try { await navigator.clipboard.writeText(ticket); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* unavailable */ } }
  return <div className="space-y-4"><div className="card p-5"><div className="flex items-start gap-3"><ShieldCheck size={20} className="mt-0.5 text-brand"/><div><h3 className="text-lg font-semibold">Protective Puts Engine</h3><p className="mt-1 text-xs text-faint">Model contract sizing, hedge cost, loss limits, and expiration outcomes. Quotes and strikes remain manual planning inputs.</p></div></div><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><label hidden={!!controlledId} className="text-xs text-muted"><span>Position</span><select value={p.id} onChange={(e) => { setPositionId(e.target.value); setQuoteStrike(undefined); setPremium(0); setExpiry('') }} className="mt-1 w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink">{eligible.map((row) => <option key={row.id} value={row.id}>{row.symbol} · {row.shares} shares · {accounts.find((a) => a.id === row.accountId)?.name}</option>)}</select></label><label className="text-xs text-muted"><span>Coverage</span><div className="mt-1 flex rounded-xl border border-border bg-surface-2 px-3"><input type="number" min={1} max={100} value={coverage} onChange={(e) => setCoverage(Math.max(1, Math.min(100, +e.target.value)))} className="num w-full bg-transparent py-2.5 outline-none"/><span className="my-auto">%</span></div></label><label className="text-xs text-muted"><span>Maximum tolerated drawdown</span><div className="mt-1 flex rounded-xl border border-border bg-surface-2 px-3"><input type="number" min={1} max={90} value={drawdown} onChange={(e) => setDrawdown(Math.max(1, Math.min(90, +e.target.value)))} className="num w-full bg-transparent py-2.5 outline-none"/><span className="my-auto">%</span></div></label><label className="text-xs text-muted"><span>Expiration</span><input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm [color-scheme:dark]"/></label><label className="text-xs text-muted"><span>Premium per share (manual quote)</span><div className="mt-1 flex rounded-xl border border-border bg-surface-2 px-3"><span className="my-auto">$</span><input type="number" min={0} step={.01} value={premium} onChange={(e) => setPremium(Math.max(0, +e.target.value))} className="num w-full bg-transparent py-2.5 pl-1 outline-none"/></div></label><label className="text-xs text-muted"><span>Contract rounding</span><select value={rounding} onChange={(e) => setRounding(e.target.value as typeof rounding)} className="mt-1 w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink"><option value="down">Down · avoid overhedging</option><option value="nearest">Nearest 100 shares</option><option value="up">Up · meet requested coverage</option></select></label></div>{daysToExpiry != null && daysToExpiry <= 0 && <div className="mt-4 rounded-lg border border-neg/30 bg-neg/10 p-3 text-xs text-neg">Expiration must be in the future.</div>}{contracts === 0 && <div className="mt-4 rounded-lg border border-[#5a3a16] bg-[#38240f]/70 p-3 text-xs text-[#e7c88f]">This position and coverage produce fewer than 100 protected shares. Choose round up to model one contract.</div>}</div><div className="card p-5"><div className="grid grid-cols-2 gap-5 lg:grid-cols-4"><SummaryMetric label="Contracts" value={String(contracts)} /><SummaryMetric label="Premium cost" value={usd(premiumCost)} /><SummaryMetric label="Maximum modeled loss" value={`${usd(maxLoss)} · ${pct(maxLossPct * 100)}`} tone={maxLossPct > drawdown / 100 ? 'warn' : undefined} /><SummaryMetric label="Effective floor / share" value={usd(effectiveFloor)} /></div><details className="mt-4 text-xs"><summary className="cursor-pointer font-semibold text-muted">All numbers</summary><div className="mt-3 grid grid-cols-2 gap-5 lg:grid-cols-4"><SummaryMetric label="Suggested strike" value={usd(strike)} /><SummaryMetric label="Shares protected" value={`${coveredShares} / ${p.shares}`} /><SummaryMetric label="Shares uncovered" value={String(uncoveredShares)} tone={uncoveredShares > 0 ? 'warn' : undefined} /><SummaryMetric label="Break-even at expiry" value={usd(breakEvenPrice)} /><SummaryMetric label="Premium drag" value={pct(premiumDrag * 100)} tone={premiumDrag > .03 ? 'warn' : undefined} /><SummaryMetric label="Annualized drag" value={annualizedDrag == null ? 'Select expiry' : pct(annualizedDrag * 100)} tone={annualizedDrag != null && annualizedDrag > .05 ? 'warn' : undefined} /><SummaryMetric label="Protected notional" value={usd(protectedValue)} /><SummaryMetric label="Current position" value={usd(positionValue)} /></div></details>{overhedgedShares > 0 && <div className="mt-4 rounded-lg border border-[#5a3a16] bg-[#38240f]/70 p-3 text-xs text-[#e7c88f]">This rounds above the holding by {overhedgedShares} shares. Results below the strike include that extra put exposure.</div>}</div><div className="card overflow-x-auto p-0"><div className="p-5"><h3 className="font-semibold">Expiration scenario analysis</h3><p className="mt-1 text-xs text-faint">Intrinsic value at expiration only. Excludes taxes, commissions, dividends, volatility, and early sale value.</p></div><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-y border-border-soft text-xs text-muted"><th className="px-5 py-3 text-left">Underlying move</th><th className="px-4 py-3 text-right">Price</th><th className="px-4 py-3 text-right">Stock + put value</th><th className="px-5 py-3 text-right">Net P/L after premium</th></tr></thead><tbody>{scenarios.map((row) => <tr key={row.move} className="border-b border-border-soft"><td className={clsx('px-5 py-3 font-semibold', row.move < 0 ? 'text-neg' : row.move > 0 ? 'text-pos' : '')}>{row.move > 0 ? '+' : ''}{row.move}%</td><td className="num px-4 py-3 text-right">{usd(row.expirationPrice)}</td><td className="num px-4 py-3 text-right">{usd(row.terminalValue)}</td><td className={clsx('num px-5 py-3 text-right', row.pnl >= 0 ? 'text-pos' : 'text-neg')}>{usd(row.pnl, { sign: true })} · {pct(row.returnPct * 100)}</td></tr>)}</tbody></table></div><div className="card p-5"><div className="rounded-xl border border-[#c7a96b]/20 bg-[#c7a96b]/5 p-4"><div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#cbb77f]">Reviewable hedge ticket</div><div className="num mt-2 break-words text-sm">{ticket}</div><div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-faint">Confirm the option multiplier, deliverable, liquidity, expiration, strike, and live premium in Schwab. Maximum loss assumes the hedge is held through expiration.</p><Button onClick={copy} disabled={!contracts || premium <= 0 || !expiry || daysToExpiry == null || daysToExpiry <= 0}>{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? 'Copied' : 'Copy ticket'}</Button></div></div></div></div>
}

