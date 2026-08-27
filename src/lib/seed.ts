import type {
  Account,
  AppData,
  Connection,
  Position,
  Transaction,
  TwrSeries,
  TxnType,
} from './types'
import { DEFAULT_KEEP } from './plan'

// Small deterministic PRNG so the sample data is stable between reloads.
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(20260826)
const rand = (a: number, b: number) => a + rnd() * (b - a)
const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]

const iso = (d: Date) => d.toISOString().slice(0, 10)
const isoDT = (d: Date) => d.toISOString()

// ---- Accounts (mirrors a Schwab household: joint, individual margin, Roth IRA) ----
const accounts: Account[] = [
  {
    id: 'acc_joint',
    broker: 'Schwab',
    name: 'Ray & Salina',
    fullName: 'Ray and Salina (Ray and Salina ...414)',
    mask: '414',
    type: 'Joint',
    isMargin: false,
    cash: 92.4,
    marginBalance: 0,
  },
  {
    id: 'acc_margin',
    broker: 'Schwab',
    name: 'Raymond',
    fullName: 'Raymond (Raymond ...391)',
    mask: '391',
    type: 'Margin',
    isMargin: true,
    cash: 143.9,
    marginBalance: 22428.17,
  },
  {
    id: 'acc_roth',
    broker: 'Schwab',
    name: 'Roth IRA',
    fullName: 'Roth Contributory IRA ...870 (Roth Contributory IRA)',
    mask: '870',
    type: 'Roth IRA',
    isMargin: false,
    cash: 51.41,
    marginBalance: 0,
  },
]

