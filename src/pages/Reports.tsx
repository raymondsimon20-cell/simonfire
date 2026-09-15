import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useScoped, useStore } from '../lib/store'
import { availableMonths, cashFlow, dividendStats, monthClose, portfolioSummary } from '../lib/calc'
import { averagePortfolioSpending } from '../lib/spending'
import { downloadCsv } from '../lib/csv'
import { monthLabel, pct, usd } from '../lib/format'
import { Button, PageHeader } from '../components/ui'

export default function Reports() {
  const { data } = useStore()
  const { accounts, positions, transactions, scope } = useScoped()
  const months = availableMonths(transactions)
  const [month, setMonth] = useState(months[0] ?? new Date().toISOString().slice(0, 7))
  const report = useMemo(() => {
    const summary = portfolioSummary(positions, accounts, scope, transactions)
    const close = monthClose(accounts, transactions, scope, month, summary)
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
  }, [accounts, month, positions, scope, transactions])
  const livePuts = positions.filter((row) => row.isOption && row.optionType === 'Put' && row.shares > 0).length
  // Live brokerage positions are authoritative. Retain manually tracked active
  // hedges as a fallback for imported/offline portfolios without option holdings.
  const activePuts = livePuts || (data.hedgeRolls ?? []).filter((row) => row.status === 'active').length
  const exportReport = () => downloadCsv(`simonfire-${month}.csv`, [['Metric','Value'],['Opening equity',report.close.opening],['Closing equity',report.close.closing],['Net change',report.close.netChange],['Equity percent',report.close.equityPct],['Dividends received',report.dividends],['Dividend monthly run rate',report.dividendRunRate],['Operating expenses',report.flow.totalExpenses],['Average spending',report.spending?.monthlyAverage ?? 0],['Realized P/L',report.realizedPl],['Active protective puts',activePuts]])
  const dividendDelta = report.dividends - report.priorDividends
  const expenseDelta = report.flow.totalExpenses - report.priorExpenses
  return <div className="print-report"><PageHeader title="Monthly Portfolio Statement" subtitle="Equity, income, spending, realized results, margin, and protection" right={<><select aria-label="Report month" value={month} onChange={(event) => setMonth(event.target.value)} className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm">{months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}</select><Button onClick={() => window.print()}><Printer size={14}/> Print / PDF</Button><Button onClick={exportReport}><Download size={14}/> Export</Button></>}/>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><ReportCard label="Closing equity" value={usd(report.close.closing)}/><ReportCard label="Monthly change" value={usd(report.close.netChange, { sign: true })}/><ReportCard label="Equity after margin" value={pct(report.close.equityPct * 100)}/><ReportCard label="Dividends received" value={usd(report.dividends)}/><ReportCard label="Dividend run rate" value={`${usd(report.dividendRunRate)}/mo`}/><ReportCard label="Operating expenses" value={usd(report.flow.totalExpenses)}/><ReportCard label="Realized P/L" value={usd(report.realizedPl, { sign: true })}/><ReportCard label="Active protective puts" value={String(activePuts)}/></div>
    <div className="mt-6 grid gap-4 lg:grid-cols-2"><div className="card"><h2 className="text-lg font-semibold">Equity bridge</h2><div className="mt-4 divide-y divide-border-soft">{report.close.bridge.map((row) => <div key={row.label} className="flex justify-between py-2 text-sm"><span className="text-muted">{row.label}</span><span className="num">{usd(row.value, { sign: row.kind !== 'base' && row.kind !== 'total' })}</span></div>)}</div></div><div className="card"><h2 className="text-lg font-semibold">What changed and why?</h2><div className="mt-4 space-y-3 text-sm"><Explanation label="Dividend income" value={dividendDelta} text={`${usd(Math.abs(dividendDelta))} ${dividendDelta >= 0 ? 'more' : 'less'} than the prior month, based on received dividend transactions.`}/><Explanation label="Operating expenses" value={-expenseDelta} text={`${usd(Math.abs(expenseDelta))} ${expenseDelta >= 0 ? 'higher' : 'lower'} than the prior month, including fees and margin interest.`}/><Explanation label="Portfolio equity" value={report.close.netChange} text="Closing equity reconciled from opening equity, external flows, income, expenses, and market movement."/></div></div></div>
    <p className="mt-4 text-xs text-faint">Calculation audit: balances and current positions come from Schwab API; matched historical accounting records use CSV; estimated projections are identified separately. This statement is informational and is not a tax document.</p>
  </div>
}
function ReportCard({ label, value }: { label: string; value: string }) { return <div className="card p-5"><div className="text-xs text-muted">{label}</div><div className="num mt-2 text-xl font-semibold">{value}</div></div> }
function Explanation({ label, value, text }: { label: string; value: number; text: string }) { return <div className="rounded-xl border border-border-soft p-3"><div className="flex justify-between gap-3"><strong>{label}</strong><span className={value >= 0 ? 'num text-pos' : 'num text-neg'}>{usd(value, { sign: true })}</span></div><p className="mt-1 text-xs text-faint">{text}</p></div> }
