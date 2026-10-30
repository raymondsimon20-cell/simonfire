import { useEffect, useMemo, useRef, useState } from 'react'
import type { Account, Position } from '../lib/types'
import { reconcileProtectionHoldings, type SchwabProtectionAccount } from '../lib/schwab-protection-data'
import { schwabPutChain, type PutQuote, type PutChainResult } from '../lib/api'
import { useReviewCache } from '../lib/use-review-cache'
import { parseCsv } from '../lib/import'
import { portfolioSummary } from '../lib/calc'
import { brokerageDate } from '../lib/balance-snapshots'
import { riskKey, rankPortfolioProtection, type HoldingRisk, type ProtectionInput, protectionAiEvidence, type ProtectionAiEvidence, buildProtectionOrderDraft, type ProtectionOrderDraft } from '../lib/portfolio-protection'
import { usd, pct } from '../lib/format'
import { Button } from './ui'
import { downloadCsv } from '../lib/csv'

const control = 'w-full rounded-lg border border-border bg-surface-2 p-2 text-xs text-ink'
function RiskNumber({ label, value, min, max, commit, precision, placeholder = 'Unknown' }: { label: string; value?: number; min: number; max: number; commit: (n: number | undefined) => void; precision?: number; placeholder?: string }) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const original = useRef<number | undefined>(value)
  return <input aria-label={label} type="number" step="any" min={min} max={max} placeholder={placeholder} value={editing ? draft : value == null ? '' : precision == null ? value : value.toFixed(precision)} onFocus={() => {original.current=value;setDraft(value == null ? '' : String(value));setEditing(true)}} onChange={(e)=>setDraft(e.target.value)} onBlur={()=>{setEditing(false);const n=Number(draft);const entered=draft.trim()&&Number.isFinite(n)?n:undefined;if(entered===original.current)return;const next=entered==null?undefined:Math.min(max,Math.max(min,entered));if(!Object.is(next,original.current))commit(next)}} onKeyDown={(e)=>{if(e.key==='Enter')e.currentTarget.blur()}} className={control}/>
}
const schwabMaintenance = (source?: string) => source?.startsWith('Schwab position maintenance') === true
const symbolKey = (symbol: string) => symbol.trim().toUpperCase().replace(/\s/g, '')
function matchSchwabAccount(id: string, accounts: Account[], fetched: SchwabProtectionAccount[]) {
  const exact = fetched.filter((a) => a.accountId === id)
  if (exact.length) return exact.length === 1 ? exact[0] : undefined
  const mask = accounts.find((a) => a.id === id)?.mask ?? id.replace(/^csv:/, '').match(/(?:^|\D)(\d{4})\s*$/)?.[1]
  if (!mask || !/^\d{4}$/.test(mask)) return undefined
  const matches = fetched.filter((a) => a.mask === mask)
  return matches.length === 1 ? matches[0] : undefined
}
export function PortfolioProtection({ positions, accounts, onReviewEvidence, onPrepareOrder }: { positions: Position[]; accounts: Account[]; onReviewEvidence?: (value: ProtectionAiEvidence | null) => void; onPrepareOrder?: (draft: ProtectionOrderDraft) => void }) {
  const [snapshot, setSnapshot] = useState<{ positions: Position[]; file: string } | null>(null)
  const [analysisAccount, setAnalysisAccount] = useState(() => {
    const totals = new Map<string,number>()
    for (const p of positions) totals.set(p.accountId,(totals.get(p.accountId)??0)+Math.abs(p.shares*p.lastPrice))
    return [...totals].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? accounts[0]?.id ?? 'all'
  })
  const [schwabBalance, setSchwabBalance] = useState<{ accountId: string; cash: number | null; debt: number | null; sourceKey: string; fetchedAt?: string; positions?: SchwabProtectionAccount['positions'] } | null>(null)
  const savedContext = JSON.stringify([positions,accounts])
  const currentBrokerData = !snapshot && schwabBalance?.sourceKey===savedContext ? schwabBalance : null
  const reconciliation = useMemo(()=>currentBrokerData?.positions ? reconcileProtectionHoldings(positions.filter(p=>p.accountId===currentBrokerData.accountId),currentBrokerData.positions) : null,[positions,currentBrokerData])
  const sourceRows = useMemo(()=>snapshot?.positions ?? (reconciliation?.matches && currentBrokerData ? [...positions.filter(p=>p.accountId!==currentBrokerData.accountId),...reconciliation.positions] : positions),[snapshot,reconciliation,currentBrokerData,positions])
  const rows = useMemo(() => sourceRows.filter((p) => analysisAccount === 'all' || p.accountId === analysisAccount), [sourceRows, analysisAccount])
  const stocks = rows.filter((p) => !p.isOption && p.shares !== 0)
  const [risks, setRisks, saveError] = useReviewCache<Record<string, HoldingRisk>>('simonfire.protection.risks.v1', {})
  const [chain, setChain] = useState<PutChainResult | null>(null)
  const [horizonDays, setHorizon] = useState(30)
  const [ratePct, setRate] = useState(8)
  const [feePerContract, setFee] = useState(.65)
  const [budget, setBudget] = useState(5000)
  const [maxContracts, setMaxContracts] = useState(30)
  const [debtOverride, setDebt] = useState<number | null>(null)
  const [cashOverride, setCash] = useState(0)
  const [confirmed, setConfirmed] = useState(false)
  const [closePositionId, setClose] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState('')
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setClock(() => Date.now()), 30000); return () => window.clearInterval(timer) }, [])
  const summary = portfolioSummary(rows, accounts, analysisAccount, [])
  const savedAccount = analysisAccount === 'all' ? accounts.length === 1 ? accounts[0] : undefined : accounts.find((a) => a.id === analysisAccount)
  const balance = currentBrokerData?.accountId === savedAccount?.id ? currentBrokerData : null
  const inventoryChanged = !!balance && !!reconciliation && !reconciliation.matches
  const balanceAge = clock - Date.parse(balance?.fetchedAt ?? '')
  const needsBrokerRefresh = !snapshot && (!balance || !reconciliation || !Number.isFinite(balanceAge) || balanceAge < -60000 || balanceAge > 5 * 60000)
  const balanceUnknown = !!balance && (balance.cash == null || balance.debt == null || inventoryChanged)
  const debt = debtOverride ?? (snapshot ? 0 : inventoryChanged ? summary.marginUsed : balance?.debt ?? summary.marginUsed)
  // Refreshed assets and debt must describe the same inventory and price snapshot.
  const gross = snapshot ? rows.reduce((sum,p) => sum + p.shares * p.lastPrice, 0) + cashOverride : balance && reconciliation?.matches && balance.cash!=null ? rows.reduce((sum,p)=>sum+p.shares*p.lastPrice,0)+balance.cash : summary.gross
  const context = JSON.stringify([analysisAccount, snapshot?.file, (snapshot?.positions ?? positions).map((p) => [p.id,p.accountId,p.symbol,p.shares,p.lastPrice]), accounts.map((a) => [a.id,a.mask,a.cash,a.marginBalance])])
  const currentContext = useRef(context)
  useEffect(() => { currentContext.current = context; return () => { currentContext.current = '' } }, [context])
  const qqqPrice = chain?.underlyingPrice ?? rows.find((p) => !p.isOption && p.symbol === 'QQQ')?.lastPrice ?? 0
  const quotes = useMemo(() => (chain?.contracts ?? []) as PutQuote[], [chain?.contracts])
  const today = brokerageDate()
  const input: ProtectionInput = useMemo(() => ({ accountCount: analysisAccount === 'all' ? Math.max(accounts.length, new Set(rows.map((p)=>p.accountId)).size) : 1, positions: rows, risks, gross, debt, qqqPrice, today, horizonDays, ratePct, feePerContract, budget, maxContracts, quotes, closePositionId, quoteFetchedAt: chain?.fetchedAt, delayed: chain?.delayed, now: clock }), [analysisAccount, accounts.length, rows, risks, gross, debt, qqqPrice, today, horizonDays, ratePct, feePerContract, budget, maxContracts, quotes, closePositionId, chain?.fetchedAt, chain?.delayed, clock])
  const ranking = useMemo(() => rankPortfolioProtection(input), [input])
  const selectedCandidate = ranking.candidates.find((c) => `${c.quote.symbol}|${c.contracts}` === selected) ?? ranking.recommendation ?? ranking.candidates[0]
  const hold = ranking.hold
  const balancesConfirmed = (!snapshot || confirmed) && !balanceUnknown && !needsBrokerRefresh
  const ready = ranking.ready && balancesConfirmed
  useEffect(() => { onReviewEvidence?.(protectionAiEvidence(input, balancesConfirmed)) }, [input, balancesConfirmed, onReviewEvidence])
  useEffect(() => () => { onReviewEvidence?.(null) }, [onReviewEvidence])
  const issueGroups = new Map<string, string[]>()
  const issues = [...ranking.missing, ...(needsBrokerRefresh ? ['Refresh Schwab balances for the selected account before preparing an order'] : []), ...(snapshot && !confirmed ? ['Snapshot cash and margin debt need confirmation'] : []), ...(balanceUnknown ? [inventoryChanged?'Schwab holdings changed. Sync your portfolio, then refresh this comparison.':'Schwab did not provide cash or debt for the selected account; balances remain unknown'] : [])]
  for (const issue of issues) {
    const category = /maintenance/i.test(issue) ? 'Broker maintenance requirements' : /beta|correlation/i.test(issue) ? 'Price-history evidence' : /leverage/i.test(issue) ? 'Leverage context' : /quote|bid|multiplier/i.test(issue) ? 'Option quotes and contracts' : /account|balance|cash|debt|snapshot/i.test(issue) ? 'Accounts and balances' : 'Unsupported exposure'
    issueGroups.set(category, [...(issueGroups.get(category) ?? []), issue])
  }
  const update = (p: Position, patch: Partial<HoldingRisk>) => setRisks((old) => ({ ...old, [riskKey(p)]: { ...old[riskKey(p)], ...patch } }))
  const loadCsv = async (file?: File) => {
    if (!file) return
    try {
      const csv = parseCsv(await file.text()), header = csv[0], index = (s: string) => header.indexOf(s)
      if (['Holding','Account','Shares','Price','Value'].some((h) => index(h) < 0)) throw new Error('Choose a SimonFIRE Positions CSV with Holding, Account, Shares, Price and Value columns.')
      const parsed: Position[] = csv.slice(1).filter((r) => r[index('Holding')]?.trim()).map((r,i) => {
        const symbol = r[index('Holding')].trim(), name = r[index('Account')]
        const mask = name.match(/(?:^|\D)(\d{4})\s*$/)?.[1]
        const matches = accounts.filter((a) => mask && a.mask === mask)
        const account = matches.length === 1 ? matches[0] : undefined
        const shares = Number(r[index('Shares')]), value = Number(r[index('Value')]), price = Number(r[index('Price')])
        if (![shares,value,price].every(Number.isFinite) || Math.abs(shares * price - value) > .05) throw new Error(`Value check failed for ${symbol}.`)
        const option = symbol.replace(/\s/g,'').match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/)
        return { id: `snapshot-${i}`, accountId: account?.id ?? `csv:${name}`, symbol, name: symbol, shares, lastPrice: price, prevClose: price, avgCost: 0, dividendsReceived: 0, isOption: !!option, underlying: option?.[1], expiration: option ? `20${option[2].slice(0,2)}-${option[2].slice(2,4)}-${option[2].slice(4,6)}` : undefined, optionType: option ? option[3] === 'P' ? 'Put' : 'Call' : undefined, strike: option ? Number(option[4])/1000 : undefined }
      })
      if (!parsed.length || parsed.length > 200) throw new Error('Choose a snapshot with 1–200 holdings.')
      setSnapshot({ positions: parsed, file: file.name }); setCash(0); setAnalysisAccount('all'); setDebt(null); setConfirmed(false); setClose(''); setSelected(''); setMessage('Snapshot loaded for review only. No portfolio records were imported or duplicated. Confirm its debt and cash before relying on results.')
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not read this snapshot.') }
  }
  const fetchHistory = async () => {
    const started = context
    const symbols = [...new Set(stocks.map((p) => p.symbol))]
    setRisks((old) => { const next={...old}; for(const p of stocks) {const key=riskKey(p);if(next[key]?.source?.startsWith('Price history '))next[key]={...next[key],beta:undefined,correlation:undefined,source:undefined}}return next })
    if (!symbols.length) return 'No equity holdings need price history.'
    const response = await fetch(`/.netlify/functions/schwab-risk-history?symbols=${encodeURIComponent(symbols.join(','))}`, { signal: AbortSignal.timeout(30000) })
    const data = await response.json()
    if (currentContext.current !== started) throw new Error('Account or holdings changed. Load risk data again for the current review.')
    if (!response.ok || !data.ok) throw new Error(data.error ?? 'History unavailable')
    setRisks((old) => { const next = { ...old }; for (const p of stocks) { const r = data.bySymbol[p.symbol]; if(r) next[riskKey(p)] = { ...next[riskKey(p)], beta:r.beta, correlation:r.correlation, source:`Price history ${r.from}–${r.through}, ${r.observations} aligned daily returns` } } return next })
    return `${Object.values(data.bySymbol).filter(Boolean).length} of ${symbols.length} symbols have enough aligned price history.`
  }
  const history = async () => {
    setBusy(true); setMessage('')
    try { setMessage(await fetchHistory()) }
    catch(e) { setMessage(e instanceof Error ? e.message : 'History unavailable') }
    finally { setBusy(false) }
  }
  const loadSchwab = async () => {
    const started = context
    setBusy(true); setMessage('')
    // A refresh must not leave a previous automatic requirement verified on failure.
    setRisks((old) => { const next = { ...old }; for (const p of stocks) { const key=riskKey(p); if(schwabMaintenance(next[key]?.maintenanceSource)) next[key]={...next[key],maintenancePct:undefined,maintenanceSource:undefined} } return next })
    if (!snapshot && savedAccount) setSchwabBalance({accountId:savedAccount.id,cash:null,debt:null,sourceKey:savedContext})
    try {
      const response = await fetch('/.netlify/functions/schwab-protection-data', { signal: AbortSignal.timeout(30000) })
      const data = await response.json() as { ok?: boolean; error?: string; fetchedAt?: string; accounts?: SchwabProtectionAccount[] }
      if (currentContext.current !== started) throw new Error('Account or holdings changed. Load Schwab risk data again for the current review.')
      if (!response.ok || !data.ok || !Array.isArray(data.accounts) || !data.fetchedAt || !Number.isFinite(Date.parse(data.fetchedAt))) throw new Error(data.error ?? 'Schwab risk data is unavailable. Previous auto-loaded requirements are now unknown; manual entries were kept.')
      const fetched = data.accounts
      const resolved = stocks.map((p) => {
        const account = matchSchwabAccount(p.accountId, accounts, fetched)
        const matches = account?.positions.filter((r) => symbolKey(r.symbol) === symbolKey(p.symbol)) ?? []
        const position = matches.length === 1 ? matches[0] : undefined
        const snapshotMatches = !snapshot || !!position && Math.abs(position.shares-p.shares)<1e-6 && Math.abs(position.lastPrice-p.lastPrice)<1e-6 && stocks.filter((r)=>riskKey(r)===riskKey(p)).length===1
        const rate = snapshotMatches ? position?.maintenancePct : undefined
        return {p,rate:typeof rate==='number' && Number.isFinite(rate) && rate>=0 && rate<=100 ? rate : undefined,mismatched:!!snapshot && !!position && !snapshotMatches}
      })
      const populated = resolved.filter((r) => r.rate != null).length
      const mismatched = resolved.filter((r) => r.mismatched).length
      setRisks((old) => {
        const next = { ...old }
        for (const {p,rate} of resolved) {
          const key=riskKey(p)
          if (rate != null) next[key]={...next[key],maintenancePct:rate,maintenanceSource:`Schwab position maintenance · ${data.fetchedAt}`}
          else if (schwabMaintenance(next[key]?.maintenanceSource)) next[key]={...next[key],maintenancePct:undefined,maintenanceSource:undefined}
        }
        return next
      })
      if (!snapshot && savedAccount) {
        const account = matchSchwabAccount(savedAccount.id, accounts, fetched)
        setSchwabBalance({accountId:savedAccount.id,sourceKey:savedContext,fetchedAt:data.fetchedAt,positions:account?.positions,cash:typeof account?.cash==='number' && Number.isFinite(account.cash)?account.cash:null,debt:typeof account?.debt==='number' && Number.isFinite(account.debt) && account.debt>=0?account.debt:null})
        setDebt(null)
      }
      const maintenanceMessage = `${populated} of ${stocks.length} holdings received an explicit Schwab maintenance requirement. Unavailable requirements remain unknown; manual entries are preserved when Schwab has no verified rate.${snapshot ? ` Snapshot balances were kept; ${mismatched} holding(s) differed in shares or price and received no current rate.` : !savedAccount ? ' Select one saved account to use fetched cash and debt.' : ' Fetched cash and debt apply only to the selected saved account; missing balances remain unknown.'}`
      let historyMessage: string
      try { historyMessage = await fetchHistory() } catch(e) { historyMessage = e instanceof Error ? `Price history: ${e.message}` : 'Price history unavailable.' }
      if (currentContext.current === started) { const status=`${maintenanceMessage} ${historyMessage}`; setMessage(status); return status }
    } catch(e) { const status=e instanceof Error ? e.message : 'Schwab risk data unavailable. No requirements were invented.'; setMessage(status); return status }
    finally { setBusy(false) }
  }
  const loadQuotes = async () => {
    const started = context
    setBusy(true); setMessage('')
    try {
      const through = new Date(Date.parse(`${brokerageDate()}T12:00:00Z`) + 365 * 86400000).toISOString().slice(0,10)
      const held = rows.find((p) => p.id === closePositionId)
      const result = await schwabPutChain('QQQ', brokerageDate(), through, held?.symbol, 60)
      if(currentContext.current !== started) return 'Account changed. Refresh the analysis for the selected account.'
      setChain(result); setClock(() => Date.now()); setSelected('')
      const status = result.ok ? 'Option quotes refreshed.' : result.error ?? 'Could not refresh option quotes.'
      setMessage(status); return status
    } catch { setChain(null); const status='Could not refresh option quotes. Try again.'; setMessage(status); return status }
    finally { setBusy(false) }
  }
  const refreshAnalysis = async () => {
    const started = context
    const dataStatus = await loadSchwab()
    if(currentContext.current !== started) return
    const quoteStatus = await loadQuotes()
    if(currentContext.current === started) setMessage([dataStatus,quoteStatus].filter(Boolean).join(' '))
  }
  const draft = selectedCandidate && !snapshot ? buildProtectionOrderDraft(input,{symbol:selectedCandidate.quote.symbol,contracts:selectedCandidate.contracts},savedAccount?.id ?? '',balancesConfirmed) : null
  const prepareOrder = () => {
    // Recheck time at the click; the display timer is not a placement gate.
    const currentBalanceAge=Date.now()-Date.parse(balance?.fetchedAt??'')
    const current = selectedCandidate && !snapshot && Number.isFinite(currentBalanceAge) && currentBalanceAge>=-60000 && currentBalanceAge<=5*60000 ? buildProtectionOrderDraft({...input,now:Date.now()},{symbol:selectedCandidate.quote.symbol,contracts:selectedCandidate.contracts},savedAccount?.id ?? '',balancesConfirmed) : null
    if(current && onPrepareOrder) onPrepareOrder(current)
    else setMessage('Refresh the analysis and resolve the remaining items before preparing an order.')
  }
  const exportReview = () => downloadCsv('portfolio-protection-review.csv', [
    ['Scenario','Proxy decline %','Gross assets','Debt with financing','Net equity','Equity %','50% target gap','Maintenance gap (unknown if blank)','Premium','Close credit','Fees','Financing'],
    ...[['HOLD', hold], ...(selectedCandidate ? [['ROLL / ADD candidate', selectedCandidate.stress]] : [])].flatMap(([label, scenarios]) => (scenarios as typeof hold).map((s) => [String(label),s.declinePct,s.gross,s.debt,s.equity,s.equityPct,s.floorGap,s.maintenanceGap ?? '',s.premium,s.closeCredit,s.fees,s.financing])),
  ])
  return <section className="card space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Protect your portfolio</h2><p className="mt-2 text-sm text-muted">Compare protection, review an order, then confirm with Schwab.</p></div><span className="rounded-full border border-brand/30 px-3 py-1 text-xs text-brand">50% equity target</span></div>
    <ol className="grid grid-cols-3 gap-2 text-xs text-muted" aria-label="Protection steps">{['1 · Refresh data','2 · Compare protection','3 · Review & confirm'].map(step=><li key={step} className="rounded-lg border border-border-soft p-3">{step}</li>)}</ol>
    <div className="flex flex-wrap items-end gap-3"><label className="min-w-48 flex-1 text-xs text-muted">Schwab account<select aria-label="Risk-review account" disabled={busy} value={analysisAccount} onChange={(e) => {setAnalysisAccount(e.target.value);setCash(0);setDebt(null);setSchwabBalance(null);setConfirmed(false);setClose('');setSelected('');setMessage('')}} className={control}><option value="all">All accounts · comparison only</option>{[...new Set(sourceRows.map((p)=>p.accountId))].map((id)=><option key={id} value={id}>{accounts.find((a)=>a.id===id)?.name ?? id.replace('csv:','')}</option>)}</select></label><Button variant="primary" disabled={busy || !stocks.length} onClick={refreshAnalysis}>{busy?'Refreshing Schwab…':'Refresh analysis'}</Button><a href="#allocation-ai-review" className="rounded-lg border border-border px-3 py-2 text-sm text-brand">Explain with AI ↑</a></div>
    <div className="grid gap-3 sm:grid-cols-3">{[['Portfolio value',inventoryChanged?'Sync needed':usd(gross)],['Margin debt',balanceUnknown?'Needs refresh':usd(debt)],['Current equity',gross>0&&!balanceUnknown?pct((gross-debt)/gross*100):'Unknown']].map(([label,value])=><div key={label} className="rounded-xl border border-border-soft bg-surface-2/30 p-4"><div className="text-xs text-muted">{label}</div><div className="num mt-2 text-xl font-semibold">{value}</div></div>)}</div>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-muted">What would you like to compare?<select aria-label="Holding versus rolling selection" value={closePositionId} onChange={(e) => {setClose(e.target.value);setSelected('')}} className={control}><option value="">Keep existing puts and add protection</option>{rows.filter((p)=>p.isOption&&p.optionType==='Put'&&p.shares>0&&p.underlying==='QQQ').map((p)=><option key={p.id} value={p.id}>Roll {p.shares} × {p.symbol}</option>)}</select></label><div className="text-xs text-faint">Compare keeping your current protection with adding or replacing puts. Every result includes fees and {horizonDays} days of margin interest.</div></div>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-muted">Maximum purchase cost ($)<RiskNumber label="Purchase budget ($)" value={budget} min={0} max={100000} commit={n=>{if(n!=null)setBudget(n)}}/></label><label className="text-xs text-muted">Your margin interest rate (% / year)<RiskNumber label="Margin financing (% / year)" value={ratePct} min={0} max={50} commit={n=>{if(n!=null)setRate(n)}}/></label></div>
    <p className="text-xs text-faint">Confirm the interest rate against your Schwab account. It is a model input, not a live broker rate.</p>
    <p className="text-xs text-faint">{snapshot ? `Snapshot: ${snapshot.file}` : 'Current selected portfolio'} · {rows.length} rows · {usd(gross)} gross assets. CSV snapshots never append transactions or change holdings.</p>
    {message && <p role="status" className="rounded-lg border border-border-soft p-3 text-xs">{message}</p>}{saveError && <p role="alert" className="text-xs text-neg">Risk inputs could not be saved in this browser.</p>}
    <details className="rounded-xl border border-border-soft p-3"><summary className="cursor-pointer text-sm font-medium">Advanced settings & data sources</summary><div className="mt-4 space-y-4">
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{([
      ['Stress horizon (days)',horizonDays,30,180,setHorizon], ['Fee per contract / leg ($)',feePerContract,0,20,setFee], ['Maximum contracts to compare',maxContracts,1,100,(n:number)=>setMaxContracts(Math.trunc(n))], ['Margin debt ($)',debt,0,10000000,(n:number)=>{setDebt(n);setConfirmed(false)}], ...(snapshot ? [['Snapshot cash ($)',cashOverride,-1000000,1000000,(n:number)=>{setCash(n);setConfirmed(false)}]] : []),
    ] as [string,number,number,number,(n:number)=>void][]).map(([label,value,min,max,set]) => <label key={label} className="text-xs text-muted">{label}<RiskNumber label={label} value={value} min={min} max={max} commit={(n)=>{if(n!=null)set(n)}}/></label>)}</div>
    <div className="flex flex-wrap gap-2"><Button disabled={busy || !stocks.length} onClick={loadSchwab}>Refresh balances & risk</Button><Button disabled={busy || !stocks.length} onClick={history}>Recalculate price relationships</Button><Button disabled={busy} onClick={loadQuotes}>Refresh option quotes</Button><Button onClick={exportReview}>Download comparison</Button><label className="cursor-pointer rounded-lg border border-border p-2 text-xs">Compare a Positions CSV<input aria-label="Positions risk-review CSV" type="file" accept=".csv" className="sr-only" onChange={e=>{void loadCsv(e.target.files?.[0]);e.target.value=''}}/></label>{snapshot&&<Button onClick={()=>{setSnapshot(null);setAnalysisAccount(accounts[0]?.id??'all');setDebt(null);setSchwabBalance(null);setClose('');setSelected('')}}>Return to saved portfolio</Button>}</div></div></details>
    {snapshot && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}/> I confirmed the cash and margin debt for this snapshot. The Positions export does not contain these balances.</label>}


    {!ready && <div className="space-y-3 rounded-lg border border-border-soft p-3"><h3 className="text-sm font-semibold">{inventoryChanged?'Your holdings changed—sync first':chain?'A few details still need your attention':'Start with your latest Schwab data'}</h3><p className="text-xs text-muted">If quantities changed, use the app’s Sync button and refresh again. Otherwise refresh the analysis first. If Schwab does not supply a holding’s maintenance requirement, enter it from your Schwab margin view in Holding details. Missing values stay unknown.</p><button onClick={()=>setEvidenceOpen(true)} className="text-xs font-semibold text-brand">Open holding details ↓</button><details><summary className="cursor-pointer text-xs text-muted">See remaining checks</summary><div className="mt-3 space-y-2">{[...issueGroups].map(([category, details]) => <details key={category} className="rounded-lg border border-border-soft p-2 text-xs"><summary className="cursor-pointer font-medium">{category} · {details.length} item{details.length===1?'':'s'}</summary><ul className="mt-2 max-h-48 space-y-1 overflow-auto text-muted">{details.map((issue,i)=><li key={i}>{issue}</li>)}</ul></details>)}</div></details></div>}
    {!inventoryChanged && <><div><h3 className="font-semibold">How your portfolio could handle a downturn</h3>{!ready&&<p className="mt-2 text-xs text-brand">Preliminary estimates. Resolve the remaining checks before relying on an order recommendation.</p>}<p className="mt-1 text-xs text-muted">Existing puts contribute payoff less current marked value, not payoff less their original purchase cost. Each row compares keeping your current puts with the selected alternative after {horizonDays} days. Option time value is excluded; expired puts receive no protection credit.</p><div className="mt-3 overflow-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead><tr>{['Market decline','Keep: net equity','Keep: equity %','Change: net equity','Change: equity %','Below 50% target','Maintenance shortfall'].map((h)=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{hold.map((s,i)=>{const c=selectedCandidate?.stress[i];return <tr key={s.declinePct} className="border-t border-border-soft"><td className="p-2">−{s.declinePct}%</td><td className="num p-2">{usd(s.equity)}</td><td className="p-2">{pct(s.equityPct)}</td><td className="num p-2">{c?usd(c.equity):'Load eligible quotes'}</td><td className="p-2">{c?pct(c.equityPct):'—'}</td><td className="num p-2">{usd(c?.floorGap??s.floorGap)}</td><td className="num p-2">{(c??s).maintenanceGap==null?'Unknown':usd((c??s).maintenanceGap!)}</td></tr>})}</tbody></table></div></div>
    {ready && ranking.holdMeetsFloor && <p className="rounded-lg border border-pos/30 p-3 text-sm text-pos">Keep your current protection. It meets the equity and maintenance targets in all four modeled declines.</p>}
    {ready && !ranking.holdMeetsFloor && !ranking.recommendation && <p className="rounded-lg border border-brand/30 p-3 text-sm text-brand">No tested option fits every target within your budget. You can adjust the budget or comparison horizon and refresh; the alternative below does not qualify for an order.</p>}
    {selectedCandidate && <div className="rounded-lg border border-border p-4"><h3 className="font-semibold">{draft?'Protection ready for order review':'Alternative to compare'}</h3><p className="mt-2 text-sm">{selectedCandidate.contracts} × {selectedCandidate.quote.symbol} · strike {usd(selectedCandidate.quote.strike)} · expires {selectedCandidate.quote.expiration}</p><p className="mt-2 text-xs text-muted">Gross premium {usd(selectedCandidate.stress[0].premium)} · close credit {usd(selectedCandidate.stress[0].closeCredit)} · fees {usd(selectedCandidate.stress[0].fees)} · net debit {usd(selectedCandidate.stress[0].netDebit)} · financing {usd(selectedCandidate.stress[0].financing)}.</p><p className="mt-2 text-xs text-muted">Immediate post-trade equity using the new put bid: {pct(selectedCandidate.entry.equityPct)} · 50% target gap {usd(selectedCandidate.entry.floorGap)}.</p><p className="mt-2 text-xs text-muted">{selectedCandidate.meetsFloor?'Meets the modeled target immediately after purchase and in all four scenarios.':'Does not meet the modeled floor at entry or across all scenarios.'} {selectedCandidate.withinBudget?'Within purchase budget.':'Exceeds purchase budget.'} An order is available only when the account, evidence, budget and equity checks pass.</p><div className="mt-4 flex flex-wrap items-center gap-3"><Button variant="primary" disabled={!draft || !onPrepareOrder || busy} onClick={prepareOrder}>Review this order →</Button><span className="text-xs text-faint">{snapshot?'CSV snapshots are for comparison. Return to your saved portfolio to prepare an order.':draft?'Next: check the ticket and preview with Schwab. Nothing is submitted yet.':'Resolve the remaining checks before preparing an order.'}</span></div></div>}
    {ranking.candidates.length>0 && <label className="block text-xs text-muted">Compare another option<select value={selectedCandidate?`${selectedCandidate.quote.symbol}|${selectedCandidate.contracts}`:''} onChange={(e)=>{setSelected(e.target.value);setClock(() => Date.now())}} className={control}>{ranking.candidates.slice(0,15).map((c)=><option key={c.quote.symbol} value={`${c.quote.symbol}|${c.contracts}`}>{c.contracts} × {c.quote.symbol} · worst target gap {usd(c.worstGap)} · debit {usd(c.debit)}</option>)}</select></label>}
    </>}
    <details id="protection-evidence" open={evidenceOpen} onToggle={(e)=>setEvidenceOpen(e.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold">Holding exposure and evidence</summary><p className="my-3 text-xs text-muted">Beta is the total observed response to QQQ, including embedded leverage. Leverage is optional context, reported separately and never multiplied into beta again. Correlation alone does not determine loss size. Missing beta uses 1 only for an explicitly provisional stress preview.</p><div className="max-h-96 overflow-auto"><table className="w-full min-w-[1050px] text-left text-xs"><thead className="sticky top-0 bg-surface"><tr>{['Holding / account','Value','QQQ beta','Correlation','Leverage (x, optional)','Maintenance (%)','Broker evidence / date'].map((h) => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{stocks.map((p) => { const r = risks[riskKey(p)] ?? {}; return <tr key={p.id} className="border-t border-border-soft"><td className="p-2"><strong>{p.symbol}</strong><div className="text-faint">{accounts.find((a) => a.id === p.accountId)?.name ?? p.accountId.replace('csv:','')}</div><div className="max-w-60 text-[10px] text-faint">{r.source ?? 'Risk evidence missing'}</div></td><td className="num p-2">{usd(p.shares*p.lastPrice)}</td>{([['beta',-5,8],['correlation',-1,1],['leverage',-5,5],['maintenancePct',0,100]] as const).map(([key,min,max]) => <td className="p-2" key={key}><RiskNumber label={`${p.symbol} ${p.accountId} ${key}`} value={r[key]} min={min} max={max} precision={key==='beta'||key==='correlation'?3:undefined} placeholder={key==='leverage'?'Optional':'Unknown'} commit={(n)=>update(p,{[key]:n,...(key==='beta'||key==='correlation'?{source:'Manual scenario assumption'}:key==='maintenancePct'?{maintenanceSource:'Manual scenario assumption'}:{})})}/></td>)}<td className="p-2"><input aria-label={`${p.symbol} ${p.accountId} margin evidence`} placeholder="Broker screen / date" value={r.maintenanceSource ?? ''} onChange={(e) => update(p,{maintenanceSource:e.target.value.slice(0,180)})} className={control}/></td></tr>})}</tbody></table></div></details>
    <p className="text-xs text-faint">Every trade requires a Schwab preview and your final confirmation. AI explains the comparison; it cannot submit orders. Market relationships and broker requirements can change.</p>
  </section>
}
