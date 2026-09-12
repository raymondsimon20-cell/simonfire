import type { Position, Transaction } from './types'

const EPSILON = 0.000001

function key(accountId: string, symbol: string) {
  return `${accountId}|${symbol.trim().toUpperCase()}`
}

/**
 * Fill missing sell P/L values from the trade ledger.
 *
 * Schwab's transaction history provides proceeds and quantities, but generally
 * does not provide the tax-lot gain/loss used on its realized-gain report. We
 * therefore preserve reported/manual values and estimate only missing values,
 * using average cost from known buys and (for inventory predating the history
 * window) the current broker-reported average cost.
 */
export function populateRealizedProfitLoss(positions: Position[], transactions: Transaction[]) {
  const current = new Map<string, Position>()
  for (const position of positions) current.set(key(position.accountId, position.symbol), position)

  const groups = new Map<string, Transaction[]>()
  for (const transaction of transactions) {
    if (!transaction.symbol || (transaction.type !== 'Buy' && transaction.type !== 'Sell')) continue
    const k = key(transaction.accountId, transaction.symbol)
    const rows = groups.get(k) ?? []
    rows.push(transaction)
    groups.set(k, rows)
  }

  for (const [k, rows] of groups) {
    const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    const ending = current.get(k)
    const endingQuantity = ending?.shares ?? 0
    const netUnits = ordered.reduce((sum, transaction) => sum + transaction.units, 0)
    let quantity = Math.max(0, endingQuantity - netUnits)
    let cost = quantity * Math.max(0, ending?.avgCost ?? 0)

    for (const transaction of ordered) {
      if (transaction.type === 'Buy') {
        const bought = Math.abs(transaction.units)
        if (bought <= EPSILON) continue
        const purchaseCost = Math.abs(transaction.amount)
        quantity += bought
        cost += purchaseCost
        continue
      }

      const sold = Math.abs(transaction.units)
      if (sold <= EPSILON) continue
      const averageCost = quantity > EPSILON && cost > EPSILON
        ? cost / quantity
        : Math.max(0, ending?.avgCost ?? 0)

      if (transaction.pl == null && averageCost > 0) {
        const proceeds = Math.abs(transaction.amount)
        transaction.pl = +(proceeds - sold * averageCost).toFixed(2)
        transaction.plEstimated = true
      }

      if (quantity > EPSILON && cost > EPSILON) {
        const applied = Math.min(sold, quantity)
        cost = Math.max(0, cost - applied * averageCost)
        quantity = Math.max(0, quantity - applied)
      }
    }
  }
}
