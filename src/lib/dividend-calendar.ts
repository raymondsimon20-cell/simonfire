import type { SymbolDividend } from './calc'
import { normTicker } from './plan'
import type { Position, Transaction } from './types'

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export function estimateDividendDate(dates: string[], month: string, today: string, cadence: SymbolDividend['cadence']) {
  const valid = dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort()
  if (!valid.length) return undefined
  const [year, monthNumber] = month.split('-').map(Number)
  const daysInMonth = new Date(year, monthNumber, 0).getDate()
  if (cadence === 'Weekly') {
    const weekdays = valid.map((date) => new Date(`${date}T00:00:00`).getDay())
    const weekday = [...new Set(weekdays)].sort((a, b) => weekdays.filter((day) => day === b).length - weekdays.filter((day) => day === a).length)[0]
    const startDay = month === today.slice(0, 7) ? Math.min(daysInMonth, Number(today.slice(8, 10)) + 1) : 1
    for (let day = startDay; day <= daysInMonth; day++) {
      const candidate = new Date(year, monthNumber - 1, day)
      if (candidate.getDay() === weekday) return iso(candidate)
    }
    return undefined
  }
  const sameSeason = valid.filter((date) => Number(date.slice(5, 7)) === monthNumber)
  const evidence = sameSeason.length ? sameSeason : valid
  const days = evidence.map((date) => Number(date.slice(8, 10))).sort((a, b) => a - b)
  const typicalDay = Math.min(daysInMonth, days[Math.floor(days.length / 2)])
  return `${month}-${String(typicalDay).padStart(2, '0')}`
}

export type CalendarEvent = {
  symbol: string; accountId: string; amount: number; kind: 'cash' | 'drip' | 'scheduled'
  date?: string; cadence?: string; transactionId?: string; estimated?: boolean
  dateSource?: 'broker' | 'history'
}

// Broker fundamentals describe a security's distribution, not the account's
// entitlement. Current shares can estimate upcoming income but cannot prove it.
export function buildDividendCalendar(
  positions: Position[], transactions: Transaction[],
  symbols: SymbolDividend[], month: string, today: string,
) {
  const [year, monthNumber] = month.split('-').map(Number)
  const daysInMonth = new Date(year, monthNumber, 0).getDate()
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay()
  const posted = transactions.filter((t) => t.type === 'Dividend' && t.date <= today)
  const received: CalendarEvent[] = posted.filter((t) => t.date.slice(0, 7) === month).map((t) => ({
    accountId: t.accountId, symbol: normTicker(t.symbol ?? '') || 'Unassigned', amount: t.amount,
    date: t.date, kind: /REINVEST|DRIP/i.test(t.description) ? 'drip' : 'cash', transactionId: t.id,
  }))
  const scheduled: CalendarEvent[] = []
  const holdings = new Map<string, Position[]>()
  const sharesBySymbol = new Map<string, number>()
  for (const p of positions) {
    if (p.isOption || p.shares <= 0) continue
    const symbol = normTicker(p.symbol)
    const key = `${p.accountId}|${symbol}`
    holdings.set(key, [...(holdings.get(key) ?? []), p])
    sharesBySymbol.set(symbol, (sharesBySymbol.get(symbol) ?? 0) + p.shares)
  }
  const divisor: Record<SymbolDividend['cadence'], number> = { Weekly: 12, Monthly: 12, Quarterly: 4, Semiannual: 2, Annual: 1, Irregular: 12 }
  if (month >= today.slice(0, 7)) for (const rows of holdings.values()) {
    const symbol = normTicker(rows[0].symbol)
    const accountId = rows[0].accountId
    const row = symbols.find((s) => s.symbol === symbol)
    if (!row || row.projAnnual <= 0) continue
    const history = posted.filter((t) => normTicker(t.symbol ?? '') === symbol && t.amount > 0)
    const paid = received.filter((t) => t.accountId === accountId && t.symbol === symbol && t.amount > 0)
    // Only use a broker date when all slices of this holding agree on it.
    const exactDate = rows.every((p) => p.dividendPayDate === rows[0].dividendPayDate) ? rows[0].dividendPayDate : undefined
    let brokerDate = exactDate?.slice(0, 7) === month ? exactDate : undefined
    if (brokerDate && (paid.some((t) => t.date === brokerDate) || brokerDate < today)) {
      if (row.cadence !== 'Weekly') continue
      brokerDate = undefined
    }
    if (!brokerDate && row.cadence !== 'Weekly' && paid.length) continue
    const expectedThisMonth = row.cadence === 'Weekly' || row.cadence === 'Monthly'
      || !!brokerDate || history.some((t) => Number(t.date.slice(5, 7)) === monthNumber)
    if (!expectedThisMonth) continue
    const shares = rows.reduce((sum, p) => sum + p.shares, 0)
    const monthlyEstimate = row.projAnnual * shares / sharesBySymbol.get(symbol)! / divisor[row.cadence]
    const perPayment = brokerDate && rows.every((p) => p.lastDividend != null && p.lastDividend > 0)
      ? rows.reduce((sum, p) => sum + p.shares * p.lastDividend!, 0) : undefined
    const amount = brokerDate
      ? perPayment ?? row.projAnnual * shares / sharesBySymbol.get(symbol)! / (row.cadence === 'Weekly' ? 52 : divisor[row.cadence])
      : Math.max(0, monthlyEstimate - paid.reduce((sum, t) => sum + t.amount, 0))
    if (amount < 0.005) continue
    // A monthly total for a weekly payer must not be pinned to one payment day.
    const estimatedDate = brokerDate || row.cadence === 'Weekly' ? undefined
      : estimateDividendDate(history.map((t) => t.date), month, today, row.cadence)
    const date = brokerDate ?? (estimatedDate && estimatedDate >= today ? estimatedDate : undefined)
    scheduled.push({ symbol, accountId, amount, cadence: row.cadence, kind: 'scheduled',
      date, estimated: true, dateSource: brokerDate ? 'broker' : 'history' })
  }
  const byDate = new Map<string, CalendarEvent[]>()
  for (const event of [...received, ...scheduled.filter((e) => e.date)]) {
    byDate.set(event.date!, [...(byDate.get(event.date!) ?? []), event])
  }
  return { year, monthNumber, daysInMonth, firstWeekday, byDate, received,
    cashTotal: received.filter((e) => e.kind === 'cash').reduce((sum, e) => sum + e.amount, 0),
    dripTotal: received.filter((e) => e.kind === 'drip').reduce((sum, e) => sum + e.amount, 0),
    receivedTotal: received.reduce((sum, e) => sum + e.amount, 0),
    scheduledTotal: scheduled.reduce((sum, e) => sum + e.amount, 0),
    pending: scheduled.filter((e) => !e.date).sort((a, b) => b.amount - a.amount) }
}
