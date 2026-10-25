import { useMemo, useState } from 'react'
import { DollarSign, TrendingUp, Layers, Landmark, Target, Calendar, Percent, LineChart, ChevronRight, ChevronLeft, Download } from 'lucide-react'
import { useScoped } from '../lib/store'
import { dividendStats, type SymbolDividend } from '../lib/calc'
import { usd, pct, intfmt, shortDate, relTime } from '../lib/format'
import { KpiCard, PageHeader, Button } from '../components/ui'
import { PositiveBars } from '../components/Charts'
import { downloadCsv } from '../lib/csv'
import { normTicker } from '../lib/plan'
import clsx from 'clsx'
import { TransactionDrawer } from '../components/TransactionDrawer'
import type { Transaction } from '../lib/types'
import { buildDividendCalendar } from '../lib/dividend-calendar'
import { SourceBadge } from '../components/SourceBadge'

const todayISO = () => {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export default function Dividends() {
  const { positions, transactions, accounts, scope, lastSyncAt } = useScoped()
  const today = todayISO()
  const [calendarMonth, setCalendarMonth] = useState(() => today.slice(0, 7))
  const [selectedDividend, setSelectedDividend] = useState<Transaction | null>(null)
  // lastSyncAt is an intentional revision token. A sync can refresh the same
  // transaction identities with amended amounts or fundamentals, so recompute
  // and remount the chart even when its twelve month labels are unchanged.
  const d = useMemo(() => dividendStats(positions, transactions, today), [positions, transactions, today, lastSyncAt])

  const futureData = d.future.map((f) => ({
    label: new Date(f.month + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    amount: f.amount,
  }))
  const historicalData = useMemo(() => {
    const end = new Date(`${today.slice(0, 7)}-01T00:00:00`)
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date(end.getFullYear(), end.getMonth() - 11 + index, 1)
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      return {
        label: date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        amount: transactions
          .filter((transaction) => transaction.type === 'Dividend' && transaction.date <= today && transaction.date.slice(0, 7) === month)
          .reduce((sum, transaction) => sum + transaction.amount, 0),
      }
    })
  }, [today, transactions])

  const selectedYear = calendarMonth.slice(0, 4)
  const yearReceived = transactions.filter((t) => t.type === 'Dividend' && t.date.slice(0, 4) === selectedYear && t.date <= today).reduce((sum, t) => sum + t.amount, 0)
  const scopeLabel = scope === 'all' ? 'All accounts' : accounts.find((a) => a.id === scope)?.name ?? 'Selected account'

  const exportCsv = () =>
    downloadCsv('dividends.csv', [
      ['Symbol', 'Cadence', 'Trailing 12M Received', 'Available History', 'Forward / Run Rate', 'Estimate Source', 'Confidence', 'Payments (12M)', 'Last Payment'],
      ...d.bySymbol.map((s) => [s.symbol, s.cadence, s.ttm.toFixed(2), s.availableIncome.toFixed(2), s.projAnnual.toFixed(2), s.estimateSource, s.confidence, s.payments12m, s.lastPayment]),
    ])

  return (
    <div>
      <PageHeader
        title="Dividend Income"
        subtitle={`${scopeLabel} · As of ${shortDate(today)} · synced ${relTime(lastSyncAt)}`}
        right={
          <Button onClick={exportCsv}>
            <Download size={15} /> Export CSV
          </Button>
        }
      />

      <DividendCalendar
        month={calendarMonth}
        onMonthChange={setCalendarMonth}
        today={today}
        positions={positions}
        transactions={transactions}
        symbols={d.bySymbol}
        onSelect={(id) => setSelectedDividend(transactions.find((transaction) => transaction.id === id) ?? null)}
      />

      <div className="mt-5 rounded-xl border border-border-soft bg-surface-2/40 p-4"><div className="text-xs text-muted">{selectedYear} received dividends · {scopeLabel}</div><div className="num mt-1 text-xl font-semibold text-pos">{usd(yearReceived)}</div><p className="mt-1 text-xs text-faint">Calendar-year posted dividends through {shortDate(today)}, including reinvestments and corrections. Interest is excluded. Match the account and year selected in Schwab to compare.</p></div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard label="Trailing 12M Income" value={usd(d.trailing12m)} sub={`${d.monthsActive}/12 months active`} icon={<DollarSign size={20} />} tile="green" />
        <KpiCard label="Monthly Average" value={usd(d.monthlyAverage)} icon={<TrendingUp size={20} />} tile="blue" />
        <KpiCard label="Historical Dividend Symbols" value={intfmt(d.dividendSymbols)} sub={`${intfmt(d.totalPayments)} payments in available history`} icon={<Layers size={20} />} tile="purple" />
        <KpiCard label="Available-History Income" value={usd(d.availableIncome)} sub={d.availableHistoryStart ? `Since ${shortDate(d.availableHistoryStart)}` : 'No payment history'} icon={<Landmark size={20} />} tile="teal" />
      </div>

      <div className="mt-8 mb-3 text-xs font-semibold tracking-widest text-faint">PROJECTIONS</div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard label="Estimated Annual Income" value={usd(d.estAnnual)} sub={`${pct(d.forwardCoverage * 100)} Schwab forward coverage`} icon={<Target size={20} />} tile="purple" info="Uses Schwab's indicated annual dividend per share when available, multiplied by current shares. Symbols without fundamentals fall back to trailing per-share distributions." />
        <KpiCard label="Est. Monthly Income" value={usd(d.estMonthly)} icon={<Calendar size={20} />} tile="blue" />
        <KpiCard label="Yield on Cost" value={pct(d.yieldOnCost * 100)} sub={`${d.symbolCount} paying symbols`} icon={<Percent size={20} />} tile="green" info="Current annual run rate / current cost basis of long equity and ETF dividend payers. Options are excluded." />
        <KpiCard label="Distribution Yield" value={pct(d.distributionYield * 100)} icon={<LineChart size={20} />} tile="teal" info="Current annual run rate / current market value of long equity and ETF dividend payers. Options are excluded." />
      </div>
      <p className="mt-3 text-xs text-faint">
        Estimated income combines {usd(d.schwabForwardIncome)} from Schwab forward fundamentals and {usd(d.historicalEstimateIncome)} from historical fallbacks.
        Schwab and fund distributions can change; actual income may differ materially.
      </p>

      {(d.unassignedTrailing12m !== 0 || d.unassignedAvailable !== 0) && (
        <div className="mt-4 rounded-lg border border-[#3a2a12] bg-[#241a0c]/60 p-3 text-xs text-[#e7c88f]">
          Unassigned dividend transactions: {usd(d.unassignedTrailing12m)} received in the trailing 12 months and {usd(d.unassignedAvailable)} in available history. These are included in headline received income but excluded from symbol yields and run-rate estimates.
        </div>
      )}



      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <div className="card">
          <div className="mb-1 flex items-center gap-2 text-lg font-semibold">Historical Payment Pattern <SourceBadge source="csv" label="PDF / CSV / API records"/></div>
          <div className="mb-4 text-xs text-faint">Dividends actually received in each of the last 12 calendar months, including assigned and unassigned payments.</div>
          <PositiveBars key={`history-${lastSyncAt}`} data={historicalData} xKey="label" yKey="amount" height={280} color="#34d17d" />
        </div>
        <div className="card">
          <div className="mb-1 flex items-center gap-2 text-lg font-semibold">Projected Next 12 Months <SourceBadge source="estimated"/></div>
          <div className="mb-4 text-xs text-faint">Estimated forward income distributed using prior payment timing and today’s shares. This is a forecast, not received cash.</div>
          <PositiveBars key={`forecast-${lastSyncAt}`} data={futureData} xKey="label" yKey="amount" height={280} />
        </div>
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
              <th className="px-4 py-3 text-right font-medium">Forward / Run Rate</th>
              <th className="px-4 py-3 font-medium">Estimate Source</th>
              <th className="px-4 py-3 font-medium">Confidence</th>
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
                <td className="px-4 py-3">—</td>
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
      <TransactionDrawer txn={selectedDividend} onClose={() => setSelectedDividend(null)} />
    </div>
  )
}


