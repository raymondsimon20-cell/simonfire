import type { Position, SyncChangeSummary, Transaction } from './types'

const positionKey = (position: Position) => `${position.accountId}|${position.symbol}`
const transactionKey = (transaction: Transaction) => `${transaction.accountId}|${transaction.date}|${transaction.type}|${transaction.symbol ?? ''}|${transaction.amount.toFixed(2)}|${transaction.description}`
const value = (positions: Position[]) => positions.reduce((sum, position) => sum + position.shares * position.lastPrice, 0)

export function summarizeSync(previousPositions: Position[], previousTransactions: Transaction[], nextPositions: Position[], nextTransactions: Transaction[], at: string): SyncChangeSummary {
  const beforePositions = new Set(previousPositions.map(positionKey))
  const afterPositions = new Set(nextPositions.map(positionKey))
  const previousTxn = new Set(previousTransactions.map(transactionKey))
  const newRows = nextTransactions.filter((transaction) => !previousTxn.has(transactionKey(transaction)))
  return {
    at,
    addedPositions: [...afterPositions].filter((key) => !beforePositions.has(key)).map((key) => key.split('|').at(-1)!),
    removedPositions: [...beforePositions].filter((key) => !afterPositions.has(key)).map((key) => key.split('|').at(-1)!),
    newTransactions: newRows.length,
    newDividends: newRows.filter((transaction) => transaction.type === 'Dividend').length,
    valueChange: +(value(nextPositions) - value(previousPositions)).toFixed(2),
    latestTransactionDate: nextTransactions.reduce((latest, transaction) => transaction.date > latest ? transaction.date : latest, ''),
  }
}
