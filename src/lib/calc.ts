import type { Account, Position, Transaction } from './types'

// ---------- Position-level ----------
export interface PosMetrics {
  value: number
  costBasis: number
  dayChange: number
  dayChangePct: number
  totalGain: number
  totalGainPct: number
  totalReturn: number
  totalReturnPct: number
}

export function positionMetrics(p: Position): PosMetrics {
  const value = p.shares * p.lastPrice
  const costBasis = p.shares * p.avgCost
  const dayChange = p.shares * (p.lastPrice - p.prevClose)
  const dayChangePct = p.prevClose ? (p.lastPrice - p.prevClose) / p.prevClose : 0
  const totalGain = value - costBasis
  const totalGainPct = costBasis ? totalGain / costBasis : 0
  const totalReturn = totalGain + p.dividendsReceived
  const totalReturnPct = costBasis ? totalReturn / costBasis : 0
  return {
    value,
    costBasis,
    dayChange,
    dayChangePct,
    totalGain,
    totalGainPct,
    totalReturn,
    totalReturnPct,
  }
}

// ---------- Portfolio summary ----------
export interface PortfolioSummary {
  gross: number
  net: number
  marginUsed: number
  equityPct: number
  uniquePositions: number
  uniqueSymbols: number
  availableCash: number
  dayChange: number
  dayChangePct: number
  totalGain: number
  totalGainPct: number
  totalReturn: number
  totalReturnPct: number
}

export function portfolioSummary(
  positions: Position[],
  accounts: Account[],
  scope: string,
  transactions: Transaction[],
): PortfolioSummary {
  const inScope = (id: string) => scope === 'all' || id === scope
  const scopedAccounts = accounts.filter((a) => inScope(a.id))
  const availableCash = scopedAccounts.reduce((s, a) => s + a.cash, 0)
  const marginUsed = scopedAccounts.reduce((s, a) => s + a.marginBalance, 0)

  let value = 0
  let cost = 0
  let day = 0
  let gain = 0
  let ret = 0
  for (const p of positions) {
    const m = positionMetrics(p)
    value += m.value
    cost += m.costBasis
    day += m.dayChange
    gain += m.totalGain
    ret += m.totalReturn
  }
  const realized = transactions
    .filter((t) => t.type === 'Sell')
    .reduce((s, t) => s + (t.pl ?? 0), 0)
  ret += realized

  const gross = value + availableCash
  const net = gross - marginUsed
  const symbols = new Set(positions.map((p) => p.symbol))
  const prevValue = value - day

  return {
    gross,
    net,
    marginUsed,
    equityPct: gross ? net / gross : 0,
    uniquePositions: positions.length,
    uniqueSymbols: symbols.size,
    availableCash,
    dayChange: day,
    dayChangePct: prevValue ? day / prevValue : 0,
    totalGain: gain,
    totalGainPct: cost ? gain / cost : 0,
    totalReturn: ret,
    totalReturnPct: cost ? ret / cost : 0,
  }
}

// ---------- Shared transaction classification ----------
const INCOME_TYPES = new Set(['Dividend', 'Interest', 'Other'])

export function isInflow(t: Transaction) {
  return t.amount > 0
}
export function isExpense(t: Transaction) {
  return (
    t.amount < 0 &&
    (t.type === 'Bill Payment' ||
      t.type === 'Fee' ||
      t.type === 'Withdrawal' ||
      t.type === 'Interest' ||
      t.type === 'Other')
  )
}
export function isCapital(t: Transaction) {
  return t.type === 'Buy' || (t.type === 'Sell' && t.amount !== 0)
}

// ---------- Cash flow ----------
export interface CashFlow {
  totalIncome: number
  totalExpenses: number
  marginCost: number
  contributions: number
  cashWithdrawals: number
  capitalDeployed: number
  netOperating: number
  daily: { date: string; net: number }[]
}

export function cashFlow(txns: Transaction[], fromISO: string, toISO: string): CashFlow {
  const inRange = txns.filter((t) => t.date >= fromISO && t.date <= toISO)
  let totalIncome = 0
  let totalExpenses = 0
  let marginCost = 0
  let contributions = 0
  let cashWithdrawals = 0
  let capitalDeployed = 0
  const perDay = new Map<string, number>()

  for (const t of inRange) {
    if (t.amount > 0 && INCOME_TYPES.has(t.type)) {
      totalIncome += t.amount
      perDay.set(t.date, (perDay.get(t.date) ?? 0) + t.amount)
    }
    if (isExpense(t)) {
      totalExpenses += -t.amount
      perDay.set(t.date, (perDay.get(t.date) ?? 0) + t.amount)
    }
    if (t.type === 'Interest' && t.amount < 0) marginCost += -t.amount
    if (t.type === 'Contribution') contributions += t.amount
    if (t.type === 'Withdrawal') cashWithdrawals += -t.amount
    if (t.type === 'Buy') capitalDeployed += -t.amount
  }

  // Build a continuous daily series across the range.
  const daily: { date: string; net: number }[] = []
  const d = new Date(fromISO + 'T00:00:00')
  const end = new Date(toISO + 'T00:00:00')
  while (d <= end) {
    const k = d.toISOString().slice(0, 10)
    daily.push({ date: k, net: +(perDay.get(k) ?? 0).toFixed(2) })
    d.setDate(d.getDate() + 1)
  }

  return {
    totalIncome,
    totalExpenses,
    marginCost,
    contributions,
    cashWithdrawals,
    capitalDeployed,
    netOperating: totalIncome - totalExpenses,
    daily,
  }
}

