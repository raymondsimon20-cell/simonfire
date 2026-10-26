import type { Account, Position, Transaction } from './types'
import { dividendStats } from './calc'
import { normTicker } from './plan'
import type { FireStart } from './fire-model'

// Reconcile the model opening balance to the same broker equity used by Today.
// Options, shorts and balance adjustments retain their current marked value,
// but never generate dividend income or fabricated cash available to spend.
export function firePortfolio(accounts: Account[], positions: Position[], transactions: Transaction[], scope: string, dripKeys: string[], today: string) {
  const selected = accounts.filter((a) => (scope === 'all' || a.id === scope) && !/IRA/.test(a.type))
  const ids = new Set(selected.map((a) => a.id))
  const scoped = positions.filter((p) => ids.has(p.accountId))
  const long = scoped.filter((p) => !p.isOption && p.shares > 0)
  const stats = dividendStats(long, transactions.filter((t) => ids.has(t.accountId)), today)
  const rows = new Map<string, { key: string; symbol: string; name: string; account: string; shares: number; price: number; value: number; income: number; drip: boolean; estimated: boolean; role: 'income' | 'static' }>()
  for (const p of scoped) {
    const a = selected.find((a) => a.id === p.accountId)!
    const symbol = normTicker(p.symbol)
    const role = !p.isOption && p.shares > 0 ? 'income' : 'static'
    const key = `${a.mask}|${symbol}${role === 'static' ? `|${p.id}` : ''}`
    const symbolShares = long.filter((r) => normTicker(r.symbol) === symbol).reduce((sum, r) => sum + r.shares, 0)
    const stat = stats.bySymbol.find((r) => r.symbol === symbol)
    const reported = long.filter((r) => normTicker(r.symbol) === symbol && r.annualDividend != null && r.annualDividend > 0)
    const forwardRate = p.annualDividend != null && p.annualDividend > 0 ? p.annualDividend : reported.length ? reported.reduce((sum, r) => sum + r.shares * r.annualDividend!, 0) / reported.reduce((sum, r) => sum + r.shares, 0) : undefined
    const forward = forwardRate != null
    const income = role === 'static' ? 0 : forward ? forwardRate! * p.shares : (stat?.projAnnual ?? 0) * p.shares / Math.max(1, symbolShares)
    const row = rows.get(key) ?? { key, symbol, name: p.name, account: a.name, shares: 0, price: p.lastPrice, value: 0, income: 0, drip: dripKeys.includes(key) && role === 'income', estimated: false, role }
    row.shares += p.shares; row.value += p.shares * p.lastPrice; row.income += income
    if (row.shares !== 0) row.price = row.value / row.shares
    row.estimated ||= role === 'income' && !forward
    rows.set(key, row)
  }
  const holdings = [...rows.values()].sort((a, b) => b.value - a.value)
  const holdingsValue = scoped.reduce((sum, p) => sum + p.shares * p.lastPrice, 0)
  const actualDebt = selected.reduce((sum, a) => sum + a.marginBalance, 0)
  const actualCash = selected.reduce((sum, a) => sum + a.cash, 0)
  const actualNet = selected.reduce((sum, a) => sum + (a.equity != null && Number.isFinite(a.equity) ? a.equity : scoped.filter((p) => p.accountId === a.id).reduce((n, p) => n + p.shares * p.lastPrice, 0) + a.cash - a.marginBalance), 0)
  const actualGross = actualNet + actualDebt
  const dripValue = holdings.filter((h) => h.drip).reduce((sum, h) => sum + h.value, 0)
  const cashValue = holdings.filter((h) => h.role === 'income' && !h.drip).reduce((sum, h) => sum + h.value, 0)
  const cash = selected.reduce((sum, a) => sum + Math.max(0, a.cash), 0)
  const start: FireStart = { dripValue, cashValue, cash, otherValue: actualGross - dripValue - cashValue - cash, debt: actualDebt,
    dripYieldPct: dripValue > 0 ? holdings.filter((h) => h.drip).reduce((sum, h) => sum + h.income, 0) / dripValue * 100 : 0,
    cashYieldPct: cashValue > 0 ? holdings.filter((h) => h.role === 'income' && !h.drip).reduce((sum, h) => sum + h.income, 0) / cashValue * 100 : 0 }
  return { accounts: selected, holdings, start, actualGross, actualNet, actualDebt, actualCash, holdingsValue,
    balanceAdjustment: actualGross - holdingsValue - actualCash,
    brokerEquityCount: selected.filter((a) => a.equity != null && Number.isFinite(a.equity)).length }
}
