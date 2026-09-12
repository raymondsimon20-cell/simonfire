import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useScoped } from '../lib/store'
import { availableMonths, cashFlow, dividendStats, monthClose, portfolioSummary } from '../lib/calc'
import { averagePortfolioSpending } from '../lib/spending'
import { downloadCsv } from '../lib/csv'
import { monthLabel, pct, usd } from '../lib/format'
import { Button, PageHeader } from '../components/ui'

export default function Reports() {
  const { accounts, positions, transactions, scope } = useScoped()
  const months = availableMonths(transactions)
  const [month, setMonth] = useState(months[0] ?? new Date().toISOString().slice(0, 7))
  const report = useMemo(() => {
    const summary = portfolioSummary(positions, accounts, scope, transactions)
    const close = monthClose(accounts, transactions, scope, month, summary)
    const flow = cashFlow(transactions, `${month}-01`, `${month}-31`)
    const dividends = transactions.filter((transaction) => transaction.type === 'Dividend' && transaction.date.slice(0, 7) === month).reduce((sum, transaction) => sum + transaction.amount, 0)
    const dividendRunRate = dividendStats(positions, transactions, `${month}-28`).estMonthly
    const spending = averagePortfolioSpending(transactions, `${month}-28`)
    const selected = new Date(`${month}-01T12:00:00`); selected.setMonth(selected.getMonth() - 1)
    const priorMonth = selected.toISOString().slice(0, 7)
    const priorDividends = transactions.filter((transaction) => transaction.type === 'Dividend' && transaction.date.slice(0, 7) === priorMonth).reduce((sum, transaction) => sum + transaction.amount, 0)
    const priorFlow = cashFlow(transactions, `${priorMonth}-01`, `${priorMonth}-31`)
    return { close, flow, dividends, dividendRunRate, spending, priorDividends, priorFlow }
  }, [accounts, month, positions, scope, transactions])
  const exportReport = () => downloadCsv(`simonfire-${month}.csv`, [['Metric','Value'],['Opening equity',report.close.opening],['Closing equity',report.close.closing],['Net change',report.close.netChange],['Equity percent',report.close.equityPct],['Dividends received',report.dividends],['Dividend monthly run rate',report.dividendRunRate],['Operating expenses',report.flow.totalExpenses],['Average spending',report.spending?.monthlyAverage ?? 0]])
  return <div><PageHeader title="Monthly Report" subtitle="A printable snapshot of equity, income, spending, and risk" right={<><select value={month} onChange={(event) => setMonth(event.target.value)} className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm">{months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}</select><Button onClick={() => window.print()}><Printer size={14}/> Print</Button><Button onClick={exportReport}><Download size={14}/> Export</Button></>}/><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><ReportCard label="Closing equity" value={usd(report.close.closing)}/><ReportCard label="Monthly change" value={usd(report.close.netChange, { sign: true })}/><ReportCard label="Equity after margin" value={pct(report.close.equityPct * 100)}/><ReportCard label="Dividends received" value={usd(report.dividends)}/><ReportCard label="Dividend run rate" value={`${usd(report.dividendRunRate)}/mo`}/><ReportCard label="Operating expenses" value={usd(report.flow.totalExpenses)}/><ReportCard label="Observed spending" value={report.spending ? `${usd(report.spending.monthlyAverage)}/mo` : 'Not available'}/><ReportCard label="Margin interest" value={usd(report.flow.marginCost)}/></div><div className="card mt-6"><h2 className="text-lg font-semibold">Equity bridge</h2><div className="mt-4 divide-y divide-border-soft">{report.close.bridge.map((row) => <div key={row.label} className="flex justify-between py-2 text-sm"><span className="text-muted">{row.label}</span><span className="num">{usd(row.value, { sign: row.kind !== 'base' && row.kind !== 'total' })}</span></div>)}</div></div><p className="mt-4 text-xs text-faint">Calculated from the records currently available in SimonFIRE. Estimated dividends and realized P/L can differ from final brokerage and tax records.</p></div>
}
function ReportCard({ label, value }: { label: string; value: string }) { return <div className="card p-5"><div className="text-xs text-muted">{label}</div><div className="num mt-2 text-xl font-semibold">{value}</div></div> }
