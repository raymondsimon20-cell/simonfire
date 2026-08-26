import { useMemo } from 'react'
import { DollarSign, TrendingUp, Layers, Landmark, Target, Calendar, Percent, LineChart } from 'lucide-react'
import { useScoped } from '../lib/store'
import { dividendStats } from '../lib/calc'
import { usd, pct, intfmt } from '../lib/format'
import { KpiCard, PageHeader, Button } from '../components/ui'
import { PositiveBars } from '../components/Charts'
import { downloadCsv } from '../lib/csv'
import { Download } from 'lucide-react'

const TODAY = '2026-08-26'

export default function Dividends() {
  const { positions, transactions } = useScoped()
  const d = useMemo(() => dividendStats(positions, transactions, TODAY), [positions, transactions])

  const futureData = d.future.map((f) => ({
    label: new Date(f.month + '-01').toLocaleDateString('en-US', { month: 'short' }),
    amount: f.amount,
  }))

  const exportCsv = () =>
    downloadCsv('dividends.csv', [
      ['Symbol', 'Trailing 12M', 'Est. Annual'],
      ...d.bySymbol.map((s) => [s.symbol, s.ttm.toFixed(2), s.estAnnual.toFixed(2)]),
    ])

  return (
    <div>
      <PageHeader
        title="Dividend Income"
        subtitle={`As of ${TODAY}`}
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
        <KpiCard label="All-Time Income" value={usd(d.allTime)} icon={<Landmark size={20} />} tile="teal" />
      </div>

      <div className="mt-8 mb-3 text-xs font-semibold tracking-widest text-[--color-faint]">PROJECTIONS</div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Est. Annual Income" value={usd(d.estAnnual)} icon={<Target size={20} />} tile="purple" info="Forward run-rate annualized from recent payments." />
        <KpiCard label="Est. Monthly Income" value={usd(d.estMonthly)} icon={<Calendar size={20} />} tile="blue" />
        <KpiCard label="Yield on Cost" value={pct(d.yieldOnCost * 100)} sub={`${d.symbolCount} of ${positions.length} symbols`} icon={<Percent size={20} />} tile="green" info="Est. annual income / cost basis of paying holdings." />
        <KpiCard label="Forward Yield" value={pct(d.forwardYield * 100)} icon={<LineChart size={20} />} tile="teal" info="Est. annual income / market value of paying holdings." />
      </div>
      <p className="mt-3 text-xs text-[--color-faint]">
        Projected dividend income is an estimate based on historical payments and declared dividends. Past
        distributions are not a guarantee of future distributions. Actual income may differ materially.
      </p>

      <div className="card mt-6">
        <div className="mb-1 text-lg font-semibold">Projected Future Payments (Next 12 Months)</div>
        <div className="mb-4 text-xs text-[--color-faint]">Based on declared dividends and trailing history. Actual payments may vary.</div>
        <PositiveBars data={futureData} xKey="label" yKey="amount" height={280} />
      </div>

      <div className="card mt-4 overflow-x-auto p-0">
        <div className="p-5 pb-0 text-lg font-semibold">Income by Symbol</div>
        <table className="mt-3 w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-y border-[--color-border-soft] text-left text-xs text-[--color-muted]">
              <th className="px-5 py-3 font-medium">Symbol</th>
              <th className="px-5 py-3 text-right font-medium">Trailing 12M</th>
              <th className="px-5 py-3 text-right font-medium">Est. Annual</th>
              <th className="px-5 py-3 text-right font-medium">Est. Monthly</th>
            </tr>
          </thead>
          <tbody>
            {d.bySymbol.map((s) => (
              <tr key={s.symbol} className="border-b border-[--color-border-soft] hover:bg-[--color-surface-2]/40">
                <td className="px-5 py-3 font-semibold">{s.symbol}</td>
                <td className="num px-5 py-3 text-right">{usd(s.ttm)}</td>
                <td className="num px-5 py-3 text-right text-[--color-pos]">{usd(s.estAnnual)}</td>
                <td className="num px-5 py-3 text-right text-[--color-muted]">{usd(s.estAnnual / 12)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
