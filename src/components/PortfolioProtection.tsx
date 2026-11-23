import { useEffect, useMemo, useRef, useState } from 'react'
import type { Account, Position } from '../lib/types'
import { reconcileProtectionHoldings, type SchwabProtectionAccount } from '../lib/schwab-protection-data'
import { schwabPutChain, type PutQuote, type PutChainResult } from '../lib/api'
import { useReviewCache } from '../lib/use-review-cache'
import { parseCsv } from '../lib/import'
import { portfolioSummary } from '../lib/calc'
import { isActiveProtectivePut } from '../lib/hedge'
import { brokerageDate } from '../lib/balance-snapshots'
import { riskKey, rankPortfolioProtection, type HoldingRisk, type ProtectionInput, protectionAiEvidence, type ProtectionAiEvidence, buildProtectionOrderDraft, type ProtectionOrderDraft, protectionTradeQuotes, protectionChoice } from '../lib/portfolio-protection'
import { usd, pct, shortDate } from '../lib/format'
import { Button } from './ui'
import { downloadCsv } from '../lib/csv'
import { MarginSurvivalDashboard } from './MarginSurvivalDashboard'
import { DEFAULT_SURVIVAL, type SurvivalSettings, type SurvivalBroker } from '../lib/margin-survival'

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
  const [schwabBalance, setSchwabBalance] = useState<{ accountId: string; cash: number | null; debt: number | null; sourceKey: string; fetchedAt?: string; positions?: SchwabProtectionAccount['positions']; broker?: SurvivalBroker } | null>(null)
  const savedContext = JSON.stringify([positions,accounts])
  const currentBrokerData = !snapshot && schwabBalance?.sourceKey===savedContext ? schwabBalance : null
  const reconciliation = useMemo(()=>currentBrokerData?.positions ? reconcileProtectionHoldings(positions.filter(p=>p.accountId===currentBrokerData.accountId),currentBrokerData.positions) : null,[positions,currentBrokerData])
  const sourceRows = useMemo(()=>snapshot?.positions ?? (reconciliation?.matches && currentBrokerData ? [...positions.filter(p=>p.accountId!==currentBrokerData.accountId),...reconciliation.positions] : positions),[snapshot,reconciliation,currentBrokerData,positions])
  const rows = useMemo(() => sourceRows.filter((p) => analysisAccount === 'all' || p.accountId === analysisAccount), [sourceRows, analysisAccount])
  const stocks = rows.filter((p) => !p.isOption && p.shares !== 0)
  const [risks, setRisks, saveError] = useReviewCache<Record<string, HoldingRisk>>('simonfire.protection.risks.v1', {})
  const [survivalByAccount,setSurvivalByAccount,survivalSaveError] = useReviewCache<Record<string,SurvivalSettings>>('simonfire.protection.survival.v1',{})
  const survivalSettings=useMemo(()=>({...DEFAULT_SURVIVAL,...survivalByAccount[analysisAccount],riskWeights:{...DEFAULT_SURVIVAL.riskWeights,...survivalByAccount[analysisAccount]?.riskWeights}}),[survivalByAccount,analysisAccount])
  const setSurvivalSettings=(update:(old:SurvivalSettings)=>SurvivalSettings)=>setSurvivalByAccount(old=>({...old,[analysisAccount]:update({...DEFAULT_SURVIVAL,...old[analysisAccount],riskWeights:{...DEFAULT_SURVIVAL.riskWeights,...old[analysisAccount]?.riskWeights}})}))
  const [requirementsChanged,setRequirementsChanged] = useState(false)
  const [historyText,setHistoryText] = useState('')
  const [chain, setChain] = useState<PutChainResult | null>(null)
  const [horizonDays, setHorizon] = useState(30)
  const [ratePct, setRate] = useState(8)
  const [feePerContract, setFee] = useState(.65)
  const [budget, setBudget] = useState(5000)
  const [maxContracts, setMaxContracts] = useState(30)
  const [debtOverride, setDebt] = useState<number | null>(null)
  const [cashOverride, setCash] = useState(0)
  const [confirmed, setConfirmed] = useState(false)
  const [closePositionId, setClose] = useState(()=>rows.find(p=>isActiveProtectivePut(p,brokerageDate())&&p.underlying==='QQQ')?.id??'')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [actionError,setActionError] = useState('')
  const [selected, setSelected] = useState('')
  const [orderMode,setOrderMode] = useState<'model'|'on-demand'>('model')
  const [manualSymbol,setManualSymbol] = useState('')
  const [manualContracts,setManualContracts] = useState(1)
  const [acknowledgedChoice,setAcknowledgedChoice] = useState('')
  const [overrideChoice,setOverrideChoice] = useState('')
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [settingsOpen,setSettingsOpen] = useState(false)
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
  const choiceKey=JSON.stringify([context,manualSymbol,manualContracts,selected,gross,debt,chain?.fetchedAt,survivalSettings,closePositionId,risks,ratePct,feePerContract,budget,maxContracts,horizonDays])
  const input: ProtectionInput = useMemo(() => ({ accountCount: analysisAccount === 'all' ? Math.max(accounts.length, new Set(rows.map((p)=>p.accountId)).size) : 1, positions: rows, risks, gross, debt, qqqPrice, today, horizonDays, ratePct, feePerContract, budget, maxContracts, quotes, closePositionId, riskAcknowledged:acknowledgedChoice===choiceKey,limitOverride:overrideChoice===choiceKey,survivalSettings, broker:balance?.broker, quoteFetchedAt: chain?.fetchedAt, delayed: chain?.delayed, now: clock }), [analysisAccount, accounts.length, rows, risks, gross, debt, qqqPrice, today, horizonDays, ratePct, feePerContract, budget, maxContracts, quotes, closePositionId, chain?.fetchedAt, chain?.delayed, clock, survivalSettings, balance?.broker,acknowledgedChoice,overrideChoice,choiceKey])
  const ranking = useMemo(() => rankPortfolioProtection(input), [input])
  const modelCandidate = ranking.candidates.find((c) => `${c.quote.symbol}|${c.contracts}` === selected) ?? ranking.recommendation ?? ranking.candidates[0]
  const manualQuotes = useMemo(()=>protectionTradeQuotes(input),[input])
  const manualQuote = manualQuotes.find(q=>q.symbol===manualSymbol) ?? manualQuotes.find(q=>q.symbol===modelCandidate?.quote.symbol) ?? manualQuotes[0]
  const manualSelection = useMemo(()=>manualQuote ? {symbol:manualQuote.symbol,contracts:manualContracts} : undefined,[manualQuote,manualContracts])
  const manualCandidate=useMemo(()=>orderMode==='on-demand'&&manualSelection?protectionChoice(input,manualSelection):null,[input,manualSelection,orderMode])
  const selectedCandidate = orderMode==='on-demand' ? manualCandidate : modelCandidate
  const hold = ranking.hold
  const balancesConfirmed = (!snapshot || confirmed) && !balanceUnknown && !needsBrokerRefresh
  const ready = ranking.ready && balancesConfirmed
  useEffect(() => { onReviewEvidence?.(protectionAiEvidence(input, balancesConfirmed,orderMode==='on-demand'?manualSelection:undefined,ranking,manualCandidate)) }, [input, balancesConfirmed, onReviewEvidence,orderMode,manualSelection,ranking,manualCandidate])
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
        return {p,rate:typeof rate==='number' && Number.isFinite(rate) && rate>=0 ? rate : undefined,mismatched:!!snapshot && !!position && !snapshotMatches}
      })
      if(resolved.some(({p,rate})=>rate!=null&&schwabMaintenance(risks[riskKey(p)]?.maintenanceSource)&&risks[riskKey(p)]?.maintenancePct!==rate))setRequirementsChanged(true)
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
        setSchwabBalance({accountId:savedAccount.id,sourceKey:savedContext,fetchedAt:data.fetchedAt,positions:account?.positions,broker:{maintenanceRequirement:account?.maintenanceRequirement,maintenanceExcess:account?.maintenanceExcess,marginEquity:account?.equity,initialMargin:account?.initialMarginRequirement,sma:account?.sma,buyingPower:account?.buyingPower,withdrawable:account?.cashAvailableForWithdrawal,optionMaintenanceVerified:!!account?.positions.some(p=>/P\d{8}$/.test(symbolKey(p.symbol)))&&account.positions.filter(p=>/P\d{8}$/.test(symbolKey(p.symbol))).every(p=>['FULLY_FUNDED','FULL_VALUE','full-value'].includes(p.optionMarginTreatment??'')&&p.maintenanceRequirement!=null&&Math.abs(p.maintenanceRequirement-p.shares*p.lastPrice)<.01)},cash:typeof account?.cash==='number' && Number.isFinite(account.cash)?account.cash:null,debt:typeof account?.debt==='number' && Number.isFinite(account.debt) && account.debt>=0?account.debt:null})
        setDebt(null)
      }
      const maintenanceMessage = `${populated} of ${stocks.length} holdings received an explicit Schwab maintenance requirement. Unavailable requirements remain unknown; manual entries are preserved when Schwab has no verified rate.${snapshot ? ` Snapshot balances were kept; ${mismatched} holding(s) differed in shares or price and received no current rate.` : !savedAccount ? ' Select one saved account to use fetched cash and debt.' : ' Fetched cash and debt apply only to the selected saved account; missing balances remain unknown.'}`
      let historyMessage: string
      try { historyMessage = await fetchHistory() } catch(e) { historyMessage = e instanceof Error ? `Price history: ${e.message}` : 'Price history unavailable.' }
      if (currentContext.current === started) { const status=`${maintenanceMessage} ${historyMessage}`; setMessage(status); return status }
    } catch(e) { const status=e instanceof Error ? e.message : 'Schwab risk data unavailable. No requirements were invented.'; setActionError('Could not refresh Schwab account data. Check your connection and try again.');setMessage(status); return status }
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
      if(!result.ok)setActionError('Could not refresh option quotes. Check your Schwab connection and try again.')
      setMessage(status); return status
    } catch { setChain(null); const status='Could not refresh option quotes. Try again.'; setActionError(status);setMessage(status); return status }
    finally { setBusy(false) }
  }
  const refreshAnalysis = async () => {
    setActionError('')
    const started = context
    const dataStatus = await loadSchwab()
    if(currentContext.current !== started) return
    const quoteStatus = await loadQuotes()
    if(currentContext.current === started) setMessage([dataStatus,quoteStatus].filter(Boolean).join(' '))
  }
  const draft = selectedCandidate && !snapshot ? buildProtectionOrderDraft(input,{symbol:selectedCandidate.quote.symbol,contracts:selectedCandidate.contracts},savedAccount?.id ?? '',balancesConfirmed,orderMode) : null
  const prepareOrder = (choice: {quote:{symbol:string};contracts:number} | null | undefined = selectedCandidate, mode: 'model'|'on-demand' = orderMode) => {
    // Recheck time at the click; the display timer is not a placement gate.
    const currentBalanceAge=Date.now()-Date.parse(balance?.fetchedAt??'')
    const current = choice && !snapshot && Number.isFinite(currentBalanceAge) && currentBalanceAge>=-60000 && currentBalanceAge<=5*60000 ? buildProtectionOrderDraft({...input,now:Date.now()},{symbol:choice.quote.symbol,contracts:choice.contracts},savedAccount?.id ?? '',balancesConfirmed,mode) : null
    if(current && onPrepareOrder) onPrepareOrder(current)
    else {setActionError('This choice is not ready for an order review. Check missing broker evidence, fresh balances/quotes, and acknowledge any displayed risk or budget exception.');setMessage('Resolve the review checks below before preparing an order.')}
  }
  const exportReview = () => downloadCsv('portfolio-protection-review.csv', [
    ['Scenario','Proxy decline %','Gross assets','Debt with financing','Net equity','Equity %','50% target gap','Maintenance gap (unknown if blank)','Premium','Close credit','Fees','Financing'],
    ...[['HOLD', hold], ...(selectedCandidate ? [['ROLL / ADD candidate', selectedCandidate.stress]] : [])].flatMap(([label, scenarios]) => (scenarios as typeof hold).map((s) => [String(label),s.declinePct,s.gross,s.debt,s.equity,s.equityPct,s.floorGap,s.maintenanceGap ?? '',s.premium,s.closeCredit,s.fees,s.financing])),
  ])
  const heldPuts = rows.filter(p=>isActiveProtectivePut(p,today))
  const recommendation = ready ? ranking.recommendation : null
  const proposed = !inventoryChanged&&!ranking.holdMeetsFloor ? recommendation??ranking.candidates[0] : null
  const costs = proposed?.stress[0]
  const survivalDecision = ranking.survival.recommended
  const statusTitle = inventoryChanged ? 'Sync your changed holdings first' : !ready ? chain?.ok?'Recommendation needs missing inputs':'Refresh to get your recommendation' : survivalDecision && !survivalDecision.id.startsWith('roll-') && survivalDecision.id!=='hold' ? 'Reduce margin risk before replacing protection' : ranking.holdMeetsFloor ? 'HOLD your current protection' : recommendation ? closePositionId ? 'ROLL to the best replacement' : 'ADD portfolio protection' : 'No option meets every target'
  return <section className="space-y-4" aria-label="Portfolio protection decision">
    <div className="card flex flex-wrap items-end gap-3 p-4">
      <label className="min-w-48 flex-1 text-xs text-muted">Account
        <select aria-label="Risk-review account" disabled={busy} value={analysisAccount} onChange={e=>{setAnalysisAccount(e.target.value);setRequirementsChanged(false);setHistoryText('');setCash(0);setDebt(null);setSchwabBalance(null);setConfirmed(false);setClose(sourceRows.find(p=>p.accountId===e.target.value&&isActiveProtectivePut(p,today)&&p.underlying==='QQQ')?.id??'');setSelected('');setMessage('')}} className={control}>
          <option value="all">All accounts · comparison only</option>
          {[...new Set(sourceRows.map(p=>p.accountId))].map(id=><option key={id} value={id}>{accounts.find(a=>a.id===id)?.name??id.replace('csv:','')}</option>)}
        </select>
      </label>
      <Button variant="primary" disabled={busy||!stocks.length} onClick={refreshAnalysis}>{busy?'Updating Schwab…':'Refresh recommendation'}</Button>
      <div className="w-full text-xs text-muted">Equity <strong className="text-ink">{gross>0&&!balanceUnknown?pct((gross-debt)/gross*100):'Unknown'}</strong> · Margin used <strong className="text-ink">{balanceUnknown?'Needs refresh':usd(debt)}</strong> · Equity floor {survivalSettings.floorPct}%</div>
    </div>

    {actionError&&<p role="alert" className="rounded-lg border border-brand/30 p-3 text-sm text-brand">{actionError}</p>}
    <div className="card p-4">
      <h2 className="text-sm font-semibold">Your current protection</h2>
      {heldPuts.length ? <div className="mt-3 space-y-3">{heldPuts.map(p=><div key={p.id} className="flex flex-wrap justify-between gap-2 border-t border-border-soft pt-3 first:border-0 first:pt-0">
        <div><div className="font-semibold">{p.shares} × {p.underlying??'Index'} {usd(p.strike??0)} put</div><div className="mt-1 text-xs text-muted">Expires {shortDate(p.expiration!)} · {Math.max(0,Math.ceil((Date.parse(p.expiration!)-Date.parse(today))/86400000))} days left</div></div>
        <div className="text-right"><div className="num font-semibold">{usd(p.shares*p.lastPrice)}</div><div className="mt-1 text-xs text-muted">{p.avgCost>0?`${usd((p.lastPrice-p.avgCost)*p.shares,{sign:true})} unrealized`:'Current marked value'}</div></div>
      </div>)}</div> : <p className="mt-2 text-sm text-muted">No active protective puts in this account.</p>}
    </div>

    <div className="card border-brand/25 p-5" aria-label="Protection recommendation">
      <div className="text-xs text-muted">Recommendation</div>
      <h2 className="mt-1 text-xl font-semibold">{statusTitle}</h2>
      {survivalDecision && !survivalDecision.id.startsWith('roll-') && survivalDecision.id!=='hold' && <p className="mt-2 text-sm text-brand">{survivalDecision.label}. Review the survival comparison below.</p>}
      {!ready ? <p className="mt-2 text-sm text-muted">{inventoryChanged?'Use Sync, then refresh this recommendation.':'Load current balances and quotes. Missing inputs can be completed in Settings below.'}</p> : ranking.holdMeetsFloor ? <p className="mt-2 text-sm text-muted">Keeping your current puts meets the modeled equity and margin targets. You can still choose protection now below.</p> : !proposed ? <p className="mt-2 text-sm text-muted">No supported option quotes are available for this comparison. Refresh or choose your own hedge below.</p> : <>
        <p className="mt-2 text-base"><strong>{proposed.contracts} × QQQ {usd(proposed.quote.strike)} put</strong> · {shortDate(proposed.quote.expiration)}</p>
        <p className="mt-1 text-xs text-muted">{recommendation?'Best qualifying replacement across the tested strikes, expirations and quantities.':'Best available comparison. It still leaves a target shortfall or exceeds the model budget; this is not a model-endorsed roll.'}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[[closePositionId?'Sell current puts':'Option premium',usd(closePositionId?costs!.closeCredit:costs!.premium)], [closePositionId?'Buy replacement':'Contract fees',usd(closePositionId?costs!.premium:costs!.fees)], [costs!.netDebit<0?'Net cash released':'Estimated net cost',usd(Math.abs(costs!.netDebit))]].map(([label,value])=><div key={label} className="rounded-lg bg-surface-2/50 p-3"><div className="text-xs text-muted">{label}</div><div className="num mt-1 text-lg font-semibold">{value}</div></div>)}
        </div>
        <p className="mt-2 text-xs text-faint">Net cost includes {usd(costs!.fees)} in fees. Prices are estimates; review the limit prices before submission.</p>
        <div className="mt-4"><Button variant="primary" disabled={busy||!!snapshot||!onPrepareOrder} onClick={()=>{if(recommendation)prepareOrder(proposed,'model');else{setManualSymbol(proposed.quote.symbol);setManualContracts(proposed.contracts);setOrderMode('on-demand')}}}>{recommendation?closePositionId?'Review recommended roll':'Review recommended protection':'Review risks for this comparison'} →</Button></div>
      </>}
      {!inventoryChanged && ready && proposed && <p className="mt-3 text-xs text-muted">At the final checkpoint after a modeled 30% crash: equity {pct(hold.find(s=>s.declinePct===30)!.equityPct)} holding current protection → {pct(proposed.stress.find(s=>s.declinePct===30)!.equityPct)} with this choice.</p>}
      {!ready&&chain?.ok&&<button className="mt-3 text-sm font-semibold text-brand" onClick={()=>{setSettingsOpen(true);setEvidenceOpen(true)}}>Show missing inputs ↓</button>}
      <p className="mt-3 text-xs text-faint">Reviewing prepares a ticket. Schwab preview and your confirmation come next.</p>
    </div>

    <details className="card p-4" open={orderMode==='on-demand'} onToggle={e=>setOrderMode(e.currentTarget.open?'on-demand':'model')}>
      <summary className="cursor-pointer text-sm font-semibold">Protect now / choose a different hedge</summary>
      <p className="mt-3 text-xs text-muted">You can act whenever you choose. HOLD/ROLL remains the model’s guidance; your selection below is independent.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_110px]">
        <label className="text-xs text-muted">Put contract<select aria-label="On-demand put contract" className={control} value={manualQuote?.symbol??''} onChange={e=>setManualSymbol(e.target.value)}><option value="" disabled>Refresh quotes first</option>{manualQuotes.map(q=><option key={q.symbol} value={q.symbol}>QQQ {usd(q.strike)} · {shortDate(q.expiration)} · ask {usd(q.ask!)}</option>)}</select></label>
        <label className="text-xs text-muted">Contracts<RiskNumber label="On-demand contracts" value={manualContracts} min={1} max={100} commit={n=>{if(n!=null)setManualContracts(Math.trunc(n))}}/></label>
      </div>
      {orderMode==='on-demand'&&selectedCandidate&&<div className="mt-3 text-sm">{selectedCandidate.contracts} contracts · estimated {selectedCandidate.stress[0].netDebit<0?'cash released':'cost'} <strong>{usd(Math.abs(selectedCandidate.stress[0].netDebit))}</strong> including fees.
        <div className="mt-1 text-xs text-muted">{!ready?'Model protection is unverified while risk inputs are missing.':selectedCandidate.meetsFloor?'Meets the modeled equity and margin targets.':'This choice leaves a modeled equity or margin shortfall.'} {!selectedCandidate.withinBudget?'Above your model budget.':''}</div>
        {manualQuote&&manualQuote.expiration<new Date(Date.parse(`${today}T12:00:00Z`)+horizonDays*86400000).toISOString().slice(0,10)&&<p className="mt-2 text-xs text-brand">Expires before the comparison horizon. After expiry, modeled monetization proceeds reduce debt; the option provides no further coverage.</p>}
      </div>}
      {selectedCandidate&&!selectedCandidate.meetsFloor&&<label className="mt-3 flex items-start gap-2 text-xs text-brand"><input type="checkbox" checked={acknowledgedChoice===choiceKey} onChange={e=>setAcknowledgedChoice(e.target.checked?choiceKey:'')}/>I understand this choice leaves modeled equity or maintenance risk. Review only; unresolved broker evidence still blocks execution.</label>}
      {selectedCandidate&&!selectedCandidate.withinBudget&&<label className="mt-2 flex items-start gap-2 text-xs text-brand"><input type="checkbox" checked={overrideChoice===choiceKey} onChange={e=>setOverrideChoice(e.target.checked?choiceKey:'')}/>Override my purchase budget for this specific review.</label>}
      <div className="mt-4"><Button variant="primary" disabled={!draft||!onPrepareOrder||busy||orderMode!=='on-demand'} onClick={()=>prepareOrder()}>Review my choice →</Button></div>
      {!draft&&<p className="mt-2 text-xs text-muted">{snapshot?'Return to your synced portfolio to prepare an order.':'Current balances, quotes and verified maintenance evidence are required. Estimates remain available above.'}</p>}
    </details>

    {selectedCandidate&&<details className="card p-4"><summary className="cursor-pointer text-xs font-semibold">Selected quote & pricing evidence</summary><p className="mt-2 text-xs text-muted">{selectedCandidate.quote.symbol} · {selectedCandidate.quote.quoteTime?new Date(selectedCandidate.quote.quoteTime).toLocaleString():'Quote timestamp missing'} · multiplier {selectedCandidate.quote.multiplier??'Unknown'}. Values below are broker quote fields; forward values are model estimates.</p><div className="mt-3 grid grid-cols-3 gap-3 text-xs">{[['Bid',selectedCandidate.quote.bid],['Ask',selectedCandidate.quote.ask],['Midpoint',selectedCandidate.quote.ask!=null&&selectedCandidate.quote.bid!=null?(selectedCandidate.quote.ask+selectedCandidate.quote.bid)/2:null],['IV (%)',selectedCandidate.quote.volatility],['Delta',selectedCandidate.quote.delta],['Gamma',selectedCandidate.quote.gamma],['Theta',selectedCandidate.quote.theta],['Vega',selectedCandidate.quote.vega],['Open interest',selectedCandidate.quote.openInterest],['Volume',selectedCandidate.quote.volume]].map(([label,value])=><div key={String(label)}><div className="text-muted">{label}</div><div className="num mt-1">{value==null?'Unknown':typeof value==='number'?value.toLocaleString(undefined,{maximumFractionDigits:4}):value}</div></div>)}</div></details>}
    {!inventoryChanged&&<MarginSurvivalDashboard report={{...ranking.survival,strategies:manualCandidate?.survival?[...ranking.survival.strategies,manualCandidate.survival]:ranking.survival.strategies,recommended:balancesConfirmed?ranking.survival.recommended:null,missing:[...new Set([...ranking.survival.missing,...issues])],explanation:balancesConfirmed?ranking.survival.explanation:'Refresh and reconcile this account’s balances before relying on a recommendation. Scenario estimates remain hypothetical.',alerts:[...ranking.survival.alerts,...(requirementsChanged?[{id:'requirements-changed',message:'Schwab maintenance requirements changed since the previous refresh. Review the updated scenarios.',severity:'warning' as const}]:[])]}}/>}
    <details className="card p-4"><summary className="cursor-pointer text-sm font-semibold">Simulation settings & scheduled cash flows</summary><p className="mt-2 text-xs text-muted">Daily simulations include at least 90 days and all modeled expirations. Expiry assumes selling or monetizing intrinsic value and applying proceeds to debt; US equity puts are physically settled in practice. This requires broker execution and is not automatic cash settlement. Forward option marks use a midpoint-calibrated European approximation with conservative spreads; American exercise, dividends, liquidity and gaps can differ.</p>
      {(survivalSaveError)&&<p className="text-xs text-neg">Could not save simulation settings on this browser.</p>}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">{([
        ['maintenanceCushion','Maintenance cushion ($)',0,1000000],['monthlyDividend','Monthly distributions ($)',0,1000000],['monthlyExpense','Monthly expenses ($)',0,1000000],['monthlyDeposit','Monthly deposits ($)',0,1000000],['monthlySalary','Monthly salary invested ($)',0,1000000],['normalPct','Normal equity threshold (%)',60,95],['cautionPct','Caution equity threshold (%)',50,60],['floorPct','Minimum equity (%)',1,55],['interestBudget','Monthly interest budget ($)',0,1000000],['closeGapDays','Close / replacement gap (days)',1,30],['slippagePct','Execution slippage (%)',0,25],['volatility','Fallback volatility (decimal)',.01,3],['monteCarloPaths','Monte Carlo paths (0–20)',0,20],['seed','Monte Carlo seed',1,999999]
      ] as const).map(([field,label,min,max])=><label className="text-xs text-muted" key={field}>{label}<input type="number" step="any" min={min} max={max} value={survivalSettings[field]} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n))setSurvivalSettings(old=>({...old,[field]:Math.min(max,Math.max(min,n))}))}} className={control}/></label>)}
      <label className="text-xs text-muted">Option maintenance assumption<select className={control} value={survivalSettings.optionMaintenance} onChange={e=>setSurvivalSettings(old=>({...old,optionMaintenance:e.target.value as SurvivalSettings['optionMaintenance']}))}><option value="unknown">Unknown</option><option value="full-value">Conservative: full option value required</option><option value="zero">Hypothetical: no option requirement</option></select></label></div>
      <p className="mt-2 text-xs text-muted">Salary is invested while within the operating buffer; below the buffer it repays debt. Distributions and deposits repay debt; expenses use cash then margin. Newly modeled purchases have unverified security-specific requirements. Changing assumptions never verifies broker requirements or authorizes a trade.</p>
      <details className="mt-3"><summary className="cursor-pointer text-xs">Historical scenarios, one-time flows & ranking weights</summary><label className="mt-2 block text-xs text-muted">Historical daily returns (decimal values separated by commas)<textarea className={control} value={historyText} onChange={e=>setHistoryText(e.target.value)} placeholder="-0.02, 0.01, -0.03"/></label><Button variant="ghost" onClick={()=>{const values=historyText.split(/[\s,]+/).filter(Boolean).map(Number);if(values.length>730||values.some(n=>!Number.isFinite(n)||n<=-1||n>5)){setActionError('Enter up to 730 valid decimal daily returns greater than −1.');return}setSurvivalSettings(old=>({...old,historicalReturns:values}))}}>Apply historical path</Button>
      <label className="mt-3 block text-xs text-muted">One-time flows: one per line, day,kind,amount. Kinds: deposit, expense, dividend, investment<textarea className={control} defaultValue={survivalSettings.flows.map(f=>`${f.day},${f.kind},${f.amount}`).join('\n')} onBlur={e=>{const lines=e.target.value.trim()?e.target.value.trim().split('\n'):[];const flows:SurvivalSettings['flows']=[];for(const line of lines){const [d,kind,a]=line.split(',').map(s=>s.trim());const day=Number(d),amount=Number(a);if(!Number.isSafeInteger(day)||day<1||day>730||!Number.isFinite(amount)||amount<0||!['deposit','expense','dividend','investment'].includes(kind)){setActionError('Use day,kind,amount; day 1–730 and a nonnegative amount.');return}flows.push({day,amount,kind:kind as SurvivalSettings['flows'][number]['kind']})}setSurvivalSettings(old=>({...old,flows}))}}/></label>
      <div className="mt-2 grid grid-cols-2 gap-2">{(['deficiency','uncovered','financing','cost'] as const).map(field=><label className="text-xs text-muted" key={field}>{field} weight<input type="number" min={0} step="any" className={control} value={survivalSettings.riskWeights?.[field]??1} onChange={e=>{const value=Number(e.target.value);if(Number.isFinite(value))setSurvivalSettings(old=>({...old,riskWeights:{...DEFAULT_SURVIVAL.riskWeights,...old.riskWeights,[field]:Math.max(0,value)}}))}}/></label>)}</div><p className="mt-2 text-xs text-muted">Hard constraints always apply before ranking weights. Comparisons include full paths and the close-first gap; submitted orders never imply a fill.</p>
      </details>
    </details>
    <details className="card p-4" open={settingsOpen} onToggle={e=>setSettingsOpen(e.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold">Settings & calculation details</summary><div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-muted">Purchase budget ($)<RiskNumber label="Purchase budget ($)" value={budget} min={0} max={100000} commit={n=>{if(n!=null)setBudget(n)}}/></label><label className="text-xs text-muted">Compare your existing put<select aria-label="Holding versus rolling selection" value={closePositionId} onChange={e=>{setClose(e.target.value);setSelected('')}} className={control}><option value="">Keep existing puts and add protection</option>{heldPuts.filter(p=>p.underlying==='QQQ').map(p=><option key={p.id} value={p.id}>Roll {p.shares} × {p.symbol}</option>)}</select></label></div>
          <details className="rounded-xl border border-border-soft p-3"><summary className="cursor-pointer text-sm font-medium">More settings and data tools</summary><div className="mt-4 space-y-4">
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{([
      ['Stress horizon (days)',horizonDays,30,180,setHorizon], ['Margin interest (% / year)',ratePct,0,50,setRate], ['Fee per contract / leg ($)',feePerContract,0,20,setFee], ['Maximum contracts to compare',maxContracts,1,100,(n:number)=>setMaxContracts(Math.trunc(n))], ['Margin debt ($)',debt,0,10000000,(n:number)=>{setDebt(n);setConfirmed(false)}], ...(snapshot ? [['Snapshot cash ($)',cashOverride,-1000000,1000000,(n:number)=>{setCash(n);setConfirmed(false)}]] : []),
    ] as [string,number,number,number,(n:number)=>void][]).map(([label,value,min,max,set]) => <label key={label} className="text-xs text-muted">{label}<RiskNumber label={label} value={value} min={min} max={max} commit={(n)=>{if(n!=null)set(n)}}/></label>)}</div>
    <div className="flex flex-wrap gap-2"><Button disabled={busy || !stocks.length} onClick={loadSchwab}>Refresh balances & risk</Button><Button disabled={busy || !stocks.length} onClick={history}>Recalculate price relationships</Button><Button disabled={busy} onClick={loadQuotes}>Refresh option quotes</Button><Button onClick={exportReview}>Download comparison</Button><label className="cursor-pointer rounded-lg border border-border p-2 text-xs">Compare a Positions CSV<input aria-label="Positions risk-review CSV" type="file" accept=".csv" className="sr-only" onChange={e=>{void loadCsv(e.target.files?.[0]);e.target.value=''}}/></label>{snapshot&&<Button onClick={()=>{setSnapshot(null);setAnalysisAccount(accounts[0]?.id??'all');setDebt(null);setSchwabBalance(null);setClose('');setSelected('')}}>Return to saved portfolio</Button>}</div></div></details>
      {snapshot&&<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I confirmed this CSV snapshot’s cash and margin debt.</label>}
          {!ready && <div className="space-y-3 rounded-lg border border-border-soft p-3"><h3 className="text-sm font-semibold">{inventoryChanged?'Your holdings changed—sync first':chain?'A few details still need your attention':'Start with your latest Schwab data'}</h3><p className="text-xs text-muted">Press Refresh analysis. If a holding's maintenance requirement is missing, enter it from Schwab in Holding details.</p><button onClick={()=>setEvidenceOpen(true)} className="text-xs font-semibold text-brand">Open holding details ↓</button><details><summary className="cursor-pointer text-xs text-muted">See remaining checks</summary><div className="mt-3 space-y-2">{[...issueGroups].map(([category, details]) => <details key={category} className="rounded-lg border border-border-soft p-2 text-xs"><summary className="cursor-pointer font-medium">{category} · {details.length} item{details.length===1?'':'s'}</summary><ul className="mt-2 max-h-48 space-y-1 overflow-auto text-muted">{details.map((issue,i)=><li key={i}>{issue}</li>)}</ul></details>)}</div></details></div>}
          <details id="protection-evidence" open={evidenceOpen} onToggle={(e)=>setEvidenceOpen(e.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold">Holding exposure and evidence</summary><p className="my-3 text-xs text-muted">Beta is the total observed response to QQQ, including embedded leverage. Leverage is optional context, reported separately and never multiplied into beta again. Correlation alone does not determine loss size. Missing beta uses 1 only for an explicitly provisional stress preview.</p><div className="max-h-96 overflow-auto"><table className="w-full min-w-[1050px] text-left text-xs"><thead className="sticky top-0 bg-surface"><tr>{['Holding / account','Value','QQQ beta','Correlation','Leverage (x, optional)','Maintenance (%)','Broker evidence / date'].map((h) => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{stocks.map((p) => { const r = risks[riskKey(p)] ?? {}; return <tr key={p.id} className="border-t border-border-soft"><td className="p-2"><strong>{p.symbol}</strong><div className="text-faint">{accounts.find((a) => a.id === p.accountId)?.name ?? p.accountId.replace('csv:','')}</div><div className="max-w-60 text-[10px] text-faint">{r.source ?? 'Risk evidence missing'}</div></td><td className="num p-2">{usd(p.shares*p.lastPrice)}</td>{([['beta',-5,8],['correlation',-1,1],['leverage',-5,5],['maintenancePct',0,1000]] as const).map(([key,min,max]) => <td className="p-2" key={key}><RiskNumber label={`${p.symbol} ${p.accountId} ${key}`} value={r[key]} min={min} max={max} precision={key==='beta'||key==='correlation'?3:undefined} placeholder={key==='leverage'?'Optional':'Unknown'} commit={(n)=>update(p,{[key]:n,...(key==='beta'||key==='correlation'?{source:'Manual scenario assumption'}:key==='maintenancePct'?{maintenanceSource:'Manual scenario assumption'}:{})})}/></td>)}<td className="p-2"><input aria-label={`${p.symbol} ${p.accountId} margin evidence`} placeholder="Broker screen / date" value={r.maintenanceSource ?? ''} onChange={(e) => update(p,{maintenanceSource:e.target.value.slice(0,180)})} className={control}/></td></tr>})}</tbody></table></div></details>

      {message&&<p role="status" className="text-xs text-muted">{message}</p>}{saveError&&<p role="alert" className="text-xs text-neg">This browser could not save risk inputs.</p>}
      <p className="text-xs text-faint">Financing assumes {ratePct}% per year over {horizonDays} days; check your Schwab rate. Historical relationships and margin requirements can change.</p>
    </div></details>
    {inventoryChanged&&<p role="alert" className="text-sm text-brand">Your holdings changed. Sync the portfolio before preparing protection.</p>}
  </section>
}
