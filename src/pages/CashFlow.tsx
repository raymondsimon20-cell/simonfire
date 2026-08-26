import { useMemo, useState } from 'react'
import {
  Plus,
  Download,
  TrendingUp,
  TrendingDown,
  Percent,
  Landmark,
  ArrowDownToLine,
  RefreshCcw,
  Wallet,
} from 'lucide-react'
import { useScoped } from '../lib/store'
import { cashFlow } from '../lib/calc'
import { usd, pct, shortDate } from '../lib/format'
import { KpiCard, PageHeader, Button, Badge } from '../components/ui'
import { AddContributionModal } from '../components/AddContributionModal'
import { SignedBars } from '../components/Charts'
import { downloadCsv } from '../lib/csv'
import clsx from 'clsx'

const RANGES: Record<string, { label: string; days: number }> = {
  '7': { label: 'Last 7 days', days: 7 },
  '30': { label: 'Last 30 days', days: 30 },
  '90': { label: 'Last 90 days', days: 90 },
  '365': { label: 'Last 12 months', days: 365 },
}

const TODAY = '2026-08-26'
const shift = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export default function CashFlow() {
  const { transactions, accounts } = useScoped()
  const [range, setRange] = useState('30')
  const [category, setCategory] = useState('all')
  const [modal, setModal] = useState(false)

  const from = shift(TODAY, RANGES[range].days - 1)
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? ''

  const scopedTxns = useMemo(
    () => transactions.filter((t) => category === 'all' || t.type === category),
    [transactions, category],
  )
  const cf = useMemo(() => cashFlow(scopedTxns, from, TODAY), [scopedTxns, from])

  const dailyData = cf.daily.map((d) => ({
    label: new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    net: d.net,
  }))

  const detailRows = useMemo(
    () =>
      scopedTxns
        .filter((t) => t.date >= from && t.date <= TODAY)
        .slice(0, 200),
    [scopedTxns, from],
  )

  const exportCsv = () =>
    downloadCsv('cash-flow.csv', [
      ['Date', 'Description', 'Symbol', 'Category', 'Account', 'Amount'],
      ...detailRows.map((t) => [t.date, t.description, t.symbol ?? '', t.type, accName(t.accountId), t.amount.toFixed(2)]),
    ])

  return (
    <div>
      <PageHeader
        title={`${RANGES[range].days === 30 ? '30-Day ' : ''}Cash Flow`}
        subtitle="Ledger-style breakdown of income, expenses, and contributions"
        right={
          <>
            <Button variant="primary" onClick={() => setModal(true)}>
              <Plus size={15} /> Add Contribution
            </Button>
            <Button onClick={exportCsv}>
              <Download size={15} /> Export CSV
            </Button>
          </>
        }
      />

      <div className="card mb-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-[--color-muted]">
          Date Range:
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="rounded-lg border border-[--color-border] bg-[--color-surface-2] px-3 py-2 text-sm text-[--color-ink] outline-none"
          >
            {Object.entries(RANGES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-[--color-muted]">
          Category:
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-[--color-border] bg-[--color-surface-2] px-3 py-2 text-sm text-[--color-ink] outline-none"
          >
            <option value="all">All Categories</option>
            {['Dividend', 'Interest', 'Contribution', 'Withdrawal', 'Bill Payment', 'Fee', 'Buy', 'Sell', 'Other'].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Income" value={usd(cf.totalIncome)} icon={<TrendingUp size={20} />} tile="green" info="Dividends, interest, and other income received in range." />
        <KpiCard label="Total Expenses" value={usd(cf.totalExpenses)} icon={<TrendingDown size={20} />} tile="orange" info="Bills, fees, margin interest, and withdrawals." />
        <KpiCard label="Margin Cost" value={usd(cf.marginCost)} sub={`Est. ${pct((cf.marginCost / Math.max(cf.totalExpenses, 1)) * 100)} (limited data)`} icon={<Percent size={20} />} tile="orange" info="Estimated margin interest cost." />
        <KpiCard label="Contributions" value={usd(cf.contributions)} icon={<Landmark size={20} />} tile="blue" info="External deposits into your accounts." />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Cash Withdrawals" value={usd(cf.cashWithdrawals)} sub="Included in Total Expenses" icon={<ArrowDownToLine size={20} />} tile="orange" />
        <KpiCard label="Capital Deployed" value={usd(cf.capitalDeployed)} icon={<RefreshCcw size={20} />} tile="purple" info="Cash used to buy positions." />
        <KpiCard
          label="Net Operating"
          value={usd(cf.netOperating, { sign: true })}
          valueClass={cf.netOperating >= 0 ? 'text-[--color-pos]' : 'text-[--color-neg]'}
          icon={<Wallet size={20} />}
          tile="green"
          info="Total income minus total expenses."
        />
      </div>

      <div className="card mt-4">
        <div className="mb-1 text-lg font-semibold">Daily Net Operating</div>
        <div className="mb-4 text-xs text-[--color-faint]">
          {shortDate(from)} – {shortDate(TODAY)} ({RANGES[range].days} days)
        </div>
        <SignedBars data={dailyData} xKey="label" yKey="net" height={280} />
      </div>

      <div className="card mt-4 overflow-x-auto p-0">
        <div className="p-5 pb-0 text-lg font-semibold">Transaction Details</div>
        <table className="mt-3 w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-y border-[--color-border-soft] text-left text-xs text-[--color-muted]">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Description</th>
              <th className="px-5 py-3 font-medium">Symbol</th>
              <th className="px-5 py-3 font-medium">Category</th>
              <th className="px-5 py-3 font-medium">Account</th>
              <th className="px-5 py-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {detailRows.map((t) => (
              <tr key={t.id} className="border-b border-[--color-border-soft] hover:bg-[--color-surface-2]/40">
                <td className="whitespace-nowrap px-5 py-3 text-[--color-muted]">{shortDate(t.date)}</td>
                <td className="max-w-[280px] truncate px-5 py-3">{t.description}</td>
                <td className="px-5 py-3 font-semibold">{t.symbol ?? '—'}</td>
                <td className="px-5 py-3"><Badge>{t.type}</Badge></td>
                <td className="px-5 py-3 text-xs text-[--color-muted]">{accName(t.accountId)}</td>
                <td className={clsx('num px-5 py-3 text-right font-medium', t.amount > 0 ? 'text-[--color-pos]' : t.amount < 0 ? 'text-[--color-neg]' : 'text-[--color-faint]')}>
                  {t.amount === 0 ? usd(0) : usd(t.amount, { sign: true })}
                </td>
              </tr>
            ))}
            {detailRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-[--color-faint]">
                  No transactions in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AddContributionModal open={modal} onClose={() => setModal(false)} />
    </div>
  )
}
