import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import { statementProfit, type StatementMonth } from '../lib/statement-history'
import { monthLabel, usd } from '../lib/format'
import { KpiCard } from './ui'

export function StatementHistory({ rows }: { rows: StatementMonth[] }) {
  const last = rows.at(-1)
  if (!last) return <p className="card p-5 text-muted">No imported statements in this range.</p>
  const profits = rows.map(statementProfit)
  const profit = profits.every((value) => value != null) ? profits.reduce((sum, value) => sum + value!, 0) : undefined
  const netDeposits = rows.reduce((sum, row) => sum + row.deposits + row.withdrawals, 0)
  return <>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard label="Statement closing equity" value={usd(last.closingEquity)} sub={monthLabel(last.month)}/>
      <KpiCard label="Statement margin debt" value={last.marginLoanBalance == null ? '—' : usd(last.marginLoanBalance)} sub={monthLabel(last.month)}/>
      <KpiCard label="Net deposits" value={usd(netDeposits, { sign: true })} sub="Across displayed statement months"/>
      <KpiCard label="Investment result" value={profit == null ? '—' : usd(profit, { sign: true })} sub="After deposits and withdrawals"/>
    </div>
    <section className="card mt-4 p-5">
      <h2 className="text-lg font-semibold">Imported month-end equity</h2>
      <p className="mt-1 text-xs text-muted">Monthly checkpoints from your PDF or balance CSV imports. Investment result includes income and market changes less expenses.</p>
      {rows.some((row) => !row.complete) && <p className="mt-2 text-xs text-[#f0a94a]">Partial account coverage: each month includes only its imported accounts. Select an account to compare its history.</p>}
      <div className="mt-5 h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 10, right: 10, bottom: 0, left: 15 }}>
        <CartesianGrid stroke="#ffffff10" vertical={false}/>
        <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fill: '#9ca3af', fontSize: 11 }}/>
        <YAxis tickFormatter={(value: number) => `$${(value / 1000).toFixed(0)}K`} tick={{ fill: '#9ca3af', fontSize: 11 }}/>
        <Tooltip formatter={(value) => usd(Number(value))} labelFormatter={(value) => monthLabel(String(value))} contentStyle={{ background: '#10151d', borderColor: '#ffffff20' }}/>
        <Line type="linear" dataKey="closingEquity" name="Month-end net equity" stroke="#5aa2ff" strokeWidth={2} dot={{ r: 4 }}/>
      </LineChart></ResponsiveContainer></div>
    </section>
    <section className="card mt-4 overflow-auto p-0"><table className="w-full min-w-[800px] text-sm">
      <caption className="px-5 py-4 text-left font-semibold">Statement balances and results</caption>
      <thead><tr className="border-y border-border-soft text-xs text-muted">{['Month', 'Closing equity', 'Deposits', 'Withdrawals', 'Income', 'Expenses', 'Market change', 'Investment result', 'Margin debt'].map((label, index) => <th key={label} className={`px-4 py-3 font-medium ${index ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr></thead>
      <tbody>{rows.slice().reverse().map((row) => <tr key={row.month} className="border-b border-border-soft">
        <th className="px-4 py-3 text-left font-medium">{monthLabel(row.month)}<span className="block text-xs font-normal text-faint">{row.statements.length} account{row.statements.length === 1 ? '' : 's'}{row.complete ? '' : ' · partial'}</span></th>
        {[row.closingEquity, row.deposits, row.withdrawals, row.dividendsInterest, row.expenses, row.marketChange, statementProfit(row), row.marginLoanBalance].map((value, index) => <td key={index} className="num px-4 py-3 text-right">{value == null ? '—' : usd(value)}</td>)}
      </tr>)}</tbody>
    </table></section>
  </>
}
