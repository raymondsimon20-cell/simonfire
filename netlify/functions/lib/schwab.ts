// Shared Schwab Trader API helpers for the Netlify Functions.
// Server-side only. Secrets come from env; OAuth tokens are stored in Netlify Blobs.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getStore } from '@netlify/blobs'
import { classifySchwabTransaction } from '../../../src/lib/transaction-classification'

const TOKEN_URL = 'https://api.schwabapi.com/v1/oauth/token'
const AUTH_URL = 'https://api.schwabapi.com/v1/oauth/authorize'
const API_BASE = 'https://api.schwabapi.com/trader/v1'
const MARKET_BASE = 'https://api.schwabapi.com/marketdata/v1'

export function env() {
  return {
    appKey: process.env.SCHWAB_APP_KEY,
    appSecret: process.env.SCHWAB_APP_SECRET,
    // The callback URL registered on developer.schwab.com — must match exactly.
    callback: process.env.SCHWAB_CALLBACK_URL,
    // Where to send the browser after a successful connect (defaults to /connections).
    appUrl: process.env.APP_URL || '',
  }
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function basicAuth() {
  const { appKey, appSecret } = env()
  return 'Basic ' + Buffer.from(`${appKey}:${appSecret}`).toString('base64')
}

interface TokenBundle {
  access_token: string
  refresh_token: string
  expires_at: number // ms epoch when the access token expires
  refresh_saved_at: number // ms epoch when refresh token was issued (7-day life)
}

const store = () => getStore('schwab')

export async function readTokens(): Promise<TokenBundle | null> {
  try {
    return (await store().get('tokens', { type: 'json' })) as TokenBundle | null
  } catch {
    return null
  }
}

async function writeTokens(t: TokenBundle) {
  await store().setJSON('tokens', t)
}

export async function clearTokens() {
  try {
    await store().delete('tokens')
  } catch {
    /* ignore */
  }
}

export function authorizeUrl() {
  const { appKey, callback } = env()
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: appKey || '',
    redirect_uri: callback || '',
  })
  return `${AUTH_URL}?${p.toString()}`
}

// Exchange an authorization code (from the OAuth redirect) for tokens.
export async function exchangeCode(code: string): Promise<TokenBundle> {
  const { callback } = env()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callback || '',
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`)
  const data: any = await res.json()
  const now = Date.now()
  const bundle: TokenBundle = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: now + (data.expires_in ?? 1800) * 1000 - 30_000,
    refresh_saved_at: now,
  }
  await writeTokens(bundle)
  return bundle
}

async function refresh(t: TokenBundle): Promise<TokenBundle> {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`)
  const data: any = await res.json()
  const now = Date.now()
  const bundle: TokenBundle = {
    access_token: data.access_token,
    // Schwab returns a fresh refresh_token on refresh; fall back to the old one if absent.
    refresh_token: data.refresh_token ?? t.refresh_token,
    expires_at: now + (data.expires_in ?? 1800) * 1000 - 30_000,
    refresh_saved_at: data.refresh_token ? now : t.refresh_saved_at,
  }
  await writeTokens(bundle)
  return bundle
}

// Returns a valid access token, refreshing if needed. Throws if not connected /
// the refresh token has expired (needs a fresh OAuth connect).
export async function accessToken(): Promise<string> {
  let t = await readTokens()
  if (!t) throw new Error('NOT_CONNECTED')
  // Refresh tokens live ~7 days.
  if (Date.now() - t.refresh_saved_at > 7 * 24 * 3600 * 1000) throw new Error('REFRESH_EXPIRED')
  if (Date.now() >= t.expires_at) t = await refresh(t)
  return t.access_token
}