// ---- Symbol catalog: high-yield / options-income ETFs (weekly & monthly payers) ----
interface SymDef {
  symbol: string
  name: string
  price: number
  annualYield: number // as decimal, on price
  freq: 'weekly' | 'monthly'
}
const catalog: SymDef[] = [
  { symbol: 'QDTE', name: 'ROUNDHILL INNOVATION-100 0DTE COVERED CALL ETF', price: 28.87, annualYield: 0.55, freq: 'weekly' },
  { symbol: 'QQQY', name: 'DEFIANCE NASDAQ 100 ENHANCED OPTIONS INCOME ETF', price: 22.36, annualYield: 0.6, freq: 'weekly' },
  { symbol: 'NVDY', name: 'YIELDMAX NVDA OPTION INCOME STRATEGY ETF', price: 12.42, annualYield: 0.78, freq: 'weekly' },
  { symbol: 'TSLY', name: 'YIELDMAX TSLA OPTION INCOME STRATEGY ETF', price: 22.07, annualYield: 0.65, freq: 'weekly' },
  { symbol: 'WEEK', name: 'ROUNDHILL WEEKLY T-BILL ETF', price: 50.11, annualYield: 0.048, freq: 'weekly' },
  { symbol: 'BRKW', name: 'ROUNDHILL BRKB WEEKLYPAY ETF', price: 45.9, annualYield: 0.32, freq: 'weekly' },
  { symbol: 'BIOY', name: 'GRANITESHARES YIELDBOOST BIOTECH ETF', price: 18.44, annualYield: 0.72, freq: 'weekly' },
  { symbol: 'STK', name: 'COLUMBIA SELIGMAN PREMIUM TECH GROWTH FUND', price: 36.2, annualYield: 0.09, freq: 'monthly' },
  { symbol: 'MSTY', name: 'YIELDMAX MSTR OPTION INCOME STRATEGY ETF', price: 21.15, annualYield: 0.95, freq: 'weekly' },
  { symbol: 'YMAX', name: 'YIELDMAX UNIVERSE FUND OF OPTION INCOME ETFS', price: 15.02, annualYield: 0.7, freq: 'weekly' },
  { symbol: 'ULTY', name: 'YIELDMAX ULTRA OPTION INCOME STRATEGY ETF', price: 6.11, annualYield: 0.82, freq: 'weekly' },
  { symbol: 'CONY', name: 'YIELDMAX COIN OPTION INCOME STRATEGY ETF', price: 13.88, annualYield: 0.68, freq: 'monthly' },
  { symbol: 'JEPQ', name: 'JPMORGAN NASDAQ EQUITY PREMIUM INCOME ETF', price: 54.7, annualYield: 0.11, freq: 'monthly' },
  { symbol: 'JEPI', name: 'JPMORGAN EQUITY PREMIUM INCOME ETF', price: 57.9, annualYield: 0.08, freq: 'monthly' },
  { symbol: 'SPYI', name: 'NEOS S&P 500 HIGH INCOME ETF', price: 51.3, annualYield: 0.12, freq: 'monthly' },
  { symbol: 'SCHD', name: 'SCHWAB U.S. DIVIDEND EQUITY ETF', price: 27.4, annualYield: 0.037, freq: 'monthly' },
  { symbol: 'AMZY', name: 'YIELDMAX AMZN OPTION INCOME STRATEGY ETF', price: 19.6, annualYield: 0.62, freq: 'weekly' },
  { symbol: 'PLTY', name: 'YIELDMAX PLTR OPTION INCOME STRATEGY ETF', price: 68.4, annualYield: 0.85, freq: 'weekly' },
  { symbol: 'MRNY', name: 'YIELDMAX MRNA OPTION INCOME STRATEGY ETF', price: 4.72, annualYield: 0.7, freq: 'monthly' },
  { symbol: 'FIAT', name: 'YIELDMAX SHORT COIN OPTION INCOME STRATEGY ETF', price: 8.9, annualYield: 0.5, freq: 'monthly' },
  { symbol: 'DEFI', name: 'HASHDEX BITCOIN ETF', price: 72.15, annualYield: 0, freq: 'monthly' },
  { symbol: 'GPTY', name: 'ROUNDHILL AI & TECH INCOME ETF', price: 26.7, annualYield: 0.35, freq: 'weekly' },
  { symbol: 'XDTE', name: 'ROUNDHILL S&P 500 0DTE COVERED CALL ETF', price: 47.2, annualYield: 0.28, freq: 'weekly' },
  { symbol: 'RDTE', name: 'ROUNDHILL RUSSELL 2000 0DTE COVERED CALL ETF', price: 40.1, annualYield: 0.4, freq: 'weekly' },
  { symbol: 'AIPI', name: 'REX AI EQUITY PREMIUM INCOME ETF', price: 44.5, annualYield: 0.3, freq: 'monthly' },
  { symbol: 'IWMY', name: 'DEFIANCE R2000 ENHANCED OPTIONS INCOME ETF', price: 15.3, annualYield: 0.68, freq: 'weekly' },
  { symbol: 'SDTY', name: 'ROUNDHILL S&P 500 TARGET 20 INCOME ETF', price: 24.1, annualYield: 0.2, freq: 'weekly' },
  { symbol: 'CRSH', name: 'YIELDMAX SHORT TSLA OPTION INCOME ETF', price: 11.2, annualYield: 0.55, freq: 'monthly' },
  { symbol: 'MST', name: 'MST CAPITAL INCOME ETF', price: 33.4, annualYield: 0.25, freq: 'monthly' },
  { symbol: 'LFGY', name: 'YIELDMAX CRYPTO INDUSTRY & TECH OPTION INCOME ETF', price: 47.8, annualYield: 0.72, freq: 'weekly' },
  { symbol: 'CHPY', name: 'ROUNDHILL S&P HIGHLY SHORTED INCOME ETF', price: 41.9, annualYield: 0.45, freq: 'weekly' },
  { symbol: 'GOOY', name: 'YIELDMAX GOOGL OPTION INCOME STRATEGY ETF', price: 13.1, annualYield: 0.5, freq: 'monthly' },
  { symbol: 'AAPW', name: 'ROUNDHILL AAPL WEEKLYPAY ETF', price: 43.2, annualYield: 0.4, freq: 'weekly' },
  { symbol: 'NVW', name: 'ROUNDHILL NVDA WEEKLYPAY ETF', price: 39.7, annualYield: 0.55, freq: 'weekly' },
  { symbol: 'HOOW', name: 'ROUNDHILL HOOD WEEKLYPAY ETF', price: 51.6, annualYield: 0.6, freq: 'weekly' },
  { symbol: 'JEPY', name: 'DEFIANCE S&P 500 ENHANCED OPTIONS INCOME ETF', price: 16.9, annualYield: 0.55, freq: 'weekly' },
  { symbol: 'WDTE', name: 'ROUNDHILL S&P 500 0DTE WEEKLY ETF', price: 44.3, annualYield: 0.3, freq: 'weekly' },
  { symbol: 'TSPY', name: 'DEFIANCE S&P 500 TARGET INCOME ETF', price: 25.2, annualYield: 0.18, freq: 'monthly' },
  { symbol: 'MSTW', name: 'ROUNDHILL MSTR WEEKLYPAY ETF', price: 55.1, annualYield: 0.8, freq: 'weekly' },
  { symbol: 'COIW', name: 'ROUNDHILL COIN WEEKLYPAY ETF', price: 48.3, annualYield: 0.7, freq: 'weekly' },
  { symbol: 'METW', name: 'ROUNDHILL META WEEKLYPAY ETF', price: 42.7, annualYield: 0.38, freq: 'weekly' },
  { symbol: 'AMDW', name: 'ROUNDHILL AMD WEEKLYPAY ETF', price: 37.9, annualYield: 0.5, freq: 'weekly' },
  { symbol: 'TSMW', name: 'ROUNDHILL TSM WEEKLYPAY ETF', price: 46.2, annualYield: 0.35, freq: 'weekly' },
  { symbol: 'BABW', name: 'ROUNDHILL BABA WEEKLYPAY ETF', price: 33.5, annualYield: 0.45, freq: 'weekly' },
  { symbol: 'SMCX', name: 'YIELDMAX SMCI OPTION INCOME STRATEGY ETF', price: 14.1, annualYield: 0.75, freq: 'weekly' },
  { symbol: 'PLTW', name: 'ROUNDHILL PLTR WEEKLYPAY ETF', price: 58.9, annualYield: 0.72, freq: 'weekly' },
  { symbol: 'SPYT', name: 'DEFIANCE S&P 500 TARGET 20 INCOME ETF', price: 15.6, annualYield: 0.2, freq: 'monthly' },
  { symbol: 'QQQT', name: 'DEFIANCE NASDAQ 100 TARGET 30 INCOME ETF', price: 17.8, annualYield: 0.3, freq: 'monthly' },
  { symbol: 'BTCI', name: 'NEOS BITCOIN HIGH INCOME ETF', price: 51.4, annualYield: 0.28, freq: 'monthly' },
  { symbol: 'QQQI', name: 'NEOS NASDAQ 100 HIGH INCOME ETF', price: 52.9, annualYield: 0.14, freq: 'monthly' },
  { symbol: 'IWMI', name: 'NEOS RUSSELL 2000 HIGH INCOME ETF', price: 48.6, annualYield: 0.15, freq: 'monthly' },
  { symbol: 'RDTY', name: 'ROUNDHILL RUSSELL 2000 TARGET INCOME ETF', price: 23.4, annualYield: 0.32, freq: 'weekly' },
  { symbol: 'GLDI', name: 'NEOS GOLD HIGH INCOME ETF', price: 49.1, annualYield: 0.09, freq: 'monthly' },
  { symbol: 'DIVO', name: 'AMPLIFY CWP ENHANCED DIVIDEND INCOME ETF', price: 41.3, annualYield: 0.05, freq: 'monthly' },
  { symbol: 'QYLD', name: 'GLOBAL X NASDAQ 100 COVERED CALL ETF', price: 17.2, annualYield: 0.12, freq: 'monthly' },
  { symbol: 'RYLD', name: 'GLOBAL X RUSSELL 2000 COVERED CALL ETF', price: 15.9, annualYield: 0.13, freq: 'monthly' },
  { symbol: 'XYLD', name: 'GLOBAL X S&P 500 COVERED CALL ETF', price: 39.8, annualYield: 0.1, freq: 'monthly' },
  { symbol: 'SVOL', name: 'SIMPLIFY VOLATILITY PREMIUM ETF', price: 21.7, annualYield: 0.16, freq: 'monthly' },
  { symbol: 'NVDW', name: 'ROUNDHILL NVDA WEEKLYPAY (B) ETF', price: 41.1, annualYield: 0.56, freq: 'weekly' },
  { symbol: 'TSLW', name: 'ROUNDHILL TSLA WEEKLYPAY ETF', price: 36.4, annualYield: 0.6, freq: 'weekly' },
  { symbol: 'AVGW', name: 'ROUNDHILL AVGO WEEKLYPAY ETF', price: 52.3, annualYield: 0.42, freq: 'weekly' },
  { symbol: 'GLDY', name: 'YIELDMAX GOLD MINERS OPTION INCOME ETF', price: 19.2, annualYield: 0.35, freq: 'monthly' },
  { symbol: 'ABNY', name: 'YIELDMAX ABNB OPTION INCOME STRATEGY ETF', price: 12.6, annualYield: 0.48, freq: 'monthly' },
  { symbol: 'SNOY', name: 'YIELDMAX SNOW OPTION INCOME STRATEGY ETF', price: 10.4, annualYield: 0.52, freq: 'monthly' },
]

