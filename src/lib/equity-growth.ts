import { brokerageDate, monthEndDate, previousMonth } from './balance-snapshots'
import { coverageGap, statementAccount, type StatementMonth } from './statement-history'
import type { Account, HistoricalBalance, Transaction } from './types'

export interface EquityGrowth {
  totalGrowth: number | null
  balanceEstimated: boolean
  // Secondary diagnostic: equity growth with outside contributions removed.
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
  balancesAvailable: boolean
  fundingNeedsReview: boolean
  provisionalValue: number | null
  funding: FundingAudit[]
  transferMatches: { incoming: Transaction; outgoing: Transaction }[]
  notes: string[]
  months: { month: string; deposits: number; internalDeposits: number; value: number; totalGrowth: number }[]
}

interface FundingAudit {
  accountId: string
  account: string
  month: string
  deposits: number
  ledgerDeposits: number
  withdrawals: number
  ledgerWithdrawals: number
  internalDeposits: number
  issues: string[]
  transactions: Transaction[]
}

const journal = (t: Transaction) => t.type === 'Transfer' && /\bTYPE ?[12]\b/i.test(t.description)

// Match only mutually unique cash legs. A classified bill is household spending,
// not transfer evidence. Keep ambiguous equal payments for review rather than
// letting transaction order decide which deposit to exclude.
function fundingTransfers(txns: Transaction[]) {
  const incoming = txns.filter((t) => !journal(t) && t.units === 0 && t.amount > 0 && ['Contribution', 'Transfer'].includes(t.type))
  const outgoing = txns.filter((t) => !journal(t) && t.units === 0 && t.amount < 0 && ['Withdrawal', 'Transfer'].includes(t.type))
  const matches = (a: Transaction, b: Transaction) => a.accountId !== b.accountId && Math.abs(a.amount + b.amount) < .01 && Math.abs(Date.parse(a.date) - Date.parse(b.date)) <= 4 * 86_400_000
  const candidates = new Map(incoming.map((t) => [t.id, outgoing.filter((out) => matches(t, out))]))
  const pairs: { incoming: Transaction; outgoing: Transaction }[] = []
  const ambiguous = new Set<string>()
  for (const deposit of incoming) {
    const options = candidates.get(deposit.id)!
    if (!options.length) continue
    if (options.length === 1 && incoming.filter((t) => matches(t, options[0])).length === 1) pairs.push({ incoming: deposit, outgoing: options[0] })
    else { ambiguous.add(deposit.id); options.forEach((t) => ambiguous.add(t.id)) }
  }
  return { pairs, ambiguous, ids: new Set(pairs.flatMap((p) => [p.incoming.id, p.outgoing.id])) }
}