async function api(path: string, token: string): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Schwab API ${path} failed (${res.status}): ${await res.text()}`)
  return res.json()
}

// Resolve the app's stable account id (acc_ followed by the last four digits)
// to Schwab's encrypted account hash. Never expose or accept the hash in the UI.
// If two accounts share the same last four digits, fail closed.
export async function accountHash(accountId: string, token: string): Promise<string> {
  const match = /^acc_(\d{4})$/.exec(String(accountId))
  if (!match) throw new Error('INVALID_ACCOUNT')

  const hashList: any[] = await api('/accounts/accountNumbers', token)
  const matches = hashList.filter(
    (entry) => String(entry.accountNumber ?? '').replace(/\D/g, '').slice(-4) === match[1],
  )
  if (matches.length === 0) throw new Error('ACCOUNT_NOT_FOUND')
  if (matches.length > 1) throw new Error('AMBIGUOUS_ACCOUNT')

  const hash = String(matches[0].hashValue ?? '')
  if (!hash) throw new Error('ACCOUNT_NOT_FOUND')
  return hash
}

// ---- Data fetch + mapping to the app's model ----
const num = (v: any): number => (typeof v === 'number' ? v : parseFloat(v)) || 0

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${MON[+m - 1]} ${+d}, ${y}`
}

// Parse an option instrument into underlying/type/strike/expiration. Handles the
// OSI symbol (root + YYMMDD + C/P + strike×1000), falling back to Schwab fields.
function parseOption(inst: any) {
  const raw = String(inst.symbol ?? '')
  const noSpace = raw.replace(/\s+/g, '')
  const putCall = String(inst.putCall ?? '').toUpperCase()
  let optionType: 'Put' | 'Call' | undefined =
    putCall === 'PUT' ? 'Put' : putCall === 'CALL' ? 'Call' : undefined
  let strike: number | undefined
  let expiration: string | undefined
  let underlying = String(inst.underlyingSymbol ?? '').trim()
  if (noSpace.length >= 15 && /^\d{6}[CP]\d{8}$/.test(noSpace.slice(-15))) {
    const tail = noSpace.slice(-15)
    if (!underlying) underlying = noSpace.slice(0, -15)
    expiration = `20${tail.slice(0, 2)}-${tail.slice(2, 4)}-${tail.slice(4, 6)}`
    if (!optionType) optionType = tail[6] === 'P' ? 'Put' : 'Call'
    strike = parseInt(tail.slice(7), 10) / 1000
  }
  if (!underlying) underlying = raw.split(/\s+/)[0] || raw
  const label = [
    optionType ?? 'Option',
    strike != null ? `$${strike}` : '',
    expiration ? fmtDate(expiration) : '',
  ]
    .filter(Boolean)
    .join(' ')
  return { optionType, strike, expiration, underlying, label }
}

// ---- Price history + time-weighted-return value series ----
const OSI_RE = /\d{6}[CP]\d{8}$/
function isOptionSymbol(sym?: string) {
  return !!sym && OSI_RE.test(String(sym).replace(/\s+/g, ''))
}