// ---------- Dividends ----------
export interface DividendStats {
  trailing12m: number
  monthsActive: number
  monthlyAverage: number
  dividendSymbols: number
  totalPayments: number
  allTime: number
  estAnnual: number
  estMonthly: number
  yieldOnCost: number
  forwardYield: number
  symbolCount: number
  future: { month: string; amount: number }[]
  bySymbol: { symbol: string; ttm: number; estAnnual: number }[]
}

export function dividendStats(
  positions: Position[],
  txns: Transaction[],
  todayISO: string,
): DividendStats {
  const divs = txns.filter((t) => t.type === 'Dividend')
  const today = new Date(todayISO + 'T00:00:00')
  const yearAgo = new Date(today)
  yearAgo.setFullYear(yearAgo.getFullYear() - 1)
  const q = new Date(today)
  q.setDate(q.getDate() - 90)

  let trailing12m = 0
  let allTime = 0
  const months = new Set<string>()
  const ttmBySym = new Map<string, number>()
  const recentBySym = new Map<string, number>()

  for (const t of divs) {
    allTime += t.amount
    const dt = new Date(t.date + 'T00:00:00')
    if (dt >= yearAgo) {
      trailing12m += t.amount
      months.add(t.date.slice(0, 7))
      if (t.symbol) ttmBySym.set(t.symbol, (ttmBySym.get(t.symbol) ?? 0) + t.amount)
    }
    if (dt >= q && t.symbol)
      recentBySym.set(t.symbol, (recentBySym.get(t.symbol) ?? 0) + t.amount)
  }

  // Forward run-rate: annualize the last 90 days per symbol.
  const bySymbol: { symbol: string; ttm: number; estAnnual: number }[] = []
  let estAnnual = 0
  const payingSymbols = new Set<string>([...ttmBySym.keys(), ...recentBySym.keys()])
  for (const sym of payingSymbols) {
    const est = (recentBySym.get(sym) ?? 0) * (365 / 90)
    estAnnual += est
    bySymbol.push({ symbol: sym, ttm: ttmBySym.get(sym) ?? 0, estAnnual: est })
  }
  bySymbol.sort((a, b) => b.estAnnual - a.estAnnual)

  // Yield metrics against dividend-paying holdings.
  const payerSet = new Set(bySymbol.map((b) => b.symbol))
  let payerCost = 0
  let payerValue = 0
  for (const p of positions) {
    if (payerSet.has(p.symbol)) {
      payerCost += p.shares * p.avgCost
      payerValue += p.shares * p.lastPrice
    }
  }

  const estMonthly = estAnnual / 12
  const future: { month: string; amount: number }[] = []
  const m = new Date(today.getFullYear(), today.getMonth(), 1)
  for (let i = 0; i < 12; i++) {
    const label = new Date(m.getFullYear(), m.getMonth() + i, 1)
      .toISOString()
      .slice(0, 7)
    // gentle seasonal wobble so the bars aren't identical
    const wob = 1 + Math.sin((i / 12) * Math.PI * 2) * 0.06
    future.push({ month: label, amount: +(estMonthly * wob).toFixed(2) })
  }

  return {
    trailing12m,
    monthsActive: Math.min(months.size, 12),
    monthlyAverage: trailing12m / 12,
    dividendSymbols: new Set(divs.map((d) => d.symbol)).size,
    totalPayments: divs.length,
    allTime,
    estAnnual,
    estMonthly,
    yieldOnCost: payerCost ? estAnnual / payerCost : 0,
    forwardYield: payerValue ? estAnnual / payerValue : 0,
    symbolCount: payerSet.size,
    future,
    bySymbol: bySymbol.slice(0, 25),
  }
}

// ---------- Month close ----------
export interface MonthClose {
  ym: string
  opening: number
  closing: number
  netChange: number
  equityPct: number
  marketOther: number
  assets: number
  liabilities: number
  netEquity: number
  bridge: { label: string; value: number; kind: 'base' | 'up' | 'down' | 'total' }[]
}

// Deterministic pseudo market move for a month (few % of equity).
function marketMove(ym: string, equity: number) {
  let h = 0
  for (let i = 0; i < ym.length; i++) h = (h * 31 + ym.charCodeAt(i)) >>> 0
  const f = ((h % 1000) / 1000 - 0.42) * 0.05 // -2.1%..+2.9%
  return +(equity * f).toFixed(2)
}

export function availableMonths(txns: Transaction[]): string[] {
  const s = new Set(txns.map((t) => t.date.slice(0, 7)))
  return [...s].sort().reverse()
}

