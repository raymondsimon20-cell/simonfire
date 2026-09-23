import type { Account, AppData, Position, Transaction } from '../../../src/lib/types'
import { reconcileCsvAuthority } from '../../../src/lib/csv-authority'
import { reconcileStatementTransactions } from '../../../src/lib/statement-transactions'
import { applyTransactionOverrides } from '../../../src/lib/transaction-overrides'
import { resolveDividendSymbols } from '../../../src/lib/dividend-symbol'
import { statementAccount } from '../../../src/lib/statement-history'

export type DividendPreferences = Partial<Pick<AppData, 'csvPositionAuthority' | 'csvTransactionAuthority' | 'statementTransactions' | 'transactionOverrides' | 'symbolRules'>>

// Match saved accounting records before spending requests on missing tickers.
// Only enrich existing API rows; imported-only history stays client-reconciled.
export function applySavedDividendIdentities(accounts: Account[], positions: Position[], transactions: Transaction[], preferences: DividendPreferences = {}) {
  applyTransactionOverrides(transactions, accounts, preferences.transactionOverrides)
  const canonicalMask = <T extends { accountMask: string }>(row: T): T => ({ ...row, accountMask: statementAccount(row, accounts)?.mask ?? row.accountMask })
  const csv = reconcileCsvAuthority(accounts, positions, transactions, (preferences.csvPositionAuthority ?? []).map(canonicalMask), (preferences.csvTransactionAuthority ?? []).map(canonicalMask), true)
  const saved = reconcileStatementTransactions(accounts, csv.transactions, preferences.statementTransactions ?? []).transactions
  applyTransactionOverrides(saved, accounts, preferences.transactionOverrides)
  resolveDividendSymbols(csv.positions, saved, preferences.symbolRules)
  const byId = new Map(saved.map((row) => [row.id, row]))
  for (const row of transactions) {
    if (row.type !== 'Dividend' || row.symbol) continue
    const known = byId.get(row.id)
    if (!known || known.accountId !== row.accountId) continue
    row.symbol = known.symbol
    row.symbolSource = known.symbolSource
    row.securityId = known.securityId ?? row.securityId
    row.securityName = known.securityName ?? row.securityName
    row.type = known.type
    row.classificationSource = known.classificationSource
  }
  resolveDividendSymbols(csv.positions, transactions, preferences.symbolRules)
}
