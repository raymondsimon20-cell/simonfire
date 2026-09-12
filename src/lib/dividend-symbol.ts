import type { Position, SymbolRule, Transaction } from './types'
import { normTicker } from './plan'

export const dividendDescriptionKey = (value: string) => value
  .toUpperCase()
  .replace(/\b(?:QUALIFIED|NON[- ]?QUALIFIED|CASH|SPECIAL|SHORT TERM|LONG TERM|REINVEST(?:ED)?)\b/g, ' ')
  .replace(/\bDIVIDEND(?:S)?\b|\bDISTRIBUTION(?:S)?\b|\bPAYMENT\b/g, ' ')
  .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
  .replace(/[^A-Z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const nameKey = (value: string) => value
  .toUpperCase()
  .replace(/\b(?:ETF|ETN|INC|CORP|CORPORATION|LTD|FUND|TRUST|SHARES?)\b/g, ' ')
  .replace(/[^A-Z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

// Mutates only missing dividend symbols. Every inference must be unique within
// the account; uncertain rows deliberately remain unassigned for manual review.
export function resolveDividendSymbols(positions: Position[], transactions: Transaction[], rules: SymbolRule[] = []) {
  const holdingsByAccount = new Map<string, Position[]>()
  for (const position of positions) {
    if (position.isOption || !position.symbol) continue
    const list = holdingsByAccount.get(position.accountId) ?? []
    list.push(position)
    holdingsByAccount.set(position.accountId, list)
  }

  const learned = new Map<string, Set<string>>()
  for (const transaction of transactions) {
    if (transaction.type !== 'Dividend' || !transaction.symbol) continue
    const key = `${transaction.accountId}|${dividendDescriptionKey(transaction.description)}`
    const symbols = learned.get(key) ?? new Set<string>()
    symbols.add(transaction.symbol)
    learned.set(key, symbols)
  }

  let resolved = 0
  for (const transaction of transactions) {
    if (transaction.type !== 'Dividend' || transaction.symbol) continue
    const holdings = holdingsByAccount.get(transaction.accountId) ?? []
    const description = dividendDescriptionKey(transaction.description)
    const saved = [...rules].reverse().find((rule) => (!rule.accountId || rule.accountId === transaction.accountId) && description.includes(rule.contains))
    if (saved) transaction.symbol = saved.symbol
    const learnedSymbols = learned.get(`${transaction.accountId}|${description}`)
    if (learnedSymbols?.size === 1) transaction.symbol = [...learnedSymbols][0]

    if (!transaction.symbol) {
      const text = transaction.description.toUpperCase()
      const tickerMatches = holdings.filter((position) => {
        const raw = position.symbol.toUpperCase().replace('.', '[./]')
        return raw.length > 1 && new RegExp(`(^|[^A-Z0-9])${raw}([^A-Z0-9]|$)`).test(text)
      })
      const unique = new Set(tickerMatches.map((position) => position.symbol))
      if (unique.size === 1) transaction.symbol = [...unique][0]
    }

    if (!transaction.symbol) {
      const text = nameKey(transaction.description)
      const nameMatches = holdings.filter((position) => {
        const name = nameKey(position.name)
        return text.length >= 4 && name.length >= 6 && (text.includes(name) || name.includes(text))
      })
      const unique = new Set(nameMatches.map((position) => position.symbol))
      if (unique.size === 1) transaction.symbol = [...unique][0]
    }

    if (!transaction.symbol && transaction.amount > 0) {
      const amountMatches = holdings.filter((position) => {
        if (!position.lastDividend || position.shares <= 0) return false
        const expected = position.lastDividend * position.shares
        return Math.abs(expected - transaction.amount) <= Math.max(0.02, expected * 0.015)
      })
      const unique = new Set(amountMatches.map((position) => position.symbol))
      if (unique.size === 1) transaction.symbol = [...unique][0]
    }

    if (transaction.symbol) {
      transaction.symbol = normTicker(transaction.symbol)
      resolved++
    }
  }
  return resolved
}