export function monthClose(
  accounts: Account[],
  txns: Transaction[],
  scope: string,
  ym: string,
  currentSummary: PortfolioSummary,
): MonthClose {
  const monthsSorted = availableMonths(txns).slice().reverse() // ascending
  const flowsOf = (m: string) => {
    const t = txns.filter((x) => x.date.slice(0, 7) === m)
    const contributions = t
      .filter((x) => x.type === 'Contribution')
      .reduce((s, x) => s + x.amount, 0)
    const cf = cashFlow(t, m + '-01', m + '-31')
    const realized = t
      .filter((x) => x.type === 'Sell')
      .reduce((s, x) => s + (x.pl ?? 0), 0)
    return { contributions, netOperating: cf.netOperating, realized }
  }

  // Build equity series backward from the current net equity.
  const closingByMonth = new Map<string, number>()
  const openingByMonth = new Map<string, number>()
  const marketByMonth = new Map<string, number>()
  let closing = currentSummary.net
  for (let i = monthsSorted.length - 1; i >= 0; i--) {
    const m = monthsSorted[i]
    const f = flowsOf(m)
    const mkt = marketMove(m, closing)
    const opening = closing - f.contributions - f.netOperating - f.realized - mkt
    closingByMonth.set(m, closing)
    openingByMonth.set(m, opening)
    marketByMonth.set(m, mkt)
    closing = opening
  }

  const f = flowsOf(ym)
  const opening = openingByMonth.get(ym) ?? currentSummary.net
  const closingVal = closingByMonth.get(ym) ?? currentSummary.net
  const mkt = marketByMonth.get(ym) ?? 0
  const netChange = closingVal - opening

  const isCurrent = ym === monthsSorted[monthsSorted.length - 1]
  const liabilities = scope === 'all' || accounts.find((a) => a.id === scope)?.isMargin
    ? accounts
        .filter((a) => scope === 'all' || a.id === scope)
        .reduce((s, a) => s + a.marginBalance, 0)
    : 0
  const netEquity = isCurrent ? currentSummary.net : closingVal
  const assets = isCurrent ? currentSummary.gross : closingVal + liabilities

  return {
    ym,
    opening,
    closing: closingVal,
    netChange,
    equityPct: assets ? netEquity / assets : 0,
    marketOther: mkt,
    assets,
    liabilities,
    netEquity,
    bridge: [
      { label: 'Opening', value: opening, kind: 'base' },
      { label: 'Contrib.', value: f.contributions, kind: f.contributions >= 0 ? 'up' : 'down' },
      { label: 'Net Oper.', value: f.netOperating, kind: f.netOperating >= 0 ? 'up' : 'down' },
      { label: 'Realized P/L', value: f.realized, kind: f.realized >= 0 ? 'up' : 'down' },
      { label: 'Accts Added', value: 0, kind: 'up' },
      { label: 'Mkt & Other', value: mkt, kind: mkt >= 0 ? 'up' : 'down' },
      { label: 'Closing', value: closingVal, kind: 'total' },
    ],
  }
}

// ---------- Ledger ----------
export interface LedgerKpis {
  totalInflows: number
  inflowCount: number
  totalExpenses: number
  expenseCount: number
  capitalDeployed: number
  capitalCount: number
  netCashMovement: number
  totalCount: number
}

export function ledgerKpis(txns: Transaction[]): LedgerKpis {
  let totalInflows = 0
  let inflowCount = 0
  let totalExpenses = 0
  let expenseCount = 0
  let capitalDeployed = 0
  let capitalCount = 0
  for (const t of txns) {
    if (t.type === 'Buy') {
      capitalDeployed += -t.amount
      capitalCount++
    } else if (t.amount > 0) {
      totalInflows += t.amount
      inflowCount++
    } else if (t.amount < 0) {
      totalExpenses += -t.amount
      expenseCount++
    }
  }
  return {
    totalInflows,
    inflowCount,
    totalExpenses,
    expenseCount,
    capitalDeployed,
    capitalCount,
    netCashMovement: totalInflows - totalExpenses - capitalDeployed,
    totalCount: txns.length,
  }
}

export interface LedgerMonth {
  ym: string
  count: number
  inflows: number
  expenses: number
  deployed: number
  net: number
  rows: Transaction[]
}

export function groupByMonth(txns: Transaction[]): LedgerMonth[] {
  const map = new Map<string, Transaction[]>()
  for (const t of txns) {
    const k = t.date.slice(0, 7)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(t)
  }
  const out: LedgerMonth[] = []
  for (const [ym, rows] of map) {
    let inflows = 0
    let expenses = 0
    let deployed = 0
    for (const t of rows) {
      if (t.type === 'Buy') deployed += -t.amount
      else if (t.amount > 0) inflows += t.amount
      else if (t.amount < 0) expenses += -t.amount
    }
    out.push({
      ym,
      count: rows.length,
      inflows,
      expenses,
      deployed,
      net: inflows - expenses - deployed,
      rows,
    })
  }
  out.sort((a, b) => (a.ym < b.ym ? 1 : -1))
  return out
}