async function fetchDividendFundamentals(symbols: string[], token: string) {
  const result = new Map<string, { annualDividend?: number; indicatedYield?: number; lastDividend?: number; dividendPayDate?: string }>()
  for (let offset = 0; offset < symbols.length; offset += 200) {
    const batch = symbols.slice(offset, offset + 200)
    if (!batch.length) continue
    const params = new URLSearchParams({ symbols: batch.join(','), fields: 'fundamental' })
    try {
      const res = await fetch(`${MARKET_BASE}/quotes?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      if (!res.ok) continue
      const quotes: any = await res.json()
      for (const symbol of batch) {
        const quote = quotes[symbol] ?? quotes[symbol.toUpperCase()]
        const f = quote?.fundamental
        if (!f) continue
        const annualDividend = num(f.divAmount)
        const indicatedYieldPct = num(f.divYield)
        const lastDividend = num(f.divPayAmount)
        const rawPayDate = String(f.divPayDate ?? '')
        result.set(symbol, {
          annualDividend: annualDividend > 0 ? annualDividend : undefined,
          indicatedYield: indicatedYieldPct > 0 ? indicatedYieldPct / 100 : undefined,
          lastDividend: lastDividend > 0 ? lastDividend : undefined,
          dividendPayDate: /^\d{4}-\d{2}-\d{2}/.test(rawPayDate) ? rawPayDate.slice(0, 10) : undefined,
        })
      }
    } catch {
      // Fundamentals improve estimates but must never prevent account sync.
    }
  }
  return result
}

// Daily closing prices for one symbol over [startMs, endMs]. Returns date→close.
async function fetchDailyCloses(
  symbol: string,
  token: string,
  startMs: number,
  endMs: number,
): Promise<Map<string, number>> {
  const p = new URLSearchParams({
    symbol,
    periodType: 'year',
    frequencyType: 'daily',
    frequency: '1',
    startDate: String(startMs),
    endDate: String(endMs),
    needExtendedHoursData: 'false',
    needPreviousClose: 'false',
  })
  try {
    const res = await fetch(`${MARKET_BASE}/pricehistory?${p.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) return new Map()
    const data: any = await res.json()
    const m = new Map<string, number>()
    for (const c of data.candles ?? []) {
      const d = new Date(c.datetime).toISOString().slice(0, 10)
      if (typeof c.close === 'number') m.set(d, c.close)
    }
    return m
  } catch {
    return new Map()
  }
}

// Reconstruct a daily portfolio-value series (equity/ETF market value + cash),
// backward from the known current state, for each account and combined. Options
// are excluded from the securities valuation (no reliable historical option
// pricing via the API); their premium cash is neutralised client-side as an
// external flow, so it never fabricates return.
async function buildTwrSeries(
  accounts: any[],
  positions: any[],
  transactions: any[],
  token: string,
  start: Date,
  end: Date,
): Promise<any> {
  const startISO = start.toISOString().slice(0, 10)
  const todayISO = end.toISOString().slice(0, 10)

  // Equity/ETF symbols needing price history (current holdings + traded in window).
  const equitySyms = new Set<string>()
  for (const p of positions) if (!p.isOption && p.symbol) equitySyms.add(p.symbol)
  for (const t of transactions)
    if ((t.type === 'Buy' || t.type === 'Sell') && t.symbol && !isOptionSymbol(t.symbol))
      equitySyms.add(t.symbol)

  const syms = [...equitySyms].slice(0, 80)
  const closeBySym = new Map<string, Map<string, number>>()
  await Promise.all(
    syms.map(async (s) => {
      closeBySym.set(s, await fetchDailyCloses(s, token, start.getTime(), end.getTime()))
    }),
  )
  const sortedDates = new Map<string, string[]>()
  for (const [s, m] of closeBySym) sortedDates.set(s, [...m.keys()].sort())
  const closeAsOf = (sym: string, d: string): number | undefined => {
    const m = closeBySym.get(sym)
    if (!m || !m.size) return undefined
    if (m.has(d)) return m.get(d)
    const ds = sortedDates.get(sym)!
    let lo = 0
    let hi = ds.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (ds[mid] <= d) {
        ans = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return ans >= 0 ? m.get(ds[ans]) : undefined
  }

  // Union date axis: every close date + every transaction date, clamped to window.
  const dateSet = new Set<string>([startISO, todayISO])
  for (const m of closeBySym.values())
    for (const d of m.keys()) if (d >= startISO && d <= todayISO) dateSet.add(d)
  for (const t of transactions) if (t.date >= startISO && t.date <= todayISO) dateSet.add(t.date)
  const dates = [...dateSet].sort()

  const byAccount: Record<string, { date: string; value: number }[]> = {}
  const combined = new Map<string, number>()

  for (const acc of accounts) {
    const accTxns = transactions
      .filter((t) => t.accountId === acc.id)
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    const cashNow = acc.cash || 0

    // Current equity shares + last price per symbol (for the exact "today" anchor).
    const sharesNow = new Map<string, number>()
    const lastPx = new Map<string, number>()
    const symUniverse = new Set<string>()
    for (const p of positions) {
      if (p.accountId !== acc.id || p.isOption || !p.symbol) continue
      sharesNow.set(p.symbol, (sharesNow.get(p.symbol) ?? 0) + p.shares)
      lastPx.set(p.symbol, p.lastPrice)
      symUniverse.add(p.symbol)
    }
    for (const t of accTxns)
      if ((t.type === 'Buy' || t.type === 'Sell') && t.symbol && !isOptionSymbol(t.symbol))
        symUniverse.add(t.symbol)

    const series: { date: string; value: number }[] = []
    for (const d of dates) {
      // Cash and post-date share movements reconstructed from txns after day d.
      let cashAfter = 0
      const unitsAfter = new Map<string, number>()
      for (const t of accTxns) {
        if (t.date <= d) continue
        cashAfter += t.amount
        if ((t.type === 'Buy' || t.type === 'Sell') && t.symbol && !isOptionSymbol(t.symbol))
          unitsAfter.set(t.symbol, (unitsAfter.get(t.symbol) ?? 0) + (t.units || 0))
      }
      const cashD = cashNow - cashAfter
      let secD = 0
      const isToday = d === todayISO
      for (const sym of symUniverse) {
        const sh = (sharesNow.get(sym) ?? 0) - (unitsAfter.get(sym) ?? 0)
        if (Math.abs(sh) < 1e-9) continue
        const px = isToday ? (lastPx.get(sym) ?? closeAsOf(sym, d)) : closeAsOf(sym, d)
        secD += sh * (px ?? 0)
      }
      const value = cashD + secD
      series.push({ date: d, value })
      combined.set(d, (combined.get(d) ?? 0) + value)
    }
    byAccount[acc.id] = series
  }

  const all = dates.map((d) => ({ date: d, value: combined.get(d) ?? 0 }))
  const twr = {
    byAccount,
    all,
    generatedAt: new Date().toISOString(),
    note:
      'Time-weighted return covers your equity/ETF holdings, their dividends, and cash. ' +
      'Option premium is neutralised (historical option prices are unavailable), so option P/L is not marked to market here.',
  }

  // ---- Moving-average insights for current holdings (reuse fetched closes) ----
  // SMA-N = mean of the most recent N daily closes (null if fewer than N exist).
  const lastPxBySym = new Map<string, number>()
  for (const p of positions)
    if (!p.isOption && p.symbol && p.shares) lastPxBySym.set(p.symbol, p.lastPrice)
  const smaOf = (closes: number[], n: number): number | null => {
    if (closes.length < n) return null
    const slice = closes.slice(closes.length - n)
    return slice.reduce((s, c) => s + c, 0) / n
  }
  const insightsBySymbol: Record<string, any> = {}
  for (const [sym, px] of lastPxBySym) {
    const m = closeBySym.get(sym)
    if (!m || !m.size) continue
    const closes = (sortedDates.get(sym) ?? []).map((d) => m.get(d)!).filter((v) => typeof v === 'number')
    if (!closes.length) continue
    insightsBySymbol[sym] = {
      symbol: sym,
      price: px || closes[closes.length - 1],
      sma50: smaOf(closes, 50),
      sma100: smaOf(closes, 100),
      sma200: smaOf(closes, 200),
      history: closes.length,
    }
  }
  const insights = { bySymbol: insightsBySymbol, generatedAt: new Date().toISOString() }

  return { twr, insights }
}

export async function fetchPortfolio(token: string) {
  const accountsRaw: any[] = await api('/accounts?fields=positions', token)
  const hashList: any[] = await api('/accounts/accountNumbers', token).catch(() => [])
  const hashByNumber = new Map<string, string>()
  for (const h of hashList) hashByNumber.set(String(h.accountNumber), String(h.hashValue))

  const accounts: any[] = []
  const positions: any[] = []
  const transactions: any[] = []

  // 12 months of transactions
  const end = new Date()
  const start = new Date()
  start.setFullYear(start.getFullYear() - 1)
  const iso = (d: Date) => d.toISOString().slice(0, 19) + 'Z'

  for (const entry of accountsRaw) {
    const sa = entry.securitiesAccount ?? entry
    const number = String(sa.accountNumber ?? '')
    const isMargin = String(sa.type ?? '').toUpperCase() === 'MARGIN'
    const bal = sa.currentBalances ?? {}
    const cash = num(bal.cashBalance ?? bal.availableFunds)
    // Schwab balance payloads have represented margin debt with either sign
    // depending on the account/balance view. The domain model always stores
    // outstanding debt as a positive magnitude so current usage is never
    // accidentally treated as zero when calculating remaining capacity.
    const marginBalance = Math.abs(num(bal.marginBalance))
    const mask = number.replace(/\D/g, '').slice(-4)
    const accId = 'acc_' + (mask || Math.random().toString(36).slice(2, 8))
    // Extra balance fields Schwab reports — power the account-detail KPIs.
    const equity = num(bal.equity ?? bal.liquidationValue)
    const buyingPower = num(bal.buyingPower ?? bal.buyingPowerNonMarginableTrade)
    const sma = bal.sma == null ? undefined : Math.max(0, num(bal.sma))
    // Schwab reports "available to withdraw" separately from "available to trade".
    // cashAvailableForWithdrawal respects settled funds + margin maintenance (house
    // ~30%+); availableFunds is buying-power oriented. Prefer the withdrawal field.
    const availableFunds = num(
      bal.cashAvailableForWithdrawal ?? bal.availableFunds ?? bal.cashAvailableForTrading,
    )
    const longMarketValue = num(bal.longMarketValue)
    accounts.push({
      id: accId,
      broker: 'Schwab',
      name: isMargin ? `Margin ····${mask}` : `····${mask}`,
      fullName: `${sa.type ?? 'Account'} ····${mask}`,
      mask,
      type: isMargin ? 'Margin' : 'Individual',
      isMargin,
      cash,
      marginBalance,
      equity: equity || undefined,
      buyingPower: buyingPower || undefined,
      sma,
      availableFunds: availableFunds || undefined,
      longMarketValue: longMarketValue || undefined,
    })

    for (const p of sa.positions ?? []) {
      const inst = p.instrument ?? {}
      const qty = num(p.longQuantity) - num(p.shortQuantity)
      const marketValue = num(p.marketValue)
      // Options: Schwab's marketValue already includes the contract multiplier
      // (×100), so lastPrice = marketValue/qty is per-CONTRACT — but averagePrice
      // is per-SHARE premium. Scale avgCost by the same multiplier so cost basis
      // (qty × avgCost) matches value (qty × lastPrice) and the gain is correct.
      const isOption = String(inst.assetType ?? inst.type ?? '').toUpperCase() === 'OPTION'
      const mult = isOption ? num(inst.multiplier) || 100 : 1
      const lastPrice = qty ? marketValue / qty : num(inst.closePrice) * mult
      const dayPL = num(p.currentDayProfitLoss)
      const prevClose = qty ? (marketValue - dayPL) / qty : lastPrice
      const opt = isOption ? parseOption(inst) : null
      positions.push({
        id: 'pos_' + Math.random().toString(36).slice(2, 9),
        accountId: accId,
        symbol: opt?.underlying ?? String(inst.symbol ?? 'UNKNOWN'),
        name: opt ? opt.label : String(inst.description ?? inst.symbol ?? ''),
        shares: qty,
        avgCost: num(p.averagePrice) * mult,
        lastPrice,
        prevClose,
        dividendsReceived: 0,
        isOption,
        ...(opt
          ? { optionType: opt.optionType, strike: opt.strike, expiration: opt.expiration, underlying: opt.underlying }
          : {}),
      })
    }

    // Transactions for this account (by hashValue).
    const hash = hashByNumber.get(number)
    if (hash) {
      const txns: any[] = await api(
        `/accounts/${hash}/transactions?startDate=${encodeURIComponent(iso(start))}&endDate=${encodeURIComponent(iso(end))}`,
        token,
      ).catch(() => [])
      for (const t of txns) transactions.push(mapTxn(accId, t))
    }
  }

  // Schwab's income view is based on indicated/forward distributions rather
  // than cash received in the last year. Enrich equity positions with the same
  // security-level fundamentals when Market Data is available.
  const equitySymbols = [...new Set(positions.filter((p) => !p.isOption).map((p) => String(p.symbol).toUpperCase()).filter(Boolean))]
  const dividendFundamentals = await fetchDividendFundamentals(equitySymbols, token)
  for (const p of positions) {
    if (p.isOption) continue
    const fundamental = dividendFundamentals.get(String(p.symbol).toUpperCase())
    if (fundamental) Object.assign(p, fundamental)
  }

  // Dividend/interest transactions often carry only the cash leg, so the ticker
  // is missing. Recover it by matching the transaction description to a holding's
  // security name (e.g. "ROUNDHILL WEEKLY T-BILL ETF" -> WEEK).
  const norm = (s: string) => String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const nameToSym = new Map<string, string>()
  for (const p of positions) {
    const key = norm(p.name)
    if (key && !nameToSym.has(key)) nameToSym.set(key, p.symbol)
  }
  const nameEntries = [...nameToSym.entries()].sort((a, b) => b[0].length - a[0].length)
  const resolveSym = (description: string): string | undefined => {
    const d = norm(description)
    if (!d) return undefined
    if (nameToSym.has(d)) return nameToSym.get(d)
    for (const [name, sym] of nameEntries) {
      if (name.length >= 6 && (d.startsWith(name) || name.startsWith(d) || d.includes(name)))
        return sym
    }
    return undefined
  }
  for (const t of transactions) {
    if (!t.symbol && (t.type === 'Dividend' || t.type === 'Sell' || t.type === 'Corporate Action' || t.type === 'Other')) {
      const sym = resolveSym(t.description)
      if (sym) t.symbol = sym
    }
  }

  // Backfill lifetime dividends per position from transactions.
  const divBy = new Map<string, number>()
  for (const t of transactions)
    if (t.type === 'Dividend' && t.symbol) divBy.set(t.accountId + '|' + t.symbol, (divBy.get(t.accountId + '|' + t.symbol) ?? 0) + t.amount)
  for (const p of positions) p.dividendsReceived = +(divBy.get(p.accountId + '|' + p.symbol) ?? 0).toFixed(2)

  transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  // Build the daily value series (TWR) + moving-average insights. Never let a
  // pricing hiccup break the whole sync — these are bonus analytics.
  let twr: any = undefined
  let insights: any = undefined
  try {
    const analytics = await buildTwrSeries(accounts, positions, transactions, token, start, end)
    twr = analytics.twr
    insights = analytics.insights
  } catch {
    twr = undefined
  }

  return { accounts, positions, transactions, broker: 'Schwab', twr, insights }
}

// Map a Schwab transaction to the app's model.
function mapTxn(accountId: string, t: any) {
  const rawType = String(t.type ?? '').toUpperCase()
  const items: any[] = t.transferItems ?? []
  // Prefer the real security leg; Schwab puts the cash leg (CURRENCY_USD) in the
  // same transferItems array, so skip currency/cash instruments when picking a symbol.
  const isCurrency = (i: any) => {
    const at = String(i.instrument?.assetType ?? '').toUpperCase()
    const sym = String(i.instrument?.symbol ?? '').toUpperCase()
    return at === 'CURRENCY' || sym === 'CURRENCY_USD' || sym.startsWith('CURRENCY')
  }
  const security =
    items.find((i) => i.instrument?.symbol && !isCurrency(i)) ??
    items.find((i) => i.instrument?.symbol)
  let symbol: string | undefined = security?.instrument?.symbol
  if (symbol && (symbol.toUpperCase() === 'CURRENCY_USD' || symbol.toUpperCase().startsWith('CURRENCY')))
    symbol = undefined
  const amount = num(t.netAmount)
  // Only count share movement from a non-currency security leg.
  const units = security && !isCurrency(security) ? num(security.amount) : 0
  const desc = String(t.description ?? '').toUpperCase()
  const fee = items
    .filter((i) => i.feeType)
    .reduce((s, i) => s + Math.abs(num(i.cost ?? i.amount)), 0)

  const type = classifySchwabTransaction({ rawType, description: desc, amount, units })

  return {
    id: 'txn_' + Math.random().toString(36).slice(2, 9),
    accountId,
    date: String(t.tradeDate ?? t.time ?? '').slice(0, 10),
    type,
    symbol,
    description: String(t.description ?? rawType),
    amount,
    units: units || 0,
    fee: fee || undefined,
    tags: [],
    classificationSource: type === 'Other' ? 'schwab' : 'automatic',
  }
}

export { API_BASE }
