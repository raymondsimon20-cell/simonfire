import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import { ArrowDownLeft, CalendarCheck2, Percent } from 'lucide-react'
import { coverageGap, loanAssumption, statementProfit, statementTwr, type StatementMonth, type FlowContext, EMPTY_FLOWS } from '../lib/statement-history'
import { monthLabel, pct, shortDate, usd } from '../lib/format'
import { StatCard } from './ui'
import { BalanceOverview, HistoryBadge } from './BalanceOverview'

export function StatementHistory({ rows, flows = EMPTY_FLOWS }: { rows: StatementMonth[]; flows?: FlowContext }) {
  const profitOf = (row: StatementMonth) => statementProfit(row, flows.withheld.get(row.month) ?? 0)
  const last = rows.at(-1)
  if (!last) return <p className="card p-5 text-muted">No recorded balances in this range.</p>
  const profits = rows.map(profitOf)
  const profit = profits.every((value) => value != null) ? profits.reduce((sum, value) => sum + value!, 0) : undefined
  const netDeposits = rows.every((row) => row.flowsAvailable !== false) ? rows.reduce((sum, row) => sum + row.deposits + row.withdrawals, 0) : undefined
  const automatic = rows.some((row) => row.statements.some((item) => item.source === 'Automatic snapshot'))
  const assets = last.marginLoanBalance == null ? undefined : last.closingEquity + last.marginLoanBalance
  const twr = statementTwr(rows, '', flows)
  return <>
    <BalanceOverview equity={last.closingEquity} label="Recorded net equity" date={last.asOf ? `As of ${shortDate(last.asOf)}` : `${monthLabel(last.month)} · month end`} profit={profit} funding={netDeposits} estimated={automatic} badge={<HistoryBadge row={last}/>} note={`Results across ${rows.length} displayed month${rows.length === 1 ? '' : 's'}. ${profit == null ? 'Some months are missing an opening balance or complete cash flows.' : 'Income and market changes, less expenses. Contributions and tax withheld are tracked separately.'}`}/>
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label="Margin debt" value={last.marginLoanBalance == null ? '—' : usd(last.marginLoanBalance)} sub="Latest recorded balance" right={<ArrowDownLeft size={15} className="text-faint"/>}/>
      <StatCard label="Equity ratio" value={assets == null ? '—' : pct(assets ? last.closingEquity / assets * 100 : 0)} sub="Equity / total assets" right={<Percent size={15} className="text-faint"/>}/>
      <StatCard label="Time-weighted return" value={twr.ok ? pct(twr.twrPct * 100, { sign: true }) : '—'} valueClass={twr.ok ? twr.twrPct >= 0 ? 'text-pos' : 'text-neg' : 'text-faint'} sub={twr.ok ? `${monthLabel(twr.startMonth)} — ${monthLabel(twr.endMonth)} · deposits excluded` : 'Needs a complete month with an opening balance'}/>
      <StatCard label="History captured" value={`${rows.length} month${rows.length === 1 ? '' : 's'}`} sub={`${monthLabel(rows[0].month)} — ${monthLabel(last.month)}`} right={<CalendarCheck2 size={15} className="text-faint"/>}/>
    </div>
    <section className="card overflow-hidden p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-1 text-[10px] uppercase tracking-[.16em] text-[#c7a96b]">The long view</p><h2 className="text-lg font-medium">Equity over time</h2><p className="mt-1 text-xs text-faint">Recorded checkpoints. Current and partial months use their latest observation.</p></div><div className="flex gap-4 text-[11px] text-muted"><span className="flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-[#d8bd7a]"/>Net equity</span><span className="flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-[#648cb6]"/>Margin debt</span></div></div>
      {rows.some((row) => !row.complete) && <p className="mt-3 text-xs text-amber-200">Partial account coverage: each month includes only its recorded accounts. The Monthly record below names the missing statements. Select an account to compare its history.</p>}
      <div className="mt-7 h-72 sm:h-80"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
        <defs><linearGradient id="recorded-equity-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c7a96b" stopOpacity={0.2}/><stop offset="100%" stopColor="#c7a96b" stopOpacity={0}/></linearGradient></defs>
        <CartesianGrid stroke="#ffffff08" vertical={false}/>
        <XAxis dataKey="month" tickFormatter={(month) => new Date(`${month}-01T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })} tick={{ fill: '#798393', fontSize: 11 }} axisLine={false} tickLine={false} dy={10}/>
        <YAxis tickFormatter={(value: number) => `$${(value / 1000).toFixed(0)}k`} tick={{ fill: '#798393', fontSize: 11 }} axisLine={false} tickLine={false} width={58}/>
        <Tooltip content={<RecordedTooltip/>} cursor={{ stroke: '#c7a96b40', strokeDasharray: '4 4' }}/>
        <Area type="linear" dataKey="closingEquity" name="Net equity" stroke="#d8bd7a" strokeWidth={2.5} fill="url(#recorded-equity-fill)" dot={{ r: 3, fill: '#d8bd7a', stroke: '#12171e', strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={false}/>
        <Line type="linear" dataKey="marginLoanBalance" name="Margin debt" stroke="#648cb6" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls={false} isAnimationActive={false}/>
      </ComposedChart></ResponsiveContainer></div>
    </section>
    <section className="card mt-5 overflow-hidden p-0"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[.06] px-5 py-5 sm:px-6"><div><h2 className="text-base font-medium">Monthly record</h2><p className="mt-1 text-xs text-faint">Statements take precedence over automatic snapshots.</p></div><span className="rounded-md border border-white/[.07] px-2 py-1 text-[10px] text-faint">{rows.length} checkpoints</span></div>
      <div className="overflow-auto"><table className="w-full min-w-[950px] text-xs">
        <thead><tr className="border-b border-border-soft text-[10px] uppercase tracking-[.07em] text-faint">{['Month / source', 'Net equity', 'Deposits', 'Withdrawals', 'Income', 'Expenses', 'Market & other', 'Investment result', 'Margin debt'].map((label, index) => <th key={label} className={`px-4 py-3.5 font-medium ${index ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr></thead>
        <tbody>{rows.slice().reverse().map((row) => <tr key={row.month} className="border-b border-white/[.04] last:border-0 hover:bg-white/[.025]">
          <th className="min-w-[230px] px-5 py-4 text-left font-medium"><span className="block whitespace-nowrap">{monthLabel(row.month)}</span><span className="mt-2 block"><HistoryBadge row={row}/></span>{row.asOf && <span className="mt-1 block text-[10px] font-normal text-faint">As of {shortDate(row.asOf)}</span>}{coverageGap(row) && <span className="mt-1.5 block max-w-[260px] whitespace-normal text-[10px] font-normal leading-relaxed text-amber-200/80">{coverageGap(row)}</span>}</th>
          {[row.closingEquity, row.flowsAvailable !== false ? row.deposits : undefined, row.flowsAvailable !== false ? row.withdrawals : undefined, row.flowsAvailable !== false ? row.dividendsInterest : undefined, row.flowsAvailable !== false ? row.expenses : undefined, profitOf(row) != null ? row.marketChange + (flows.withheld.get(row.month) ?? 0) : undefined, profitOf(row), row.marginLoanBalance].map((value, index) => <td key={index} title={index === 7 ? loanAssumption(row) || undefined : undefined} className={`num whitespace-nowrap px-4 py-4 text-right ${index === 0 ? 'font-medium text-[#e9d8ad]' : index === 6 && value != null ? value >= 0 ? 'text-pos' : 'text-neg' : 'text-muted'}`}>{value == null ? '—' : usd(value)}{index === 7 && value != null && loanAssumption(row) && <span className="ml-0.5 cursor-help text-faint">*</span>}</td>)}
        </tr>)}</tbody>
      </table></div>
      <p className="border-t border-white/[.06] px-5 py-3 text-[11px] leading-relaxed text-faint sm:px-6">Deposits and withdrawals are as printed on each statement, so a transfer between two of your own accounts appears in both columns; net funding is unaffected. A blank Market &amp; other or Investment result means the month has no opening balance for every account. Schwab prints a Net Loan Balance only when an account is borrowing, so a margin-enabled account without that line counts as $0 (marked *, hover for the account). Margin debt stays blank only when that account shows a loan in both the month before and the month after.</p>
    </section>
  </>
}

function RecordedTooltip({ active, payload }: { active?: boolean; payload?: readonly { payload: StatementMonth }[] }) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return <div className="min-w-52 rounded-xl border border-white/10 bg-[#111720]/95 p-4 text-xs shadow-2xl backdrop-blur-xl"><p className="mb-3 font-medium">{monthLabel(row.month)}</p><HistoryBadge row={row}/><dl className="mt-3 space-y-2"><div className="flex justify-between gap-6"><dt className="text-muted">Net equity</dt><dd className="num text-[#e1c887]">{usd(row.closingEquity)}</dd></div><div className="flex justify-between gap-6"><dt className="text-muted">Margin debt</dt><dd className="num">{row.marginLoanBalance == null ? '—' : usd(row.marginLoanBalance)}</dd></div></dl>{row.asOf && <p className="mt-3 text-[10px] text-faint">Observed {shortDate(row.asOf)}</p>}</div>
}
