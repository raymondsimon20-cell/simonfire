import type { Account, AccountSyncCoverage, Position, Transaction } from './types'
import { transactionOverrideKeys } from './transaction-overrides'

// Refresh only accounts returned by this connection. Retain other accounts and
// history outside the requested window without collapsing identical payments.
export function mergeLiveAccounts(current: { accounts: Account[]; positions: Position[]; transactions: Transaction[] }, incoming: { accounts: Account[]; positions: Position[]; transactions: Transaction[]; accountSyncCoverage?: AccountSyncCoverage[] }) {
  const incomingIds = new Set(incoming.accounts.map((row) => row.id))
  const accountAliases: Record<string, string> = {}
  const broker = (value: string) => value.toUpperCase().replace(/^CHARLES\s+/, '').replace(/[^A-Z0-9]/g, '')
  for (const old of current.accounts) {
    if (incomingIds.has(old.id)) continue
    const matches = incoming.accounts.filter((row) => old.mask && row.mask === old.mask && broker(row.broker) === broker(old.broker))
    if (matches.length === 1) accountAliases[old.id] = matches[0].id
  }
  const accountId = (id: string) => accountAliases[id] ?? id
  const accounts = [...incoming.accounts, ...current.accounts.filter((row) => !incomingIds.has(accountId(row.id)))]
  const previousTransactions = current.transactions.map((row) => accountAliases[row.accountId] ? { ...row, accountId: accountId(row.accountId) } : row)
  const windows = new Map(incoming.accountSyncCoverage?.map((row) => [row.accountId, row]))
  const keys = transactionOverrideKeys(incoming.transactions, accounts)
  const present = new Set(keys.flatMap((key) => [key.primary, key.legacy]))
  const previousKeys = transactionOverrideKeys(previousTransactions, accounts)
  const retained = previousTransactions.filter((row, index) => {
    if (!incomingIds.has(row.accountId)) return true
    const window = windows.get(row.accountId)
    if (!window || (row.date >= window.from && row.date <= window.to)) return false
    const key = previousKeys[index]
    return !present.has(key.primary) && !present.has(key.legacy)
  })
  return {
    accountAliases,
    accounts,
    positions: [...incoming.positions, ...current.positions.filter((row) => !incomingIds.has(accountId(row.accountId)))],
    transactions: [...incoming.transactions, ...retained].sort((a, b) => b.date.localeCompare(a.date)),
  }
}
