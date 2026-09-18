import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ArrowDownLeft, Landmark, Percent } from 'lucide-react'
import { useScoped, useStore } from '../lib/store'
import { availableMonths, monthClose, portfolioSummary } from '../lib/calc'
import { usd, pct, monthLabel, shortDate } from '../lib/format'
import { PageHeader, StatCard, Card } from '../components/ui'
import { EquityBridge } from '../components/EquityBridge'
import { BalanceOverview, HistoryBadge, SnapshotStatusBar } from '../components/BalanceOverview'
import { statementHistory, statementProfit } from '../lib/statement-history'
import { brokerageDate } from '../lib/balance-snapshots'

export default function MonthClose() {
  const { data } = useStore()
  const { positions, accounts, transactions, scope } = useScoped()
  const snapshots = data.balanceSnapshots ?? []
  const history = useMemo(() => statementHistory(data.historicalBalances ?? [], accounts, scope, data.balanceSnapshots), [data.historicalBalances, data.balanceSnapshots, accounts, scope])
  const months = availableMonths(transactions, history)
  const currentMonth = brokerageDate().slice(0, 7)
  // A routine capture must not move the month the user is reviewing.
  const revision = (data.historicalBalances ?? []).map((row) => `${row.accountMask}:${row.month}:${row.importedAt}`).join('|')
  const [selection, setSelection] = useState<{ month: string; scope: string; revision: string }>()
  const ym = selection?.scope === scope && selection.revision === revision && months.includes(selection.month)
    ? selection.month : history.at(-1)?.month ?? months[0] ?? currentMonth
  const idx = months.indexOf(ym)
  const selectMonth = (month: string) => setSelection({ month, scope, revision })
  const summary = useMemo(() => portfolioSummary(positions, accounts, scope, transactions), [positions, accounts, scope, transactions])
  const mc = monthClose(accounts, transactions, scope, ym, summary, data.historicalBalances, snapshots)
  const row = mc.statement
  const automatic = row?.statements.some((item) => item.source === 'Automatic snapshot')
  const profit = row ? statementProfit(row) : undefined
  const funding = row && row.flowsAvailable !== false ? row.deposits + row.withdrawals : undefined
  const asOf = row?.asOf ? `Recorded ${shortDate(row.asOf)}${ym === currentMonth ? ' · month to date' : row.monthEnd ? ' · month-end snapshot' : ' · partial month'}` : row ? `${monthLabel(ym)} · statement close` : mc.currentBalance ? `Latest synced balance · ${shortDate(data.lastSyncAt)}` : monthLabel(ym)
  const note = row?.coverageNote || (automatic ? 'Recorded balances and synced cash flows. A statement can verify the final month-end result.' : row ? 'Reconciled from your imported monthly summary. Deposits are kept separate from investment results.' : 'Connect Schwab to begin saving balances automatically. Earlier months can be filled with statements.')

  return <div className="fadein">
    <PageHeader title="Month Close" subtitle="Your equity, reconciled. A clear view of what grew and why." right={
      <div className="flex items-center gap-1 rounded-xl border border-border bg-surface/70 p-1">
        <button aria-label="Previous month" onClick={() => selectMonth(months[idx + 1])} disabled={idx >= months.length - 1} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-white/5 disabled:opacity-25"><ChevronLeft size={15}/></button>
        <select aria-label="Month close month" value={ym} onChange={(event) => selectMonth(event.target.value)} className="min-w-[145px] border-0 bg-transparent px-2 py-2 text-center text-sm font-medium">{(months.length ? months : [ym]).map((month) => <option key={month} value={month}>{monthLabel(month)}{month === currentMonth ? ' · MTD' : ''}</option>)}</select>
        <button aria-label="Next month" onClick={() => selectMonth(months[idx - 1])} disabled={idx <= 0} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-white/5 disabled:opacity-25"><ChevronRight size={15}/></button>
      </div>
    }/>
    <SnapshotStatusBar snapshots={snapshots} status={data.snapshotStatus}/>
    <BalanceOverview equity={mc.balanceAvailable ? mc.closing : undefined} label="Net equity" date={asOf} profit={profit} funding={funding} estimated={automatic} note={note} badge={row && <HistoryBadge row={row}/>}/>
    {row && !row.complete && <p className="mb-4 text-xs text-amber-200">Partial account coverage. Totals include only accounts with a balance for this month.</p>}

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label="Equity change" value={mc.historyAvailable ? usd(mc.netChange, { sign: true }) : '—'} sub="Includes net funding" valueClass={mc.historyAvailable ? mc.netChange >= 0 ? 'text-pos' : 'text-neg' : 'text-faint'}/>
      <StatCard label="Total assets" value={mc.debtAvailable ? usd(mc.assets) : '—'} sub="Equity plus margin debt" right={<Landmark size={15} className="text-faint"/>}/>
      <StatCard label="Margin debt" value={mc.debtAvailable ? usd(mc.liabilities) : '—'} sub="At this balance checkpoint" right={<ArrowDownLeft size={15} className="text-faint"/>}/>
      <StatCard label="Equity ratio" value={mc.debtAvailable ? pct(mc.equityPct * 100) : '—'} sub="Your share of total assets" right={<Percent size={15} className="text-faint"/>}/>
    </div>

    <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1.8fr]">
      <Card className="self-start sm:p-6">
        <p className="mb-1 text-[10px] uppercase tracking-[.16em] text-[#c7a96b]">Monthly accounting</p><h2 className="text-lg font-medium">Where the change came from</h2>
        <dl className="mt-5 divide-y divide-white/[.055]">
          <Row label="Opening equity" value={mc.historyAvailable ? mc.opening : undefined}/>
          <Row label="Deposits" value={row?.flowsAvailable !== false ? row?.deposits : undefined}/>
          <Row label="Withdrawals" value={row?.flowsAvailable !== false ? row?.withdrawals : undefined}/>
          <Row label="Income less expenses" value={row && row.flowsAvailable !== false ? row.dividendsInterest + row.expenses : undefined}/>
          <Row label={automatic ? 'Market & other · estimated' : 'Market change'} value={mc.reconciliationAvailable ? mc.marketOther : undefined}/>
          <Row label="Closing equity" value={mc.balanceAvailable ? mc.closing : undefined} bold/>
        </dl>
        <p className="mt-4 text-[11px] leading-relaxed text-faint">{mc.reconciliationAvailable ? 'Opening equity + net funding + investment result = closing equity.' : 'A full reconciliation appears once the opening balance and monthly cash flows are available.'}</p>
      </Card>
      <Card className="sm:p-6"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="mb-1 text-[10px] uppercase tracking-[.16em] text-[#c7a96b]">The monthly story</p><h2 className="text-lg font-medium">Equity Change Bridge</h2></div><span className="text-[11px] text-faint">Select a value for details</span></div>
        <EquityBridge key={`${scope}-${ym}`} close={mc} transactions={transactions} positions={positions} accounts={accounts} scope={scope} chart/>
      </Card>
    </div>
  </div>
}

function Row({ label, value, bold }: { label: string; value?: number; bold?: boolean }) {
  return <div className={`flex items-center justify-between gap-3 py-3.5 text-xs ${bold ? 'font-semibold text-ink' : 'text-muted'}`}><dt>{label}</dt><dd className={`num whitespace-nowrap ${bold ? 'text-base text-[#e1c887]' : 'text-ink'}`}>{value == null ? '—' : usd(value)}</dd></div>
}