// Assign holdings across accounts. Bigger positions in the margin account.
const bySymbolPre = new Map<string, SymDef>(catalog.map((c) => [c.symbol, c]))

const positions: Position[] = []
let pid = 0
// count = holdings per account; targetValue = desired total market value for that account.
const distribute: { accountId: string; count: number; targetValue: number }[] = [
  { accountId: 'acc_margin', count: 92, targetValue: 86000 },
  { accountId: 'acc_joint', count: 40, targetValue: 15400 },
  { accountId: 'acc_roth', count: 28, targetValue: 8000 },
]
let ci = 0
for (const d of distribute) {
  const raw: Position[] = []
  for (let k = 0; k < d.count; k++) {
    const s = catalog[ci % catalog.length]
    ci++
    const drift = rand(-0.14, 0.1)
    raw.push({
      id: `pos_${pid++}`,
      accountId: d.accountId,
      symbol: s.symbol,
      name: s.name,
      shares: Math.round(rand(10, 120)),
      avgCost: +(s.price * (1 - drift)).toFixed(2),
      lastPrice: s.price,
      prevClose: +(s.price * (1 - rand(-0.012, 0.012))).toFixed(2),
      dividendsReceived: 0,
      isOption: false,
    })
  }
  // Scale shares so this account's market value ~= targetValue.
  const rawValue = raw.reduce((sum, p) => sum + p.shares * p.lastPrice, 0)
  const factor = d.targetValue / rawValue
  for (const p of raw) {
    p.shares = Math.max(1, Math.round(p.shares * factor))
    const def = bySymbolPre.get(p.symbol)!
    p.dividendsReceived = +(p.shares * p.lastPrice * def.annualYield * rand(0.3, 0.9)).toFixed(2)
    positions.push(p)
  }
}

