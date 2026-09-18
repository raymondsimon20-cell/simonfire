import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useScoped, useStore } from '../lib/store'
import { availableMonths, cashFlow, dividendStats, monthClose, portfolioSummary } from '../lib/calc'
import { averagePortfolioSpending } from '../lib/spending'
import { downloadCsv } from '../lib/csv'
import { monthLabel, pct, usd } from '../lib/format'
import { Button, PageHeader, StatCard } from '../components/ui'
import { statementHistory } from '../lib/statement-history'
import { EquityBridge } from '../components/EquityBridge'
import { isActiveProtectivePut } from '../lib/hedge'

export default function Reports() {
  const { data } = useStore()
  const { accounts, positions, transactions, scope } = useScoped()
  const history = statementHistory(data.historicalBalances ?? [], accounts, scope, data.balanceSnapshots)
  const months = availableMonths(transactions, history)
  const revision = (data.historicalBalances ?? []).map((row) => `${row.accountMask}:${row.month}:${row.importedAt}`).join('|')
  const [selection, setSelection] = useState<{ month: string; scope: string; revision: string }>()
  const month = selection?.scope === scope && selection.revision === revision && months.includes(selection.month)
    ? selection.month : history.at(-1)?.month ?? months[0] ?? new Date().toISOString().slice(0, 7)
  const setMonth = (month: string) => setSelection({ month, scope, revision })
  const report = useMemo(() => {
    const summary = portfolioSummary(positions, accounts, scope, transactions)
    const close = monthClose(accounts, transactions, scope, month, summary, data.historicalBalances, data.balanceSnapshots)
    const flow = cashFlow(transactions, `${month}-01`, `${month}-31`)
    const dividends = transactions.filter((row) => row.type === 'Dividend' && row.date.slice(0, 7) === month).reduce((sum, row) => sum + row.amount, 0)
    const dividendRunRate = dividendStats(positions, transactions, `${month}-28`).estMonthly
    const spending = averagePortfolioSpending(transactions, `${month}-28`)
    const realizedPl = transactions.filter((row) => row.date.slice(0, 7) === month && row.pl != null).reduce((sum, row) => sum + (row.pl ?? 0), 0)
    const selected = new Date(`${month}-01T12:00:00`); selected.setMonth(selected.getMonth() - 1)
    const priorMonth = selected.toISOString().slice(0, 7)
    const priorDividends = transactions.filter((row) => row.type === 'Dividend' && row.date.slice(0, 7) === priorMonth).reduce((sum, row) => sum + row.amount, 0)
    const priorExpenses = cashFlow(transactions, `${priorMonth}-01`, `${priorMonth}-31`).totalExpenses
    return { close, flow, dividends, dividendRunRate, spending, realizedPl, priorDividends, priorExpenses }
  }, [accounts, data.historicalBalances, data.balanceSnapshots, month, positions, scope, transactions])
  const livePuts = positions.filter((row) => isActiveProtectivePut(row)).length
  // Live brokerage positions are authoritative. Retain manually tracked active
  // hedges as a fallback for imported/offline portfolios without option holdings.
  const today = new Date().toISOString().slice(0, 10)
  const activePuts = livePuts || (data.hedgeRolls ?? []).filter((row) => row.status === 'active' && row.strike > 0 && row.expiration >= today).length
  const exportReport = () => downloadCsv(`simonfire-${month}.csv`, [['Metric','Value'],['Opening equity',report.close.historyAvailable ? report.close.opening : 'Unavailable'],['Closing equity',report.close.balanceAvailable ? report.close.closing : 'Unavailable'],['Net change',report.close.historyAvailable ? report.close.netChange : 'Unavailable'],['Equity percent',report.close.debtAvailable ? report.close.equityPct : 'Unavailable'],['Dividends received',report.dividends],['Dividend monthly run rate',report.dividendRunRate],['Operating expenses',report.flow.totalExpenses],['Average spending',report.spending?.monthlyAverage ?? 0],['Realized P/L',report.realizedPl],['Active protective puts',activePuts]])
  const dividendDelta = report.dividends - report.priorDividends
  const expenseDelta = report.flow.totalExpenses - report.priorExpenses
  return <div className="print-report"><PageHeader title="Monthly Portfolio Statement" subtitle="Equity, income, spending, realized results, margin, and protection" right={<><select aria-label="Report month" value={month} onChange={(event) => setMonth(event.target.value)} className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm">{months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}</select><Button onClick={() => window.print()}><Printer size={14}/> Print / PDF</Button><Button onClick={exportReport}><Download size={14}/> Export</Button></>}/>
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"><StatCard label="Closing equity" value={report.close.balanceAvailable ? usd(report.close.closing) : '—'}/><StatCard label="Monthly change" value={report.close.historyAvailable ? usd(report.close.netChange, { sign: true }) : '—'} valueClass={report.close.netChange >= 0 ? 'text-pos' : 'text-neg'}/><StatCard label="Equity after margin" value={report.close.debtAvailable ? pct(report.close.equityPct * 100) : '—'}/><StatCard label="Dividends received" value={usd(report.dividends)} valueClass="text-pos"/><StatCard label="Dividend run rate" value={`${usd(report.dividendRunRate)}/mo`}/><StatCard label="Operating expenses" value={usd(report.flow.totalExpenses)} valueClass="text-neg"/><StatCard label="Realized P/L" value={usd(report.realizedPl, { sign: true })} valueClass={report.realizedPl >= 0 ? 'text-pos' : 'text-neg'}/><StatCard label="Active protective puts" value={String(activePuts)}/></div>
    <div className="mt-6 grid gap-4 lg:grid-cols-2"><div className="card p-5"><h2 className="text-lg font-semibold">Equity bridge</h2><EquityBridge key={`${scope}-${month}`} close={report.close} transactions={transactions} positions={positions} accounts={accounts} scope={scope}/></div><div className="card p-5"><h2 className="text-lg font-semibold">What changed and why?</h2><div className="mt-4 space-y-3 text-sm"><Explanation label="Dividend income" value={dividendDelta} text={`${usd(Math.abs(dividendDelta))} ${dividendDelta >= 0 ? 'more' : 'less'} than the prior month, based on received dividend transactions.`}/><Explanation label="Operating expenses" value={-expenseDelta} text={`${usd(Math.abs(expenseDelta))} ${expenseDelta >= 0 ? 'higher' : 'lower'} than the prior month, including fees and margin interest.`}/><p className="text-xs text-muted">{report.close.historyAvailable ? 'Equity change and bridge use recorded balances. Snapshot investment results are estimates; income and spending details use available transactions.' : 'Historical equity change is unavailable until beginning and ending balances are recorded. Contributions are not investment profit.'}{report.close.statement && !report.close.statement.complete && ' Partial account coverage: the equity totals include only accounts with recorded balances.'}</p></div></div></div>
    <p className="mt-4 text-xs text-faint">Calculation audit: balances and current positions come from Schwab API; matched historical accounting records use CSV; estimated projections are identified separately. This statement is informational and is not a tax document.</p>
  </div>
}
function Explanation({ label, value, text }: { label: string; value: number; text: string }) { return <div className="rounded-xl border border-border-soft p-3"><div className="flex justify-between gap-3"><strong>{label}</strong><span className={value >= 0 ? 'num text-pos' : 'num text-neg'}>{usd(value, { sign: true })}</span></div><p className="mt-1 text-xs text-faint">{text}</p></div> }