function DividendCalendar({ month, onMonthChange, today, positions, transactions, symbols, onSelect }: {
  month: string
  onMonthChange: (month: string) => void
  today: string
  positions: ReturnType<typeof useScoped>['positions']
  transactions: ReturnType<typeof useScoped>['transactions']
  symbols: SymbolDividend[]
  onSelect: (transactionId: string) => void
}) {
  const { accounts } = useScoped()
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Account'
  const model = useMemo(() => buildDividendCalendar(positions, transactions, symbols, month, today), [month, positions, symbols, today, transactions])

  const moveMonth = (amount: number) => {
    const [year, monthNumber] = month.split('-').map(Number)
    const next = new Date(year, monthNumber - 1 + amount, 1)
    onMonthChange(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
  }
  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const cells = Array.from({ length: model.firstWeekday + model.daysInMonth }, (_, index) => index < model.firstWeekday ? null : index - model.firstWeekday + 1)
  while (cells.length % 7) cells.push(null)
  const eventTone = { cash: 'border-pos/25 bg-pos/10 text-pos', drip: 'border-[#5aa2ff]/25 bg-[#5aa2ff]/10 text-[#7fb5ff]', scheduled: 'border-[#c7a96b]/25 bg-[#c7a96b]/10 text-[#e1c887]' }

  return <section className="card mt-6 overflow-hidden p-0">
    <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
      <div><h2 className="text-lg font-semibold">Monthly Dividend Income</h2><p className="mt-1 text-xs text-faint">Received shows posted dividend records through today, including reinvestments and corrections. Upcoming amounts are estimates based on current shares; Schwab may show different eligible shares or distributions. A ~ marks an estimated date; amounts are always estimates until posted.</p></div>
      <div className="flex items-center gap-2"><button aria-label="Previous dividend month" onClick={() => moveMonth(-1)} className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted hover:text-ink"><ChevronLeft size={16}/></button><div className="min-w-36 text-center text-sm font-semibold">{label}</div><button aria-label="Next dividend month" onClick={() => moveMonth(1)} className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted hover:text-ink"><ChevronRight size={16}/></button></div>
    </div>
    <div className="grid border-y border-border-soft sm:grid-cols-2">
      <div className="p-5 sm:border-r sm:border-border-soft"><div className="text-xs text-muted">Received dividends · {label}</div><div className="num mt-1 text-2xl font-semibold text-pos">{usd(model.receivedTotal)}</div><p className="mt-1 text-xs text-muted">{usd(model.cashTotal)} cash · {usd(model.dripTotal)} reinvested</p></div>
      <div className="p-5"><div className="text-xs text-muted">Est. remaining dividends · {label}</div><div className="num mt-1 text-2xl font-semibold text-[#e1c887]">{usd(model.scheduledTotal)}</div><p className="mt-1 text-xs text-muted">Our estimate from saved holdings and payment history; may differ from Schwab.</p></div>
    </div>
    <div className="flex flex-wrap gap-4 px-5 py-3 text-[11px] text-muted"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-pos"/>Cash received</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#5aa2ff]"/>DRIP received</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#c7a96b]"/>Est. remaining</span></div>
    <div className="overflow-x-auto px-3 pb-4 sm:px-5"><div className="min-w-[720px]"><div className="grid grid-cols-7 border-l border-t border-border-soft">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day) => <div key={day} className="border-b border-r border-border-soft bg-surface-2/40 px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-faint">{day}</div>)}</div><div className="grid grid-cols-7 border-l border-border-soft">{cells.map((day, index) => { const date = day ? `${month}-${String(day).padStart(2, '0')}` : ''; const events = date ? model.byDate.get(date) ?? [] : []; return <div key={index} className={clsx('min-h-28 border-b border-r border-border-soft p-2', date === today && 'bg-[#c7a96b]/[.04]')}><div className={clsx('text-xs', date === today ? 'font-bold text-brand' : 'text-muted')}>{day}</div><div className="mt-1 space-y-1">{events.map((event, eventIndex) => <button key={`${event.symbol}-${event.kind}-${eventIndex}`} onClick={() => event.transactionId && onSelect(event.transactionId)} disabled={!event.transactionId} title={`${event.kind === 'scheduled' ? event.dateSource === 'broker' ? 'Schwab payment date · estimated amount · ' : 'Estimated from payment history · ' : ''}${event.symbol} · ${usd(event.amount)}${event.symbol === 'Unassigned' ? ' · click to assign' : ''}`} className={clsx('block w-full truncate rounded-md border px-1.5 py-1 text-left text-[10px]', eventTone[event.kind], event.estimated && 'border-dashed', event.transactionId && 'hover:brightness-125')}><span className="font-semibold">{event.dateSource === 'history' ? '~' : ''}{event.symbol}</span> · {usd(event.amount)}</button>)}</div></div> })}</div></div></div>
    {model.received.length > 0 && <details className="border-t border-border-soft p-5"><summary className="cursor-pointer text-sm font-semibold">Received payments · {model.received.length} record{model.received.length === 1 ? '' : 's'}</summary><p className="mt-2 text-xs text-faint">Posted dates and amounts from saved transactions. Select a payment to check its account, source, or classification.</p><div className="mt-3 max-h-72 overflow-auto">{[...model.received].sort((a, b) => b.date!.localeCompare(a.date!)).map((event) => <button key={event.transactionId} onClick={() => onSelect(event.transactionId!)} className="flex w-full items-center justify-between gap-3 border-t border-border-soft py-3 text-left text-xs"><span><strong>{event.symbol}</strong><span className="ml-2 text-muted">{shortDate(event.date!)} · {accountName(event.accountId)} · {event.kind === 'drip' ? 'Reinvested' : event.amount < 0 ? 'Correction' : 'Cash'}</span></span><span className="num">{usd(event.amount)}</span></button>)}</div></details>}
    {model.pending.length > 0 && <div className="border-t border-border-soft p-5 sm:p-6"><h3 className="text-sm font-semibold">Estimated this month · date pending</h3><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{model.pending.map((event) => <div key={`${event.accountId}-${event.symbol}`} className="flex items-center justify-between gap-3 rounded-lg border border-border-soft bg-surface-2/35 px-3 py-2 text-xs"><span><strong>{event.symbol}</strong><span className="ml-1 text-faint">· {event.cadence} · {accountName(event.accountId)}</span></span><span className="num text-[#e1c887]">{usd(event.amount)} estimated</span></div>)}</div></div>}
  </section>
}