// Accumulation progress is ending equity minus starting equity, including W-2
// contributions and all recorded spending. Equity already nets margin debt,
// withholding, fees, interest and unrealized changes. Removing outside funding
// is a separate diagnostic; funding gaps must not hide valid balance growth.
export function equityGrowth(rows: StatementMonth[], transactions: Transaction[], accounts: Account[], fromMonth = '', today = brokerageDate()): EquityGrowth {
  const window = rows.filter((r) => r.month >= fromMonth && r.month <= today.slice(0, 7)).sort((a, b) => a.month.localeCompare(b.month))
  const first = window[0]
  const last = window.at(-1)
  // Date-only observations already express the brokerage day. Legacy records
  // can contain a UTC timestamp; convert those instead of truncating them.
  const endDate = (row: Pick<HistoricalBalance, 'asOf' | 'month'>) => !row.asOf ? monthEndDate(row.month)
    : /^\d{4}-\d{2}-\d{2}$/.test(row.asOf) ? row.asOf : brokerageDate(row.asOf)
  const result: EquityGrowth = { totalGrowth: null, balanceEstimated: false, value: null, reason: '', from: first ? `${first.month}-01` : '', to: last ? endDate(last) : '', beginning: first?.openingEquity ?? 0, ending: last?.closingEquity ?? 0, deposits: 0, internalDeposits: 0, outsideContributions: 0, estimated: false, balancesAvailable: false, fundingNeedsReview: false, provisionalValue: null, funding: [], transferMatches: [], notes: [], months: [] }
  const unavailable = (reason: string) => ({ ...result, reason })
  if (!first || !last) return unavailable('Import statements or sync balances to establish equity and funding for this period.')
  for (let i = 0; i < window.length; i++) {
    const row = window[i]
    if (!row.complete || row.openingEquity == null) return unavailable(`${row.month}: ${coverageGap(row) || 'Account balances are incomplete.'}`)
    if (![row.openingEquity, row.closingEquity].every(Number.isFinite)) return unavailable(`${row.month}: review the recorded balances.`)
    const dates = new Set(row.statements.map(endDate))
    if (dates.size > 1) return unavailable(`${row.month}: account balances cover different reporting dates (${row.statements.map((s) => `${statementAccount(s, accounts)?.name ?? `····${s.accountMask}`}: ${endDate(s)}`).join('; ')}). Sync all selected accounts together.`)
    if (endDate(row) > today) return unavailable(`${row.month}: the recorded balance date ${endDate(row)} is ahead of today’s brokerage date ${today}. Check your device clock and saved balance dates.`)
    const prior = window[i - 1]
    if (prior && (previousMonth(row.month) !== prior.month || endDate(prior) !== monthEndDate(prior.month))) return unavailable(`History is incomplete before ${row.month}. Import the intervening month-end statements.`)
    if (prior && Math.abs(row.openingEquity - prior.closingEquity) > .02) return unavailable(`${row.month}: opening equity does not match the previous close. Review account coverage and imported balances.`)
  }
  result.balancesAvailable = true
  result.totalGrowth = result.ending - result.beginning
  result.balanceEstimated = window.some((r) => r.statements.some((s) => s.source === 'Automatic snapshot'))
  if (window.some((r) => ![r.deposits, r.withdrawals].every(Number.isFinite) || r.deposits < 0)) return { ...result, fundingNeedsReview: true, reason: 'Recorded funding totals need review. Total equity growth is still available from balances.' }
  const selectedAccounts = new Set(window.flatMap((r) => r.statements.map((s) => statementAccount(s, accounts)?.id)).filter((id): id is string => !!id))
  const txns = transactions.filter((t) => selectedAccounts.has(t.accountId) && t.date >= result.from && t.date <= result.to)
  // Match within the measured span: an in-flight transfer crossing an endpoint
  // cannot be removed safely from that endpoint's recorded equity.
  const internal = fundingTransfers(txns)
  result.transferMatches = internal.pairs
  for (const row of window) {
    let internalDeposits = 0
    for (const statement of row.statements) {
      const account = statementAccount(statement, accounts)
      const monthly = txns.filter((t) => t.accountId === account?.id && t.date.slice(0, 7) === row.month)
      const automatic = statement.source === 'Automatic snapshot'
      // Snapshots sum Contribution rows only; statements can include transfers
      // in their deposit/withdrawal totals. Never subtract an internal transfer
      // a second time if it was already excluded from snapshot funding.
      const deposits = monthly.filter((t) => t.type === 'Contribution' || (!automatic && t.type === 'Transfer' && !journal(t) && t.amount > 0))
      const outflows = monthly.filter((t) => ['Withdrawal', 'Bill Payment'].includes(t.type) || (!automatic && t.type === 'Transfer' && !journal(t) && t.amount < 0))
      const ledgerDeposits = deposits.reduce((n, t) => n + t.amount, 0)
      const ledgerWithdrawals = -outflows.reduce((n, t) => n + t.amount, 0)
      const proposed = deposits.filter((t) => internal.ids.has(t.id)).reduce((n, t) => n + t.amount, 0)
      const issues: string[] = []
      if (row.flowsAvailable === false || statement.flowsAvailable === false) issues.push('Funding history was unavailable at capture. Sync or import statement transactions.')
      if (selectedAccounts.size > 1 && Math.abs(ledgerDeposits - statement.deposits) > .01) issues.push('Deposit transactions do not reconcile to the recorded total.')
      if (selectedAccounts.size > 1 && Math.abs(ledgerWithdrawals + statement.withdrawals) > .01) issues.push('Withdrawal transactions do not reconcile; internal transfer matching may be incomplete.')
      if (proposed > statement.deposits + .01) issues.push('Matched transfers exceed recorded deposits. Check transaction classifications and repeated records.')
      const matched = proposed <= statement.deposits + .01 ? proposed : 0
      if (monthly.some((t) => internal.ambiguous.has(t.id))) issues.push('Multiple equal cash movements could be transfer matches. Review these records.')
      if (monthly.some((t) => t.type === 'Transfer' && !journal(t) && (t.amount !== 0 || t.units !== 0) && !internal.ids.has(t.id))) issues.push('Unmatched transfers need an outside-funding or internal-transfer classification.')
      if (monthly.some((t) => t.type === 'Other' && (t.amount !== 0 || t.units !== 0))) issues.push('Unclassified activity may change outside funding.')
      result.funding.push({ accountId: account?.id ?? statement.accountMask, account: account?.name ?? `····${statement.accountMask}`, month: row.month, deposits: statement.deposits, ledgerDeposits, withdrawals: -statement.withdrawals, ledgerWithdrawals, internalDeposits: matched, issues, transactions: monthly.filter((t) => ['Contribution', 'Withdrawal', 'Bill Payment', 'Transfer', 'Other'].includes(t.type) && !journal(t)) })
      internalDeposits += matched
    }
    result.deposits += row.deposits
    result.internalDeposits += internalDeposits
    result.months.push({ month: row.month, deposits: row.deposits, internalDeposits, value: row.closingEquity - row.openingEquity! - row.deposits + internalDeposits, totalGrowth: row.closingEquity - row.openingEquity! })
  }
  const snapshots = window.some((r) => r.statements.some((s) => s.source === 'Automatic snapshot'))
  result.outsideContributions = result.deposits - result.internalDeposits
  result.provisionalValue = result.ending - result.beginning - result.outsideContributions
  result.fundingNeedsReview = result.funding.some((f) => f.issues.length > 0)
  result.value = result.fundingNeedsReview ? null : result.provisionalValue
  result.reason = result.fundingNeedsReview ? 'Outside contributions are not reconciled yet. Review the account-by-month funding details below before interpreting this as growth or decline.' : ''
  result.estimated = snapshots || result.fundingNeedsReview || internal.pairs.length > 0
  if (snapshots) result.notes.push('Includes saved API balances and recorded cash flows; statements take precedence when imported.')
  if (internal.pairs.length > 0) result.notes.push('Internal transfers are estimated from unique equal cash movements across selected accounts within four days. Review the matched pairs in the funding audit.')
  return result
}
