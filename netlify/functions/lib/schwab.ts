// Shared Schwab Trader API helpers for the Netlify Functions.
// Server-side only. Secrets come from env; OAuth tokens are stored in Netlify Blobs.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getStore } from '@netlify/blobs'

const TOKEN_URL = 'https://api.schwabapi.com/v1/oauth/token'
const AUTH_URL = 'https://api.schwabapi.com/v1/oauth/authorize'
const API_BASE = 'https://api.schwabapi.com/trader/v1'

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

// ---- Data fetch + mapping to the app's model ----
const num = (v: any): number => (typeof v === 'number' ? v : parseFloat(v)) || 0

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
    const marginBalance = Math.max(0, -num(bal.marginBalance)) // borrowed shown as positive magnitude
    const mask = number.replace(/\D/g, '').slice(-4)
    const accId = 'acc_' + (mask || Math.random().toString(36).slice(2, 8))
    // Extra balance fields Schwab reports — power the account-detail KPIs.
    const equity = num(bal.equity ?? bal.liquidationValue)
    const buyingPower = num(bal.buyingPower ?? bal.buyingPowerNonMarginableTrade)
    const availableFunds = num(bal.availableFunds ?? bal.cashAvailableForTrading ?? bal.availableFundsNonMarginableTrade)
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
      availableFunds: availableFunds || undefined,
      longMarketValue: longMarketValue || undefined,
    })

    for (const p of sa.positions ?? []) {
      const inst = p.instrument ?? {}
      const qty = num(p.longQuantity) - num(p.shortQuantity)
      const marketValue = num(p.marketValue)
      const lastPrice = qty ? marketValue / qty : num(inst.closePrice)
      const dayPL = num(p.currentDayProfitLoss)
      const prevClose = qty ? (marketValue - dayPL) / qty : lastPrice
      positions.push({
        id: 'pos_' + Math.random().toString(36).slice(2, 9),
        accountId: accId,
        symbol: String(inst.symbol ?? 'UNKNOWN'),
        name: String(inst.description ?? inst.symbol ?? ''),
        shares: qty,
        avgCost: num(p.averagePrice),
        lastPrice,
        prevClose,
        dividendsReceived: 0,
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
    if (!t.symbol && (t.type === 'Dividend' || t.type === 'Other')) {
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
  return { accounts, positions, transactions, broker: 'Schwab' }
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

  let type = 'Other'
  if (rawType === 'TRADE') type = units < 0 ? 'Sell' : 'Buy'
  else if (rawType.includes('DIVIDEND') || rawType.includes('INTEREST')) {
    // Schwab lumps dividends and interest under DIVIDEND_OR_INTEREST. Real interest
    // is almost always a margin/credit charge (negative); positive payments on a
    // fund are dividends.
    const looksInterest =
      amount < 0 || /MARGIN INTEREST|CREDIT INTEREST|BANK INTEREST|SCHWAB.*\bINT\b/.test(desc)
    type = looksInterest ? 'Interest' : 'Dividend'
  } else if (rawType === 'ACH_RECEIPT' || rawType === 'WIRE_IN' || rawType === 'CASH_RECEIPT')
    type = 'Contribution'
  else if (rawType === 'ACH_DISBURSEMENT' || rawType === 'WIRE_OUT' || rawType === 'CASH_DISBURSEMENT')
    type = 'Withdrawal'
  else if (rawType.includes('FEE')) type = 'Fee'
  if (type === 'Contribution' && amount < 0) type = 'Withdrawal'

  // A disbursement to a third party (a biller, loan, or card) is a Bill Payment,
  // not a cash withdrawal to yourself. Distinguish by the payee in the description.
  const looksBill = /\b(PAYMENT|PMT|BILLPAY|BILL PAY|BILL|CARD|CREDIT CARD|LOAN|MORTGAGE|AUTOPAY|BEST EGG|ACH DEBIT)\b/.test(desc)
  if (amount < 0 && (type === 'Withdrawal' || type === 'Other') && looksBill) type = 'Bill Payment'

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
  }
}

export { API_BASE }