function SymbolRow({ s }: { s: SymbolDividend }) {
  const { transactions, accounts } = useScoped()
  const [open, setOpen] = useState(false)
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? ''
  const asOf = todayISO()
  const payments = useMemo(
    () =>
      transactions
        .filter((t) => t.type === 'Dividend' && t.date <= asOf && normTicker(t.symbol ?? '') === s.symbol)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [transactions, s.symbol, asOf],
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
        <td className="px-4 py-3"><span className={clsx('rounded-md px-2 py-0.5 text-xs font-medium', s.estimateSource === 'Schwab forward' ? 'bg-pos/10 text-pos' : 'bg-[#38240f] text-[#e7c88f]')}>{s.estimateSource}</span></td>
        <td className="px-4 py-3"><span title={s.confidenceReason} className={clsx('rounded-md px-2 py-0.5 text-xs font-medium', s.confidence === 'High' ? 'bg-pos/10 text-pos' : s.confidence === 'Medium' ? 'bg-[#38240f] text-[#e7c88f]' : 'bg-neg/10 text-neg')}>{s.confidence}</span></td>
        <td className="num px-4 py-3 text-right text-muted">{s.payments12m}</td>
        <td className="num px-4 py-3 text-right">{usd(s.avgPayment)}</td>
        <td className="px-4 py-3 text-muted">{s.lastPayment ? shortDate(s.lastPayment) : '—'}</td>
      </tr>
      {open && (
        <tr className="border-b border-border-soft bg-bg/40">
          <td colSpan={12} className="px-4 py-4">
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
                        <span className="rounded-md bg-[#123024] px-2 py-0.5 text-xs font-medium text-[#3fd88a]">{/REINVEST|DRIP/i.test(t.description) ? 'Reinvested Dividend' : t.amount < 0 ? 'Dividend Correction' : 'Cash Dividend'}</span>
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
