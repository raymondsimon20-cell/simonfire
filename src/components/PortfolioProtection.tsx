import { useEffect, useMemo, useRef, useState } from 'react'
import type { Account, Position } from '../lib/types'
import type { SchwabProtectionAccount } from '../lib/schwab-protection-data'
import { schwabPutChain, type PutQuote, type PutChainResult } from '../lib/api'
import { useReviewCache } from '../lib/use-review-cache'
import { parseCsv } from '../lib/import'
import { portfolioSummary } from '../lib/calc'
import { brokerageDate } from '../lib/balance-snapshots'
import { riskKey, rankPortfolioProtection, type HoldingRisk, type ProtectionInput, protectionAiEvidence, type ProtectionAiEvidence } from '../lib/portfolio-protection'
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
export function PortfolioProtection({ positions, accounts, onReviewEvidence }: { positions: Position[]; accounts: Account[]; onReviewEvidence?: (value: ProtectionAiEvidence | null) => void }) {
  const [snapshot, setSnapshot] = useState<{ positions: Position[]; file: string } | null>(null)
  const [analysisAccount, setAnalysisAccount] = useState('all')
  const sourceRows = snapshot?.positions ?? positions
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
  const [schwabBalance, setSchwabBalance] = useState<{ accountId: string; cash: number | null; debt: number | null } | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [closePositionId, setClose] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState('')
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setClock(() => Date.now()), 30000); return () => window.clearInterval(timer) }, [])
  const summary = portfolioSummary(rows, accounts, analysisAccount, [])
  const savedAccount = analysisAccount === 'all' ? accounts.length === 1 ? accounts[0] : undefined : accounts.find((a) => a.id === analysisAccount)
  const balance = !snapshot && schwabBalance?.accountId === savedAccount?.id ? schwabBalance : null
  const balanceUnknown = !!balance && (balance.cash == null || balance.debt == null)
  const debt = debtOverride ?? (snapshot ? 0 : balance?.debt ?? summary.marginUsed)
  // Preserve the saved broker reconciliation; replace only the selected account's cash component.
  const gross = snapshot ? rows.reduce((sum,p) => sum + p.shares * p.lastPrice, 0) + cashOverride : summary.gross + (balance?.cash != null && savedAccount ? balance.cash - savedAccount.cash : 0)
  const context = JSON.stringify([analysisAccount, snapshot?.file, rows.map((p) => [p.id,p.accountId,p.symbol,p.shares,p.lastPrice]), accounts.map((a) => [a.id,a.mask])])
  const currentContext = useRef(context)
  useEffect(() => { currentContext.current = context; return () => { currentContext.current = '' } }, [context])
  const qqqPrice = chain?.underlyingPrice ?? rows.find((p) => !p.isOption && p.symbol === 'QQQ')?.lastPrice ?? 0
  const quotes = useMemo(() => (chain?.contracts ?? []) as PutQuote[], [chain?.contracts])
  const today = brokerageDate()
  const input: ProtectionInput = useMemo(() => ({ accountCount: analysisAccount === 'all' ? Math.max(accounts.length, new Set(rows.map((p)=>p.accountId)).size) : 1, positions: rows, risks, gross, debt, qqqPrice, today, horizonDays, ratePct, feePerContract, budget, maxContracts, quotes, closePositionId, quoteFetchedAt: chain?.fetchedAt, delayed: chain?.delayed, now: clock }), [analysisAccount, accounts.length, rows, risks, gross, debt, qqqPrice, today, horizonDays, ratePct, feePerContract, budget, maxContracts, quotes, closePositionId, chain?.fetchedAt, chain?.delayed, clock])
  const ranking = useMemo(() => rankPortfolioProtection(input), [input])
  const selectedCandidate = ranking.candidates.find((c) => `${c.quote.symbol}|${c.contracts}` === selected) ?? ranking.recommendation ?? ranking.candidates[0]
  const hold = ranking.hold
  const balancesConfirmed = (!snapshot || confirmed) && !balanceUnknown
  const ready = ranking.ready && balancesConfirmed
  useEffect(() => { onReviewEvidence?.(protectionAiEvidence(input, balancesConfirmed)) }, [input, balancesConfirmed, onReviewEvidence])
  useEffect(() => () => { onReviewEvidence?.(null) }, [onReviewEvidence])
  const issueGroups = new Map<string, string[]>()
  const issues = [...ranking.missing, ...(snapshot && !confirmed ? ['Snapshot cash and margin debt need confirmation'] : []), ...(balanceUnknown ? ['Schwab did not provide cash or debt for the selected account; balances remain unknown'] : [])]
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
    if (!snapshot && savedAccount) setSchwabBalance({accountId:savedAccount.id,cash:null,debt:null})
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
        setSchwabBalance({accountId:savedAccount.id,cash:typeof account?.cash==='number' && Number.isFinite(account.cash)?account.cash:null,debt:typeof account?.debt==='number' && Number.isFinite(account.debt) && account.debt>=0?account.debt:null})
        setDebt(null)
      }
      const maintenanceMessage = `${populated} of ${stocks.length} holdings received an explicit Schwab maintenance requirement. Unavailable requirements remain unknown; manual entries are preserved when Schwab has no verified rate.${snapshot ? ` Snapshot balances were kept; ${mismatched} holding(s) differed in shares or price and received no current rate.` : !savedAccount ? ' Select one saved account to use fetched cash and debt.' : ' Fetched cash and debt apply only to the selected saved account; missing balances remain unknown.'}`
      let historyMessage: string
      try { historyMessage = await fetchHistory() } catch(e) { historyMessage = e instanceof Error ? `Price history: ${e.message}` : 'Price history unavailable.' }
      if (currentContext.current === started) setMessage(`${maintenanceMessage} ${historyMessage}`)
    } catch(e) { setMessage(e instanceof Error ? e.message : 'Schwab risk data unavailable. No requirements were invented.') }
    finally { setBusy(false) }
  }
  const loadQuotes = async () => {
    setBusy(true); setMessage('')
    const through = new Date(Date.parse(`${brokerageDate()}T12:00:00Z`) + 365 * 86400000).toISOString().slice(0,10)
    const held = rows.find((p) => p.id === closePositionId)
    const result = await schwabPutChain('QQQ', brokerageDate(), through, held?.symbol, 60)
    setChain(result); setClock(() => Date.now()); setSelected(''); setMessage(result.ok ? 'Quotes loaded. HOLD and proposed protection are compared at the same horizon using intrinsic value only; time value is not credited.' : result.error ?? 'Quote load failed'); setBusy(false)
  }
  const exportReview = () => downloadCsv('portfolio-protection-review.csv', [
    ['Scenario','Proxy decline %','Gross assets','Debt with financing','Net equity','Equity %','50% target gap','Maintenance gap (unknown if blank)','Premium','Close credit','Fees','Financing'],
    ...[['HOLD', hold], ...(selectedCandidate ? [['ROLL / ADD candidate', selectedCandidate.stress]] : [])].flatMap(([label, scenarios]) => (scenarios as typeof hold).map((s) => [String(label),s.declinePct,s.gross,s.debt,s.equity,s.equityPct,s.floorGap,s.maintenanceGap ?? '',s.premium,s.closeCredit,s.fees,s.financing])),
  ])
  return <section className="card space-y-5">
    <div><h2 className="text-lg font-semibold">Portfolio protection review · advisory only</h2><p className="mt-2 text-sm text-muted">Target floor: <strong>50% equity</strong>. Compare keeping existing protection with buying or rolling puts across 5%, 10%, 20% and 30% QQQ-proxy declines. No trades or roll approvals are available.</p><p className="mt-2 text-xs text-muted">Schwab supplies balances, price history and explicit position-level maintenance facts. Missing requirements stay unknown; no rates are invented. The existing AI allocation review can explain this deterministic advisory comparison and its evidence gaps.</p></div>
    <div className="flex flex-wrap items-center gap-3"><label className="cursor-pointer rounded-lg border border-border p-2 text-xs">Load Positions CSV snapshot<input aria-label="Positions risk-review CSV" type="file" accept=".csv" className="sr-only" onChange={(e) => { void loadCsv(e.target.files?.[0]); e.target.value='' }}/></label><Button disabled={busy || !stocks.length} onClick={loadSchwab}>Load Schwab risk data</Button><Button disabled={busy || !stocks.length} onClick={history}>Calculate QQQ beta & correlation</Button><Button disabled={busy} onClick={loadQuotes}>Load read-only QQQ put quotes</Button><Button onClick={exportReview}>Export comparison</Button>{snapshot && <Button onClick={() => { setSnapshot(null); setAnalysisAccount('all'); setDebt(null); setSchwabBalance(null); setClose(''); setSelected('') }}>Use saved portfolio</Button>}</div>
    <label className="block text-xs text-muted">Risk-review account<select aria-label="Risk-review account" value={analysisAccount} onChange={(e) => {setAnalysisAccount(e.target.value);setCash(0);setDebt(null);setSchwabBalance(null);setConfirmed(false);setClose('');setSelected('')}} className={control}><option value="all">All selected accounts · aggregate preview only</option>{[...new Set(sourceRows.map((p)=>p.accountId))].map((id)=><option key={id} value={id}>{accounts.find((a)=>a.id===id)?.name ?? id.replace('csv:','')}</option>)}</select></label>
    <p className="text-xs text-faint">{snapshot ? `Snapshot: ${snapshot.file}` : 'Current selected portfolio'} · {rows.length} rows · {usd(gross)} gross assets. CSV snapshots never append transactions or change holdings.</p>
    {message && <p role="status" className="rounded-lg border border-border-soft p-3 text-xs">{message}</p>}{saveError && <p role="alert" className="text-xs text-neg">Risk inputs could not be saved in this browser.</p>}
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{([
      ['Stress horizon (days)',horizonDays,30,180,setHorizon], ['Margin financing (% / year)',ratePct,0,50,setRate], ['Fee per contract / leg ($)',feePerContract,0,20,setFee], ['Purchase budget ($)',budget,0,100000,setBudget], ['Maximum contracts to compare',maxContracts,1,100,(n:number)=>setMaxContracts(Math.trunc(n))], ['Margin debt ($)',debt,0,10000000,(n:number)=>{setDebt(n);setConfirmed(false)}], ...(snapshot ? [['Snapshot cash ($)',cashOverride,-1000000,1000000,(n:number)=>{setCash(n);setConfirmed(false)}]] : []),
    ] as [string,number,number,number,(n:number)=>void][]).map(([label,value,min,max,set]) => <label key={label} className="text-xs text-muted">{label}<RiskNumber label={label} value={value} min={min} max={max} commit={(n)=>{if(n!=null)set(n)}}/></label>)}</div>
    {snapshot && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}/> I confirmed the cash and margin debt for this snapshot. The Positions export does not contain these balances.</label>}
    <details open><summary className="cursor-pointer text-sm font-semibold">Holding exposure and evidence</summary><p className="my-3 text-xs text-muted">Beta is the total observed response to QQQ, including embedded leverage. Leverage is optional context, reported separately and never multiplied into beta again. Correlation alone does not determine loss size. Missing beta uses 1 only for an explicitly provisional stress preview.</p><div className="max-h-96 overflow-auto"><table className="w-full min-w-[1050px] text-left text-xs"><thead className="sticky top-0 bg-surface"><tr>{['Holding / account','Value','QQQ beta','Correlation','Leverage (x, optional)','Maintenance (%)','Broker evidence / date'].map((h) => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{stocks.map((p) => { const r = risks[riskKey(p)] ?? {}; return <tr key={p.id} className="border-t border-border-soft"><td className="p-2"><strong>{p.symbol}</strong><div className="text-faint">{accounts.find((a) => a.id === p.accountId)?.name ?? p.accountId.replace('csv:','')}</div><div className="max-w-60 text-[10px] text-faint">{r.source ?? 'Risk evidence missing'}</div></td><td className="num p-2">{usd(p.shares*p.lastPrice)}</td>{([['beta',-5,8],['correlation',-1,1],['leverage',-5,5],['maintenancePct',0,100]] as const).map(([key,min,max]) => <td className="p-2" key={key}><RiskNumber label={`${p.symbol} ${p.accountId} ${key}`} value={r[key]} min={min} max={max} precision={key==='beta'||key==='correlation'?3:undefined} placeholder={key==='leverage'?'Optional':'Unknown'} commit={(n)=>update(p,{[key]:n,...(key==='beta'||key==='correlation'?{source:'Manual scenario assumption'}:key==='maintenancePct'?{maintenanceSource:'Manual scenario assumption'}:{})})}/></td>)}<td className="p-2"><input aria-label={`${p.symbol} ${p.accountId} margin evidence`} placeholder="Broker screen / date" value={r.maintenanceSource ?? ''} onChange={(e) => update(p,{maintenanceSource:e.target.value.slice(0,180)})} className={control}/></td></tr>})}</tbody></table></div></details>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-muted">Compare HOLD against<select aria-label="Holding versus rolling selection" value={closePositionId} onChange={(e) => {setClose(e.target.value);setSelected('')}} className={control}><option value="">Add protection, keep existing puts</option>{rows.filter((p)=>p.isOption&&p.optionType==='Put'&&p.shares>0&&p.underlying==='QQQ').map((p)=><option key={p.id} value={p.id}>Roll {p.shares} × {p.symbol}</option>)}</select></label><div className="text-xs text-faint">Purchases use ask, closes use bid, each leg incurs fees, and financing applies to existing debt plus the net debit for {horizonDays} days. Gross debit is compared with this purchase budget, not mislabeled as a monthly roll cost.</div></div>
    {!ready && <div className="space-y-3 rounded-lg border border-brand/30 p-3"><h3 className="text-sm font-semibold text-brand">Provisional analysis · recommendation withheld</h3><p className="text-xs text-muted">Review the evidence categories below. Schwab may not supply per-holding requirements; unknown values stay unknown. Beta already incorporates observed leverage.</p>{[...issueGroups].map(([category, details]) => <details key={category} className="rounded-lg border border-border-soft p-2 text-xs"><summary className="cursor-pointer font-medium">{category} · {details.length} item{details.length===1?'':'s'}</summary><ul className="mt-2 max-h-48 space-y-1 overflow-auto text-muted">{details.map((issue,i)=><li key={i}>{issue}</li>)}</ul></details>)}</div>}
    <div><h3 className="font-semibold">Required HOLD versus {closePositionId?'ROLL':'ADD'} comparison</h3><p className="mt-1 text-xs text-muted">Existing puts contribute payoff less current marked value, not payoff less their original purchase cost. These are intrinsic-only protection floors at the selected horizon, not pre-expiry sale-price estimates. Expired protection gets no credit.</p><div className="mt-3 overflow-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead><tr>{['QQQ decline','HOLD net equity','HOLD equity %','Candidate net equity','Candidate equity %','50% floor gap','Maintenance gap'].map((h)=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{hold.map((s,i)=>{const c=selectedCandidate?.stress[i];return <tr key={s.declinePct} className="border-t border-border-soft"><td className="p-2">−{s.declinePct}%</td><td className="num p-2">{usd(s.equity)}</td><td className="p-2">{pct(s.equityPct)}</td><td className="num p-2">{c?usd(c.equity):'Load eligible quotes'}</td><td className="p-2">{c?pct(c.equityPct):'—'}</td><td className="num p-2">{usd(c?.floorGap??s.floorGap)}</td><td className="num p-2">{(c??s).maintenanceGap==null?'Unknown':usd((c??s).maintenanceGap!)}</td></tr>})}</tbody></table></div></div>
    {ready && ranking.holdMeetsFloor && <p className="rounded-lg border border-pos/30 p-3 text-sm text-pos">HOLD already meets the modeled equity and maintenance targets in all four scenarios. No additional purchase or roll is justified by these stress targets alone.</p>}
    {ready && !ranking.holdMeetsFloor && !ranking.recommendation && <p className="rounded-lg border border-brand/30 p-3 text-sm text-brand">No tested contract and quantity meets the entry check, all four stress targets and the purchase budget. The displayed alternative is for comparison, not an approval.</p>}
    {selectedCandidate && <div className="rounded-lg border border-border p-4"><h3 className="font-semibold">{ready&&selectedCandidate===ranking.recommendation?'Candidate for manual review':'Provisional candidate · not a recommendation'}</h3><p className="mt-2 text-sm">{selectedCandidate.contracts} × {selectedCandidate.quote.symbol} · strike {usd(selectedCandidate.quote.strike)} · expires {selectedCandidate.quote.expiration}</p><p className="mt-2 text-xs text-muted">Gross premium {usd(selectedCandidate.stress[0].premium)} · close credit {usd(selectedCandidate.stress[0].closeCredit)} · fees {usd(selectedCandidate.stress[0].fees)} · net debit {usd(selectedCandidate.stress[0].netDebit)} · financing {usd(selectedCandidate.stress[0].financing)}.</p><p className="mt-2 text-xs text-muted">Immediate post-trade equity using the new put bid: {pct(selectedCandidate.entry.equityPct)} · 50% target gap {usd(selectedCandidate.entry.floorGap)}.</p><p className="mt-2 text-xs text-muted">{selectedCandidate.meetsFloor?'Meets the modeled target immediately after purchase and in all four scenarios.':'Does not meet the modeled floor at entry or across all scenarios.'} {selectedCandidate.withinBudget?'Within purchase budget.':'Exceeds purchase budget.'} Missing evidence or a failed floor test never becomes an approval.</p></div>}
    {ranking.candidates.length>0 && <label className="block text-xs text-muted">Compare another portfolio-sized alternative<select value={selectedCandidate?`${selectedCandidate.quote.symbol}|${selectedCandidate.contracts}`:''} onChange={(e)=>{setSelected(e.target.value);setClock(() => Date.now())}} className={control}>{ranking.candidates.slice(0,15).map((c)=><option key={c.quote.symbol} value={`${c.quote.symbol}|${c.contracts}`}>{c.contracts} × {c.quote.symbol} · worst target gap {usd(c.worstGap)} · debit {usd(c.debit)}</option>)}</select></label>}
    <p className="text-xs text-faint">No automatic trades, broker submissions, roll approvals or brokerage DRIP changes. Account house requirements and cross-account collateral offsets must be verified with Schwab. Price history excludes distributions; beta and correlation can change during a crash.</p>
  </section>
}
