import type { AppData, FundingReview, Transaction } from './types'
import { applyTransactionOverrides, recordTransactionOverride } from './transaction-overrides'

export const isFundingJournal = (t: Transaction) => t.type === 'Transfer' && /\bTYPE ?[12]\b/i.test(t.description)
export const isFundingCash = (t: Transaction) => !isFundingJournal(t) && t.units === 0 && Number.isFinite(t.amount) && t.amount !== 0 && ['Contribution', 'Withdrawal', 'Bill Payment', 'Transfer', 'Other'].includes(t.type)

export function canPairFunding(a: Transaction, b: Transaction) {
  return isFundingCash(a) && isFundingCash(b) && a.accountId !== b.accountId && a.amount * b.amount < 0 && Math.abs(a.amount + b.amount) < .01
}

// Manual pairs reserve both legs before automatic matching. A missing or
// changed leg cannot silently fall back to an unrelated equal payment.
export function fundingTransfers(txns: Transaction[], windowDays = 4) {
  const pairs: { incoming: Transaction; outgoing: Transaction }[] = []
  const invalid = new Set<string>()
  const groups = new Map<string, Transaction[]>()
  for (const t of txns) if (t.fundingReview?.kind === 'internal') {
    const key = t.fundingReview.pairId
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  for (const group of groups.values()) {
    if (group.length === 2 && canPairFunding(group[0], group[1])) {
      pairs.push({ incoming: group.find((t) => t.amount > 0)!, outgoing: group.find((t) => t.amount < 0)! })
    } else group.forEach((t) => invalid.add(t.id))
  }
  const eligible = txns.filter((t) => isFundingCash(t) && (!t.fundingReview || t.fundingReview.kind === 'auto'))
  const incoming = eligible.filter((t) => t.amount > 0 && ['Contribution', 'Transfer'].includes(t.type))
  const outgoing = eligible.filter((t) => t.amount < 0 && ['Withdrawal', 'Transfer'].includes(t.type))
  const matches = (a: Transaction, b: Transaction) => canPairFunding(a, b) && Math.abs(Date.parse(a.date) - Date.parse(b.date)) <= windowDays * 86_400_000
  const ambiguous = new Set<string>()
  for (const deposit of incoming) {
    const options = outgoing.filter((out) => matches(deposit, out))
    if (!options.length) continue
    if (options.length === 1 && incoming.filter((t) => matches(t, options[0])).length === 1) pairs.push({ incoming: deposit, outgoing: options[0] })
    else { ambiguous.add(deposit.id); options.forEach((t) => ambiguous.add(t.id)) }
  }
  return { pairs, ambiguous, invalid, ids: new Set(pairs.flatMap((p) => [p.incoming.id, p.outgoing.id])) }
}

// Apply both legs and their durable overrides in one store mutation. Re-pairing
// or clearing a decision releases its old partner as well.
export function saveFundingReview(data: AppData, id: string, kind: FundingReview['kind'], partnerId?: string, pairId: string = crypto.randomUUID()) {
  const txn = data.transactions.find((t) => t.id === id)
  const partner = data.transactions.find((t) => t.id === partnerId)
  if (!txn || (kind !== 'auto' && !isFundingCash(txn))) return false
  if (kind === 'internal' && (!partner || !canPairFunding(txn, partner))) return false
  const oldPairs = new Set([txn, ...(kind === 'internal' && partner ? [partner] : [])].flatMap((t) => t.fundingReview?.kind === 'internal' ? [t.fundingReview.pairId] : []))
  const released = data.transactions.filter((t) => t.fundingReview?.kind === 'internal' && oldPairs.has(t.fundingReview.pairId)).map((t) => t.id)
  let overrides = recordTransactionOverride(data.transactions, data.accounts, data.transactionOverrides ?? {}, released, { fundingReview: { kind: 'auto' } })
  for (const t of [txn, ...(kind === 'internal' && partner ? [partner] : [])]) {
    const fundingReview: FundingReview = kind === 'internal' ? { kind, pairId } : { kind }
    // Keep cash flows in account snapshots; portfolio matching removes only
    // the incoming internal contribution in the equity-growth diagnostic.
    const type = kind === 'auto' ? undefined : t.amount > 0 ? 'Contribution' : t.type === 'Bill Payment' && kind === 'external' ? 'Bill Payment' : 'Withdrawal'
    overrides = recordTransactionOverride(data.transactions, data.accounts, overrides, t.id, { fundingReview, ...(type ? { type } : {}) })
  }
  data.transactionOverrides = overrides
  applyTransactionOverrides(data.transactions, data.accounts, overrides)
  return true
}