// A couple of short option positions to exercise option handling. avgCost/lastPrice
// are stored per-contract (premium × 100); short positions carry negative shares.
positions.push(
  {
    id: `pos_${pid++}`,
    accountId: 'acc_margin',
    symbol: 'OXSQ',
    name: 'Put $1 Sep 18, 2026',
    shares: -3,
    avgCost: 4.33,
    lastPrice: 5,
    prevClose: 5,
    dividendsReceived: 0,
    isOption: true,
    optionType: 'Put',
    strike: 1,
    expiration: '2026-09-18',
    underlying: 'OXSQ',
  },
  {
    id: `pos_${pid++}`,
    accountId: 'acc_margin',
    symbol: 'O',
    name: 'Put $62.5 Sep 18, 2026',
    shares: -1,
    avgCost: 56.34,
    lastPrice: 100,
    prevClose: 100,
    dividendsReceived: 0,
    isOption: true,
    optionType: 'Put',
    strike: 62.5,
    expiration: '2026-09-18',
    underlying: 'O',
  },
)

// ---- Transactions across trailing ~13 months ----
const transactions: Transaction[] = []
let tid = 0
const today = new Date('2026-08-26T12:00:00Z')
const start = new Date(today)
start.setMonth(start.getMonth() - 13)

const bySymbol = new Map<string, SymDef>(catalog.map((c) => [c.symbol, c]))

// Dividend payments for each holding based on frequency.
for (const p of positions) {
  if (p.isOption) continue // options don't pay dividends
  const def = bySymbol.get(p.symbol)
  if (!def || def.annualYield <= 0) continue
  const perYear = def.freq === 'weekly' ? 52 : 12
  const stepDays = def.freq === 'weekly' ? 7 : 30
  const perPayment = (p.shares * def.price * def.annualYield) / perYear
  const d = new Date(start)
  // Align weekly payers to a Thursday-ish cadence
  while (d < today) {
    const amt = +(perPayment * rand(0.78, 1.22)).toFixed(2)
    if (amt >= 0.01) {
      transactions.push({
        id: `txn_${tid++}`,
        accountId: p.accountId,
        date: iso(d),
        type: 'Dividend',
        symbol: p.symbol,
        description: def.name,
        amount: amt,
        units: 0,
        tags: [],
      })
    }
    d.setDate(d.getDate() + stepDays)
  }
}

