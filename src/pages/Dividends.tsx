import { useMemo, useState } from 'react'
import { DollarSign, TrendingUp, Layers, Landmark, Target, Calendar, Percent, LineChart, ChevronRight, Download } from 'lucide-react'
import { useScoped } from '../lib/store'
import { dividendStats, type SymbolDividend } from '../lib/calc'
import { usd, pct, intfmt, shortDate } from '../lib/format'
import { KpiCard, PageHeader, Button } from '../components/ui'
import { PositiveBars } from '../components/Charts'
import { downloadCsv } from '../lib/csv'
import { normTicker } from '../lib/plan'
import clsx from 'clsx'

const todayISO = () => {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export default function Dividends() {
  const { positions, transactions } = useScoped()
  const today = todayISO()
  const d = useMemo(() => dividendStats(positions, transactions, today), [positions, transactions, today])

  const futureData = d.future.map((f) => ({
    label: new Date(f.month + '-01').toLocaleDateString('en-US', { month: 'short' }),
    amount: f.amount,
  }))

  const exportCsv = () =>
    downloadCsv('dividends.csv', [
      ['Symbol', 'Cadence', 'Trailing 12M Received', 'Available History', 'Current Run Rate', 'Payments (12M)', 'Last Payment'],
      ...d.bySymbol.map((s) => [s.symbol, s.cadence, s.ttm.toFixed(2), s.availableIncome.toFixed(2), s.projAnnual.toFixed(2), s.payments12m, s.lastPayment]),
    ])

  return (
    <div>
      <PageHeader
        title="Dividend Income"
        subtitle={`As of ${today}`}
        right={
          <Button onClick={exportCsv}>
            <Download size={15} /> Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Trailing 12M Income" value={usd(d.trailing12m)} sub={`${d.monthsActive}/12 months active`} icon={<DollarSign size={20} />} tile="green" />
        <KpiCard label="Monthly Average" value={usd(d.monthlyAverage)} icon={<TrendingUp size={20} />} tile="blue" />
        <KpiCard label="Dividend Symbols" value={intfmt(d.dividendSymbols)} sub={`${intfmt(d.totalPayments)} total payments`} icon={<Layers size={20} />} tile="purple" />
        <KpiCard label="Available-History Income" value={usd(d.availableIncome)} sub={d.availableHistoryStart ? `Since ${shortDate(d.availableHistoryStart)}` : 'No payment history'} icon={<Landmark size={20} />} tile="teal" />
      </div>

      <div className="mt-8 mb-3 text-xs font-semibold tracking-widest text-faint">PROJECTIONS</div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Current Annual Run Rate" value={usd(d.estAnnual)} icon={<Target size={20} />} tile="purple" info="Trailing per-share distributions scaled to the shares you hold now. This is historical, not a declared forward dividend." />
        <KpiCard label="Est. Monthly Income" value={usd(d.estMonthly)} icon={<Calendar size={20} />} tile="blue" />
        <KpiCard label="Yield on Cost" value={pct(d.yieldOnCost * 100)} sub={`${d.symbolCount} paying symbols`} icon={<Percent size={20} />} tile="green" info="Current annual run rate / current cost basis of long equity and ETF dividend payers. Options are excluded." />
        <KpiCard label="Distribution Yield" value={pct(d.distributionYield * 100)} icon={<LineChart size={20} />} tile="teal" info="Current annual run rate / current market value of long equity and ETF dividend payers. Options are excluded." />
      </div>
      <p className="mt-3 text-xs text-faint">
        Run-rate income is estimated from historical per-share payments scaled to current shares. It does not include declared future dividends.
        Past distributions are not a guarantee of future distributions, and actual income may differ materially.
      </p>

      {(d.unassignedTrailing12m !== 0 || d.unassignedAvailable !== 0) && (
        <div className="mt-4 rounded-lg border border-[#3a2a12] bg-[#241a0c]/60 p-3 text-xs text-[#e7c88f]">
          Unassigned dividend transactions: {usd(d.unassignedTrailing12m)} received in the trailing 12 months and {usd(d.unassignedAvailable)} in available history. These are included in headline received income but excluded from symbol yields and run-rate estimates.
        </div>
      )}

      <div className="card mt-6">
        <div className="mb-1 text-lg font-semibold">Projected Future Payments (Next 12 Months)</div>
        <div className="mb-4 text-xs text-faint">Historical monthly payment pattern, adjusted to today’s share counts. The next month begins the 12-month window.</div>
        <PositiveBars data={futureData} xKey="label" yKey="amount" height={280} />
      </div>

      <div className="card mt-6 overflow-x-auto p-0">
        <div className="p-5 pb-0 text-lg font-semibold">Dividends by Symbol</div>
        <table className="mt-3 w-full min-w-[1040px] text-sm">
          <thead>
            <tr className="border-y border-border-soft text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">Symbol</th>
              <th className="px-4 py-3 font-medium">Cadence</th>
              <th className="px-4 py-3 text-right font-medium">T12M</th>
              <th className="px-4 py-3 text-right font-medium">Available History</th>
              <th className="px-4 py-3 text-right font-medium">Est. YoC %</th>
              <th className="px-4 py-3 text-right font-medium">Dist. Yield %</th>
              <th className="px-4 py-3 text-right font-medium">Current Run Rate</th>
              <th className="px-4 py-3 text-right font-medium">Payments (12M)</th>
              <th className="px-4 py-3 text-right font-medium">Avg Payment</th>
              <th className="px-4 py-3 font-medium">Last Payment</th>
            </tr>
          </thead>
          <tbody>
            {d.bySymbol.map((s) => (
              <SymbolRow key={s.symbol} s={s} />
            ))}
            {(d.unassignedTrailing12m !== 0 || d.unassignedAvailable !== 0) && (
              <tr className="border-b border-[#3a2a12] bg-[#241a0c]/30 text-[#e7c88f]">
                <td className="px-4 py-3 font-semibold">Unassigned</td>
                <td className="px-4 py-3 text-xs">Missing symbol</td>
                <td className="num px-4 py-3 text-right">{usd(d.unassignedTrailing12m)}</td>
                <td className="num px-4 py-3 text-right">{usd(d.unassignedAvailable)}</td>
                <td className="px-4 py-3 text-right">—</td>
                <td className="px-4 py-3 text-right">—</td>
                <td className="px-4 py-3 text-right">—</td>
                <td className="px-4 py-3 text-right">—</td>
                <td className="px-4 py-3 text-right">—</td>
                <td className="px-4 py-3">—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SymbolRow({ s }: { s: SymbolDividend }) {
  const { transactions, accounts } = useScoped()
  const [open, setOpen] = useState(false)
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? ''
  const payments = useMemo(
    () =>
      transactions
        .filter((t) => t.type === 'Dividend' && normTicker(t.symbol ?? '') === s.symbol)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [transactions, s.symbol],
  )

  return (
    <>
      <tr
        onClick={() => setOpen((o) => !o)}
        className="cursor-pointer border-b border-border-soft hover:bg-surface-2/40"
      >
        <td className="px-4 py-3">
          <span className="flex items-center gap-2 font-semibold">
            <ChevronRight size={14} className={clsx('transition-transform', open && 'rotate-90')} />
            {s.symbol}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className="rounded-md bg-[#10233f] px-2 py-0.5 text-xs font-medium text-[#5aa2ff]">{s.cadence}</span>
        </td>
        <td className="num px-4 py-3 text-right">{usd(s.ttm)}</td>
        <td className="num px-4 py-3 text-right text-muted">{usd(s.availableIncome)}</td>
        <td className="num px-4 py-3 text-right text-pos">{pct(s.yoc * 100)}</td>
        <td className="num px-4 py-3 text-right text-pos">{pct(s.distributionYield * 100)}</td>
        <td className="num px-4 py-3 text-right">{usd(s.projAnnual)}</td>
        <td className="num px-4 py-3 text-right text-muted">{s.payments12m}</td>
        <td className="num px-4 py-3 text-right">{usd(s.avgPayment)}</td>
        <td className="px-4 py-3 text-muted">{s.lastPayment ? shortDate(s.lastPayment) : '—'}</td>
      </tr>
      {open && (
        <tr className="border-b border-border-soft bg-bg/40">
          <td colSpan={10} className="px-4 py-4">
            <div className="mb-2 text-xs text-faint">
              {payments.length} dividend payment{payments.length === 1 ? '' : 's'} for {s.symbol}
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border-soft">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Account</th>
                    <th className="px-4 py-2 font-medium">Description</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.slice(0, 200).map((t) => (
                    <tr key={t.id} className="border-t border-border-soft">
                      <td className="whitespace-nowrap px-4 py-2 text-muted">{shortDate(t.date)}</td>
                      <td className="px-4 py-2">
                        <span className="rounded-md bg-[#123024] px-2 py-0.5 text-xs font-medium text-[#3fd88a]">Cash Dividend</span>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted">{accName(t.accountId)}</td>
                      <td className="max-w-[320px] truncate px-4 py-2 text-muted">{t.description}</td>
                      <td className="num px-4 py-2 text-right text-pos">{usd(t.amount, { sign: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
