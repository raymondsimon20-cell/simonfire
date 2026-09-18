import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Wallet, TrendingUp, Percent, LineChart } from 'lucide-react'
import { useScoped, useStore } from '../lib/store'
import { availableMonths, monthClose, portfolioSummary } from '../lib/calc'
import { usd, pct, monthLabel } from '../lib/format'
import { KpiCard, PageHeader, Card } from '../components/ui'
import { EquityBridge } from '../components/EquityBridge'
import { statementHistory, statementProfit } from '../lib/statement-history'
import clsx from 'clsx'

export default function MonthClose() {
  const { data } = useStore()
  const { positions, accounts, transactions, scope } = useScoped()
  const history = useMemo(() => statementHistory(data.historicalBalances ?? [], accounts, scope), [data.historicalBalances, accounts, scope])
  const months = availableMonths(transactions, history)
  const revision = history.flatMap((row) => row.statements.map((statement) => `${statement.accountMask}:${statement.month}:${statement.importedAt}`)).join('|')
  const [selection, setSelection] = useState<{ month: string; scope: string; revision: string }>()
  const ym = selection?.scope === scope && selection.revision === revision && months.includes(selection.month)
    ? selection.month : history.at(-1)?.month ?? months[0] ?? new Date().toISOString().slice(0, 7)
  const idx = months.indexOf(ym)
  const selectMonth = (month: string) => setSelection({ month, scope, revision })

  const summary = useMemo(
    () => portfolioSummary(positions, accounts, scope, transactions),
    [positions, accounts, scope, transactions],
  )
  const mc = useMemo(
    () => monthClose(accounts, transactions, scope, ym, summary, data.historicalBalances),
    [accounts, transactions, scope, ym, summary, data.historicalBalances],
  )

  return (
    <div>
      <PageHeader
        title="Month Close"
        subtitle="Did your equity grow? Monthly reconciliation and equity tracking"
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => selectMonth(months[idx + 1])}
              disabled={idx >= months.length - 1}
              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface-2 disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <select aria-label="Month close month" value={ym} onChange={(event) => selectMonth(event.target.value)} className="min-w-[150px] rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-medium">
              {(months.length ? months : [ym]).map((month) => <option key={month} value={month}>{monthLabel(month)}{month === ym && mc.currentBalance ? ' (MTD)' : ''}</option>)}
            </select>
            <button
              onClick={() => selectMonth(months[idx - 1])}
              disabled={idx <= 0}
              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface-2 disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        }
      />

      {mc.statement && <p className="mb-4 text-sm text-muted">Using imported month-end balances for {monthLabel(ym)}.{!mc.statement.complete && ' Partial account coverage: totals include only the imported accounts.'} {statementProfit(mc.statement) != null && `Investment result after deposits and withdrawals: ${usd(statementProfit(mc.statement)!, { sign: true })}.`}</p>}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard label={mc.currentBalance ? 'Current Equity' : 'Closing Equity'} value={mc.balanceAvailable ? usd(mc.closing) : '—'} icon={<Wallet size={20} />} tile="blue" />
        <KpiCard
          label="Net Change"
          value={mc.historyAvailable ? usd(mc.netChange, { sign: true }) : '—'}
          valueClass={mc.netChange >= 0 ? 'text-pos' : 'text-neg'}
          icon={<TrendingUp size={20} />}
          tile="green"
        />
        <KpiCard label="Equity %" value={mc.debtAvailable ? pct(mc.equityPct * 100) : '—'} icon={<Percent size={20} />} tile="orange" />
        <KpiCard
          label="Market & Other"
          value={mc.historyAvailable ? usd(mc.marketOther, { sign: true }) : '—'}
          valueClass={mc.marketOther >= 0 ? 'text-pos' : 'text-neg'}
          icon={<LineChart size={20} />}
          tile="teal"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-4 text-lg font-semibold">Balance Sheet</div>
          <Row label="Assets" value={mc.debtAvailable ? usd(mc.assets) : '—'} valueClass="text-pos" />
          <Row label="Liabilities (Margin)" value={mc.debtAvailable ? `(${usd(mc.liabilities)})` : '—'} valueClass="text-neg" />
          <div className="my-3 h-px bg-border-soft" />
          <Row label="Net Equity" value={mc.balanceAvailable ? usd(mc.netEquity) : '—'} bold />
          <Row label="Equity %" value={mc.debtAvailable ? pct(mc.equityPct * 100) : '—'} valueClass="text-[#f0a94a]" />
        </Card>

        <Card>
          <div className="mb-4 text-lg font-semibold">Equity Change Bridge</div>
          <EquityBridge key={`${scope}-${ym}`} close={mc} transactions={transactions} positions={positions} accounts={accounts} scope={scope} chart />
          {mc.realizedEstimated && <p className="mt-2 text-xs text-faint">Realized P/L is estimated from available trades and average cost. Schwab tax lots may differ.</p>}
        </Card>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  valueClass,
  bold,
}: {
  label: string
  value: string
  valueClass?: string
  bold?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className={clsx('text-sm', bold ? 'font-semibold' : 'text-muted')}>{label}</span>
      <span className={clsx('num text-sm', bold ? 'font-semibold text-base' : '', valueClass)}>{value}</span>
    </div>
  )
}