// Buys (capital deployed) — periodic accumulation into the margin account.
const buySymbols = ['QDTE', 'QQQY', 'NVDY', 'TSLY', 'MSTY', 'ULTY', 'YMAX', 'PLTY', 'DEFI', 'JEPQ']
{
  const d = new Date(start)
  while (d < today) {
    const n = Math.round(rand(1, 3))
    for (let i = 0; i < n; i++) {
      const sym = pick(buySymbols)
      const def = bySymbol.get(sym)!
      const units = Math.round(rand(20, 220))
      const amount = -+(units * def.price * rand(0.9, 1.05)).toFixed(2)
      transactions.push({
        id: `txn_${tid++}`,
        accountId: pick(['acc_margin', 'acc_margin', 'acc_joint']),
        date: iso(d),
        type: 'Buy',
        symbol: sym,
        description: `Bought ${units} ${sym}`,
        amount,
        units,
        fee: 0,
        tags: [],
      })
    }
    d.setDate(d.getDate() + Math.round(rand(9, 16)))
  }
}

// A few sells with realized P/L.
{
  const d = new Date(start)
  d.setDate(d.getDate() + 40)
  while (d < today) {
    const sym = pick(buySymbols)
    const def = bySymbol.get(sym)!
    const units = Math.round(rand(20, 150))
    const proceeds = +(units * def.price * rand(0.95, 1.1)).toFixed(2)
    transactions.push({
      id: `txn_${tid++}`,
      accountId: 'acc_margin',
      date: iso(d),
      type: 'Sell',
      symbol: sym,
      description: `Sold ${units} ${sym}`,
      amount: proceeds,
      units: -units,
      fee: 0,
      pl: +(proceeds * rand(-0.08, 0.12)).toFixed(2),
      tags: [],
    })
    d.setDate(d.getDate() + Math.round(rand(25, 55)))
  }
}

// Monthly contributions.
{
  const d = new Date(start)
  d.setDate(2)
  while (d < today) {
    const amt = +rand(2500, 4200).toFixed(2)
    transactions.push({
      id: `txn_${tid++}`,
      accountId: pick(['acc_margin', 'acc_joint', 'acc_roth']),
      date: iso(d),
      type: 'Contribution',
      description: 'ACH Deposit — Payroll',
      amount: amt,
      units: 0,
      tags: ['contribution'],
    })
    d.setMonth(d.getMonth() + 1)
  }
}

// Bill payments (SoFi/BestEgg style loan payments) & occasional withdrawal + interest.
const billPayees = ['Best Egg PAYMENT', 'SoFi Loan PAYMENT', 'Marcus Loan PAYMENT']
{
  const d = new Date(start)
  d.setDate(15)
  while (d < today) {
    transactions.push({
      id: `txn_${tid++}`,
      accountId: 'acc_margin',
      date: iso(d),
      type: 'Bill Payment',
      symbol: 'SCHFDX0',
      description: pick(billPayees),
      amount: -+rand(420, 920).toFixed(2),
      units: 0,
      tags: ['bill'],
    })
    if (rnd() > 0.6) {
      transactions.push({
        id: `txn_${tid++}`,
        accountId: pick(['acc_margin', 'acc_joint']),
        date: iso(d),
        type: 'Withdrawal',
        description: 'Cash withdrawal to bank',
        amount: -+rand(300, 1500).toFixed(2),
        units: 0,
        tags: [],
      })
    }
    // Margin interest
    transactions.push({
      id: `txn_${tid++}`,
      accountId: 'acc_margin',
      date: iso(d),
      type: 'Interest',
      description: 'Margin interest charged',
      amount: -+rand(60, 130).toFixed(2),
      units: 0,
      tags: ['margin'],
    })
    d.setMonth(d.getMonth() + 1)
  }
}

// Some "Other" crypto ETF flow lines like the source app showed (DEFI $0.00 / income).
{
  const d = new Date(today)
  for (let i = 0; i < 20; i++) {
    d.setDate(d.getDate() - Math.round(rand(1, 4)))
    const zero = rnd() > 0.5
    transactions.push({
      id: `txn_${tid++}`,
      accountId: 'acc_margin',
      date: iso(d),
      type: 'Other',
      symbol: 'DEFI',
      description: 'HASHDEX BITCOIN ETF',
      amount: zero ? 0 : +rand(5, 120).toFixed(2),
      units: zero ? -1 : 0,
      tags: [],
    })
  }
}

transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

const nowMinus = (mins: number) => isoDT(new Date(today.getTime() - mins * 60000))

const connections: Connection[] = [
  {
    id: 'conn_schwab',
    broker: 'Schwab',
    status: 'Active',
    accountIds: accounts.map((a) => a.id),
    lastSynced: nowMinus(8),
    events: [
      { at: nowMinus(8), kind: 'sync', message: 'Synced 3 accounts · 167 positions · 41 new transactions' },
      { at: nowMinus(120), kind: 'sync', message: 'Scheduled sync completed' },
      { at: nowMinus(1440), kind: 'refresh', message: 'Holdings refreshed' },
      { at: nowMinus(4320), kind: 'connect', message: 'Connection established with Schwab' },
    ],
  },
]

// Synthesize a plausible weekly value series so the sample dataset shows a
// realistic time-weighted return before any live sync. Reconstructs backward
// from current equity value, baking out the real sample external flows so the
// client's TWR math recovers the intended weekly returns.
function buildSampleTwr(): TwrSeries {
  const rng = mulberry32(99)
  const extType = new Set<TxnType>(['Contribution', 'Withdrawal', 'Bill Payment'])
  const osi = /\d{6}[CP]\d{8}$/
  const isOpt = (s?: string) => !!s && osi.test((s || '').replace(/\s+/g, ''))
  const flowOf = (t: Transaction) =>
    extType.has(t.type) || ((t.type === 'Buy' || t.type === 'Sell') && isOpt(t.symbol))
      ? t.amount
      : 0

  const weeks = 53
  const byAccount: Record<string, { date: string; value: number }[]> = {}
  const combined = new Map<string, number>()

  // Week-end dates, oldest → today.
  const dates: string[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const d = new Date(today)
    d.setDate(d.getDate() - w * 7)
    dates.push(d.toISOString().slice(0, 10))
  }

  for (const acc of accounts) {
    const accTxns = transactions.filter((t) => t.accountId === acc.id)
    const curEquity =
      positions
        .filter((p) => p.accountId === acc.id && !p.isOption)
        .reduce((s, p) => s + p.shares * p.lastPrice, 0) + acc.cash
    const totalFlow = accTxns.reduce((s, t) => s + flowOf(t), 0)
    // Reconstruct FORWARD so the series can never collapse to a clamp: begin at a
    // plausible base, then apply weekly returns and the real weekly flows. The
    // client's TWR math recovers the intended returns because flows are baked in.
    let v = Math.max(curEquity - totalFlow, curEquity * 0.5, 5000)
    const pts: { date: string; value: number }[] = [{ date: dates[0], value: +v.toFixed(2) }]
    for (let i = 1; i < dates.length; i++) {
      let flow = 0
      for (const t of accTxns) if (t.date > dates[i - 1] && t.date <= dates[i]) flow += flowOf(t)
      const r = 0.0018 + (rng() - 0.5) * 0.03 // ~9%/yr drift with weekly noise
      v = Math.max(v * (1 + r) + flow, 1)
      pts.push({ date: dates[i], value: +v.toFixed(2) })
    }
    byAccount[acc.id] = pts
    for (const p of pts) combined.set(p.date, (combined.get(p.date) ?? 0) + p.value)
  }

  const all = [...combined.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, value]) => ({ date, value: +value.toFixed(2) }))
  return {
    byAccount,
    all,
    generatedAt: isoDT(today),
    note: 'Sample data — synthetic value path for demonstration.',
  }
}

export function buildSeed(): AppData {
  return {
    version: 1,
    accounts,
    positions,
    transactions,
    connections,
    lastSyncAt: nowMinus(120),
    source: 'sample',
    keepList: DEFAULT_KEEP,
    soldSymbols: [],
    tagRules: [],
    twr: buildSampleTwr(),
  }
}

export const TXN_TYPES: TxnType[] = [
  'Buy',
  'Sell',
  'Dividend',
  'Interest',
  'Contribution',
  'Withdrawal',
  'Bill Payment',
  'Transfer',
  'Fee',
  'Other',
]
