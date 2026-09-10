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

const todayISO = () => {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export default function Dividends() {
  const { positions, transactions, lastSyncAt } = useScoped()
  const today = todayISO()
  const [calendarMonth, setCalendarMonth] = useState(() => today.slice(0, 7))
  // lastSyncAt is an intentional revision token. A sync can refresh the same
  // transaction identities with amended amounts or fundamentals, so recompute
  // and remount the chart even when its twelve month labels are unchanged.
  const d = useMemo(() => dividendStats(positions, transactions, today), [positions, transactions, today, lastSyncAt])

  const futureData = d.future.map((f) => ({
    label: new Date(f.month + '-01').toLocaleDateString('en-US', { month: 'short' }),
    amount: f.amount,
  }))

  const exportCsv = () =>
    downloadCsv('dividends.csv', [
      ['Symbol', 'Cadence', 'Trailing 12M Received', 'Available History', 'Forward / Run Rate', 'Estimate Source', 'Payments (12M)', 'Last Payment'],
      ...d.bySymbol.map((s) => [s.symbol, s.cadence, s.ttm.toFixed(2), s.availableIncome.toFixed(2), s.projAnnual.toFixed(2), s.estimateSource, s.payments12m, s.lastPayment]),
    ])

  return (
    <div>
      <PageHeader
        title="Dividend Income"
        subtitle={`As of ${today} · synced ${relTime(lastSyncAt)}`}
        right={
          <Button onClick={exportCsv}>
            <Download size={15} /> Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Trailing 12M Income" value={usd(d.trailing12m)} sub={`${d.monthsActive}/12 months active`} icon={<DollarSign size={20} />} tile="green" />
        <KpiCard label="Monthly Average" value={usd(d.monthlyAverage)} icon={<TrendingUp size={20} />} tile="blue" />
        <KpiCard label="Historical Dividend Symbols" value={intfmt(d.dividendSymbols)} sub={`${intfmt(d.totalPayments)} payments in available history`} icon={<Layers size={20} />} tile="purple" />
        <KpiCard label="Available-History Income" value={usd(d.availableIncome)} sub={d.availableHistoryStart ? `Since ${shortDate(d.availableHistoryStart)}` : 'No payment history'} icon={<Landmark size={20} />} tile="teal" />
      </div>

      <div className="mt-8 mb-3 text-xs font-semibold tracking-widest text-faint">PROJECTIONS</div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <DividendCalendar
        month={calendarMonth}
        onMonthChange={setCalendarMonth}
        today={today}
        positions={positions}
        transactions={transactions}
        symbols={d.bySymbol}
      />

      <div className="card mt-6">
        <div className="mb-1 text-lg font-semibold">Historical Payment Pattern (Next 12 Calendar Months)</div>
        <div className="mb-4 text-xs text-faint">Current forward income is distributed using each symbol’s prior payment-month pattern and today’s shares. New payers are spread evenly until payment history establishes a pattern.</div>
        <PositiveBars key={lastSyncAt} data={futureData} xKey="label" yKey="amount" height={280} />
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
    </div>
  )
}

type CalendarEvent = { symbol: string; amount: number; kind: 'cash' | 'drip' | 'scheduled'; date?: string; cadence?: string }

function DividendCalendar({ month, onMonthChange, today, positions, transactions, symbols }: {
  month: string
  onMonthChange: (month: string) => void
  today: string
  positions: ReturnType<typeof useScoped>['positions']
  transactions: ReturnType<typeof useScoped>['transactions']
  symbols: SymbolDividend[]
}) {
  const model = useMemo(() => {
    const [year, monthNumber] = month.split('-').map(Number)
    const daysInMonth = new Date(year, monthNumber, 0).getDate()
    const firstWeekday = new Date(year, monthNumber - 1, 1).getDay()
    const received: CalendarEvent[] = transactions
      .filter((txn) => txn.type === 'Dividend' && txn.date.slice(0, 7) === month)
      .map((txn) => ({ symbol: normTicker(txn.symbol ?? '') || 'Unassigned', amount: txn.amount, date: txn.date, kind: /REINVEST|DRIP/i.test(txn.description) ? 'drip' : 'cash' }))
    const receivedBySymbol = new Map<string, number>()
    for (const event of received) receivedBySymbol.set(event.symbol, (receivedBySymbol.get(event.symbol) ?? 0) + event.amount)

    const currentShares = new Map<string, number>()
    const payDates = new Map<string, string>()
    for (const position of positions) {
      if (position.isOption || position.shares <= 0) continue
      const symbol = normTicker(position.symbol)
      currentShares.set(symbol, (currentShares.get(symbol) ?? 0) + position.shares)
      if (position.dividendPayDate && (!payDates.has(symbol) || position.dividendPayDate > payDates.get(symbol)!)) payDates.set(symbol, position.dividendPayDate)
    }
    const historicalMonths = new Map<string, Set<number>>()
    for (const txn of transactions) {
      if (txn.type !== 'Dividend' || !txn.symbol) continue
      const symbol = normTicker(txn.symbol)
      const set = historicalMonths.get(symbol) ?? new Set<number>()
      set.add(Number(txn.date.slice(5, 7)))
      historicalMonths.set(symbol, set)
    }
    const divisor: Record<SymbolDividend['cadence'], number> = { Weekly: 12, Monthly: 12, Quarterly: 4, Semiannual: 2, Annual: 1, Irregular: 12 }
    const scheduled: CalendarEvent[] = []
    for (const row of symbols) {
      if (!currentShares.has(row.symbol) || row.projAnnual <= 0) continue
      const exactDate = payDates.get(row.symbol)
      const expectedThisMonth = row.cadence === 'Weekly' || row.cadence === 'Monthly'
        || exactDate?.slice(0, 7) === month
        || historicalMonths.get(row.symbol)?.has(monthNumber)
      if (!expectedThisMonth) continue
      const expected = row.projAnnual / divisor[row.cadence]
      const remaining = Math.max(0, expected - (receivedBySymbol.get(row.symbol) ?? 0))
      if (remaining < 0.005) continue
      scheduled.push({ symbol: row.symbol, amount: remaining, cadence: row.cadence, kind: 'scheduled', date: exactDate?.slice(0, 7) === month && exactDate >= today ? exactDate : undefined })
    }
    const byDate = new Map<string, CalendarEvent[]>()
    for (const event of [...received, ...scheduled.filter((event) => event.date)]) {
      const list = byDate.get(event.date!) ?? []
      list.push(event)
      byDate.set(event.date!, list)
    }
    return {
      year, monthNumber, daysInMonth, firstWeekday, byDate,
      receivedTotal: received.reduce((sum, event) => sum + event.amount, 0),
      scheduledTotal: scheduled.reduce((sum, event) => sum + event.amount, 0),
      pending: scheduled.filter((event) => !event.date).sort((a, b) => b.amount - a.amount),
    }
  }, [month, positions, symbols, today, transactions])

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
      <div><h2 className="text-lg font-semibold">Dividend Calendar</h2><p className="mt-1 text-xs text-faint">Received dividends and scheduled dividends stay clearly separate.</p></div>
      <div className="flex items-center gap-2"><button onClick={() => moveMonth(-1)} className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted hover:text-ink"><ChevronLeft size={16}/></button><div className="min-w-36 text-center text-sm font-semibold">{label}</div><button onClick={() => moveMonth(1)} className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted hover:text-ink"><ChevronRight size={16}/></button></div>
    </div>
    <div className="grid border-y border-border-soft sm:grid-cols-2">
      <div className="p-5 sm:border-r sm:border-border-soft"><div className="text-xs text-muted">Received</div><div className="num mt-1 text-2xl font-semibold text-pos">{usd(model.receivedTotal)}</div></div>
      <div className="p-5"><div className="text-xs text-muted">Scheduled · not received</div><div className="num mt-1 text-2xl font-semibold text-[#e1c887]">{usd(model.scheduledTotal)}</div></div>
    </div>
    <div className="flex flex-wrap gap-4 px-5 py-3 text-[11px] text-muted"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-pos"/>Cash received</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#5aa2ff]"/>DRIP received</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#c7a96b]"/>Scheduled</span></div>
    <div className="overflow-x-auto px-3 pb-4 sm:px-5"><div className="min-w-[720px]"><div className="grid grid-cols-7 border-l border-t border-border-soft">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day) => <div key={day} className="border-b border-r border-border-soft bg-surface-2/40 px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-faint">{day}</div>)}</div><div className="grid grid-cols-7 border-l border-border-soft">{cells.map((day, index) => { const date = day ? `${month}-${String(day).padStart(2, '0')}` : ''; const events = date ? model.byDate.get(date) ?? [] : []; return <div key={index} className={clsx('min-h-28 border-b border-r border-border-soft p-2', date === today && 'bg-[#c7a96b]/[.04]')}><div className={clsx('text-xs', date === today ? 'font-bold text-brand' : 'text-muted')}>{day}</div><div className="mt-1 space-y-1">{events.map((event, eventIndex) => <div key={`${event.symbol}-${event.kind}-${eventIndex}`} title={`${event.symbol} · ${usd(event.amount)}`} className={clsx('truncate rounded-md border px-1.5 py-1 text-[10px]', eventTone[event.kind])}><span className="font-semibold">{event.symbol}</span> · {usd(event.amount)}</div>)}</div></div> })}</div></div></div>
    {model.pending.length > 0 && <div className="border-t border-border-soft p-5 sm:p-6"><h3 className="text-sm font-semibold">Scheduled this month — date pending</h3><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{model.pending.map((event) => <div key={event.symbol} className="flex items-center justify-between gap-3 rounded-lg border border-border-soft bg-surface-2/35 px-3 py-2 text-xs"><span><strong>{event.symbol}</strong><span className="ml-1 text-faint">· {event.cadence}</span></span><span className="num text-[#e1c887]">{usd(event.amount)} scheduled</span></div>)}</div></div>}
  </section>
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
        <td className="px-4 py-3"><span className={clsx('rounded-md px-2 py-0.5 text-xs font-medium', s.estimateSource === 'Schwab forward' ? 'bg-pos/10 text-pos' : 'bg-[#38240f] text-[#e7c88f]')}>{s.estimateSource}</span></td>
        <td className="num px-4 py-3 text-right text-muted">{s.payments12m}</td>
        <td className="num px-4 py-3 text-right">{usd(s.avgPayment)}</td>
        <td className="px-4 py-3 text-muted">{s.lastPayment ? shortDate(s.lastPayment) : '—'}</td>
      </tr>
      {open && (
        <tr className="border-b border-border-soft bg-bg/40">
          <td colSpan={11} className="px-4 py-4">
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
