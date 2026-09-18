import type { Account, BalanceSnapshot, HistoricalBalance, MonthlyBalanceSnapshot, SnapshotFlows, Transaction } from './types'

export function brokerageDate(at: string | Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at))
}

export function monthEndDate(month: string) {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10)
}

export function previousMonth(month: string) {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7)
}

export function snapshotFlows(transactions: Transaction[], accountId: string, date: string, available: boolean): SnapshotFlows {
  const totals: SnapshotFlows = { deposits: 0, withdrawals: 0, dividendsInterest: 0, expenses: 0, available, reviewRequired: false }
  for (const row of transactions) {
    if (row.accountId !== accountId || row.date.slice(0, 7) !== date.slice(0, 7) || row.date > date) continue
    if (!Number.isFinite(row.amount)) { totals.reviewRequired = true; continue }
    if (row.type === 'Contribution') totals.deposits += row.amount
    else if (row.type === 'Withdrawal' || row.type === 'Bill Payment') totals.withdrawals += row.amount
    else if (row.type === 'Dividend' || (row.type === 'Interest' && row.amount >= 0)) totals.dividendsInterest += row.amount
    else if (row.type === 'Interest' || row.type === 'Fee' || row.type === 'Tax Withholding') totals.expenses += row.amount
    // Cash/margin journals stay inside one account. Other transfers may cross
    // the portfolio boundary or move securities; do not label them profit.
    else if (row.type === 'Transfer' && !/\bTYPE ?[12]\b/i.test(row.description)) totals.reviewRequired = true
    else if (row.type === 'Other' && (row.amount !== 0 || row.units !== 0)) totals.reviewRequired = true
  }
  return totals
}

export function createBalanceSnapshot(
  account: { id: string; mask: string; equity?: number; marginBalance: number; cash: number },
  transactions: Transaction[], capturedAt: string, source: BalanceSnapshot['source'], transactionsAvailable: boolean,
): BalanceSnapshot | null {
  if (!/^\d{3,4}$/.test(account.mask) || account.equity == null || ![account.equity, account.marginBalance, account.cash].every(Number.isFinite)) return null
  const date = brokerageDate(capturedAt)
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(capturedAt)))
  return { accountMask: account.mask, capturedAt, date, equity: account.equity, marginDebt: Math.abs(account.marginBalance), cash: account.cash,
    monthEnd: date === monthEndDate(date.slice(0, 7)) && hour >= 16, source,
    flows: snapshotFlows(transactions, account.id, date, transactionsAvailable) }
}

export function mergeSnapshotMonths(existing: MonthlyBalanceSnapshot[], incoming: MonthlyBalanceSnapshot[]): MonthlyBalanceSnapshot[] {
  const months = new Map<string, MonthlyBalanceSnapshot>()
  for (const row of [...existing, ...incoming]) {
    const key = `${row.accountMask}:${row.month}`
    const old = months.get(key)
    if (!old) { months.set(key, row); continue }
    months.set(key, { ...row,
      first: old.first.capturedAt <= row.first.capturedAt ? old.first : row.first,
      latest: old.latest.capturedAt >= row.latest.capturedAt ? old.latest : row.latest,
    })
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month) || a.accountMask.localeCompare(b.accountMask))
}

// A balance capture and transaction sync can finish at slightly different
// times. Once the browser has the ledger, use it to complete an older snapshot
// that was saved without transaction coverage. Never turn a truly empty or
// unavailable ledger into invented cash flows.
export function hydrateSnapshotFlows(months: MonthlyBalanceSnapshot[], accounts: Account[], transactions: Transaction[]) {
  return months.map((month) => {
    const account = accounts.find((candidate) => candidate.mask === month.accountMask || candidate.mask.endsWith(month.accountMask) || month.accountMask.endsWith(candidate.mask))
    if (!account) return month
    const hasLedgerForAccount = transactions.some((transaction) => transaction.accountId === account.id)
    if (!hasLedgerForAccount) return month
    const hydrate = (snapshot: BalanceSnapshot): BalanceSnapshot => ({ ...snapshot, flows: snapshotFlows(transactions, account.id, snapshot.date, true) })
    return { ...month, first: hydrate(month.first), latest: hydrate(month.latest) }
  })
}

export function snapshotMonth(snapshot: BalanceSnapshot): MonthlyBalanceSnapshot {
  return { accountMask: snapshot.accountMask, month: snapshot.date.slice(0, 7), first: snapshot, latest: snapshot }
}

// Imported statements always take precedence. Only a prior month's recorded
// close can establish the next opening; a mid-month observation cannot.
export function automaticBalances(snapshots: MonthlyBalanceSnapshot[], statements: HistoricalBalance[]): HistoricalBalance[] {
  const months = mergeSnapshotMonths([], snapshots)
  return months.map(({ accountMask, month, latest }) => {
    const prior = previousMonth(month)
    const matchesMask = (mask: string) => !!mask && (mask.endsWith(accountMask) || accountMask.endsWith(mask))
    const imported = statements.filter((row) => row.source !== 'Automatic snapshot' && row.month === prior && matchesMask(row.accountMask))
    const recorded = months.find((row) => row.month === prior && row.accountMask === accountMask)?.latest
    const openingEquity = imported.length === 1 ? imported[0].closingEquity : recorded?.monthEnd ? recorded.equity : undefined
    // A downloaded ledger is usable even when it contains an ambiguous row.
    // Known cash flows can still reconcile the month; the ambiguous activity is
    // excluded and called out separately for review.
    const flowsAvailable = latest.flows.available
    const f = latest.flows
    const notes = [
      openingEquity == null ? 'Opening balance missing. Tracking begins with your first saved balance.' : '',
      !f.available ? 'Transaction history was unavailable at capture.' : f.reviewRequired ? 'Transfers or unclassified activity were excluded from the flow totals and need review.' : '',
      !latest.monthEnd ? `Latest observation: ${latest.date}.` : '',
    ].filter(Boolean)
    return {
      id: `snapshot-${accountMask}-${month}`, accountMask, month, openingEquity,
      deposits: f.deposits, withdrawals: f.withdrawals, dividendsInterest: f.dividendsInterest, expenses: f.expenses,
      marketChange: openingEquity != null && flowsAvailable ? latest.equity - openingEquity - f.deposits - f.withdrawals - f.dividendsInterest - f.expenses : 0,
      closingEquity: latest.equity, marginLoanBalance: latest.marginDebt,
      source: 'Automatic snapshot', fileName: latest.source === 'scheduled' ? 'Nightly Schwab capture' : 'Schwab sync', importedAt: latest.capturedAt,
      asOf: latest.capturedAt, monthEnd: latest.monthEnd, flowsAvailable, coverageNote: notes.join(' '),
    }
  })
}
