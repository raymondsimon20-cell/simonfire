import { brokerageDate, monthEndDate, previousMonth } from './balance-snapshots'
import { coverageGap, internalTransferIds, statementAccount, type StatementMonth } from './statement-history'
import type { Account, HistoricalBalance, Transaction } from './types'

export interface EquityGrowth {
  value: number | null
  reason: string
  from: string
  to: string
  beginning: number
  ending: number
  deposits: number
  internalDeposits: number
  outsideContributions: number
  estimated: boolean
  notes: string[]
  months: { month: string; deposits: number; internalDeposits: number; value: number }[]
}

// Equity already includes spending, withholding, fees, interest and unrealized
// changes. Subtract ONLY outside funding; adding withdrawals back would measure
// investment performance instead of progress after funding the household.
export function equityGrowth(rows: StatementMonth[], transactions: Transaction[], accounts: Account[], fromMonth = '', today = brokerageDate()): EquityGrowth {
  const window = rows.filter((r) => r.month >= fromMonth && r.month <= today.slice(0, 7)).sort((a, b) => a.month.localeCompare(b.month))
  const first = window[0]
  const last = window.at(-1)
  // Date-only observations already express the brokerage day. Legacy records
  // can contain a UTC timestamp; convert those instead of truncating them.
  const endDate = (row: Pick<HistoricalBalance, 'asOf' | 'month'>) => !row.asOf ? monthEndDate(row.month)
    : /^\d{4}-\d{2}-\d{2}$/.test(row.asOf) ? row.asOf : brokerageDate(row.asOf)
  const result: EquityGrowth = { value: null, reason: '', from: first ? `${first.month}-01` : '', to: last ? endDate(last) : '', beginning: first?.openingEquity ?? 0, ending: last?.closingEquity ?? 0, deposits: 0, internalDeposits: 0, outsideContributions: 0, estimated: false, notes: [], months: [] }
  const unavailable = (reason: string) => ({ ...result, reason })
  if (!first || !last) return unavailable('Import statements or sync balances to establish equity and funding for this period.')
  for (let i = 0; i < window.length; i++) {
    const row = window[i]
    if (!row.complete || row.openingEquity == null) return unavailable(`${row.month}: ${coverageGap(row) || 'Account balances are incomplete.'}`)
    if (row.flowsAvailable === false) return unavailable(`${row.month}: deposit history is unavailable. Sync or import this month’s statement.`)
    if (![row.openingEquity, row.closingEquity, row.deposits].every(Number.isFinite) || row.deposits < 0) return unavailable(`${row.month}: review the recorded balances and deposits.`)
    const dates = new Set(row.statements.map(endDate))
    if (dates.size > 1) return unavailable(`${row.month}: account balances cover different reporting dates (${row.statements.map((s) => `${statementAccount(s, accounts)?.name ?? `····${s.accountMask}`}: ${endDate(s)}`).join('; ')}). Sync all selected accounts together.`)
    if (endDate(row) > today) return unavailable(`${row.month}: the recorded balance date ${endDate(row)} is ahead of today’s brokerage date ${today}. Check your device clock and saved balance dates.`)
    const prior = window[i - 1]
    if (prior && (previousMonth(row.month) !== prior.month || endDate(prior) !== monthEndDate(prior.month))) return unavailable(`History is incomplete before ${row.month}. Import the intervening month-end statements.`)
    if (prior && Math.abs(row.openingEquity - prior.closingEquity) > .02) return unavailable(`${row.month}: opening equity does not match the previous close. Review account coverage and imported balances.`)
  }
  const selectedAccounts = new Set(window.flatMap((r) => r.statements.map((s) => statementAccount(s, accounts)?.id)).filter((id): id is string => !!id))
  const txns = transactions.filter((t) => selectedAccounts.has(t.accountId) && t.date >= result.from && t.date <= result.to)
  // Match within the measured span: an in-flight transfer crossing an endpoint
  // cannot be removed safely from that endpoint's recorded equity.
  const internal = internalTransferIds(txns)
  let incompleteDeposits = false
  for (const row of window) {
    let internalDeposits = 0
    for (const statement of row.statements) {
      const account = statementAccount(statement, accounts)
      const deposits = txns.filter((t) => t.accountId === account?.id && t.date.slice(0, 7) === row.month && t.type === 'Contribution')
      const matched = deposits.filter((t) => internal.has(t.id)).reduce((n, t) => n + t.amount, 0)
      if (matched > statement.deposits + .01) return unavailable(`${row.month}: matched transfers exceed recorded deposits. Review the statement and transaction classifications.`)
      internalDeposits += matched
      if (selectedAccounts.size > 1 && Math.abs(deposits.reduce((n, t) => n + t.amount, 0) - statement.deposits) > .01) incompleteDeposits = true
    }
    result.deposits += row.deposits
    result.internalDeposits += internalDeposits
    result.months.push({ month: row.month, deposits: row.deposits, internalDeposits, value: row.closingEquity - row.openingEquity! - row.deposits + internalDeposits })
  }
  const review = txns.some((t) => (t.type === 'Other' && (t.amount !== 0 || t.units !== 0)) || (t.type === 'Transfer' && !/\bTYPE ?[12]\b/i.test(t.description)))
  const snapshots = window.some((r) => r.statements.some((s) => s.source === 'Automatic snapshot'))
  result.outsideContributions = result.deposits - result.internalDeposits
  result.value = result.ending - result.beginning - result.outsideContributions
  result.estimated = snapshots || incompleteDeposits || review || result.internalDeposits > 0
  if (snapshots) result.notes.push('Includes saved API balances and recorded cash flows; statements take precedence when imported.')
  if (incompleteDeposits) result.notes.push('Deposit details are incomplete. Unmatched deposits count as outside funding; missing internal transfers may understate this result.')
  if (review) result.notes.push('Transfers or unclassified activity need review and may change outside funding.')
  if (result.internalDeposits > 0) result.notes.push('Internal transfers are estimated by matching equal withdrawals and deposits across selected accounts within four days.')
  return result
}
