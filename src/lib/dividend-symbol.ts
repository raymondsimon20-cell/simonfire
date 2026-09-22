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

const identity = (text: string) => dividendDescriptionKey(text)
  .replace(/\b(?:SUBSTITUTE|IN|LIEU|OF|INCOME|INTEREST|ADJUSTMENT|CREDIT|DEBIT|ACH|USD|PAID|RECEIVED|ORDINARY|REGULAR|UNIDENTIFIED|UNKNOWN|UNASSIGNED|RETURN|CAPITAL|GAIN|GAINS|DIST|RATE|DATE)\b/g, ' ')
  .replace(/\s+/g, ' ').trim()
export const hasDividendIdentity = (text: string) => identity(text).replace(/[^A-Z0-9]/g, '').length >= 4

// Only resolve missing dividend symbols. Security identities are shared across
// accounts; amounts and current share counts alone are not reliable evidence.
export function resolveDividendSymbols(positions: Position[], transactions: Transaction[], rules: SymbolRule[] = []) {
  const distinctive = hasDividendIdentity
  const byId = new Map<string, Set<string>>()
  const learned = new Map<string, Set<string>>()
  const names = new Map<string, Set<string>>()
  const knownSymbols = new Set<string>()
  const add = (map: Map<string, Set<string>>, key: string, symbol: string) => {
    if (!key) return
    const values = map.get(key) ?? new Set<string>()
    values.add(normTicker(symbol)); map.set(key, values)
  }
  const unique = (values: Set<string> | undefined) => values?.size === 1 ? [...values][0] : undefined
  const cusip = (value?: string) => (value ?? '').trim().toUpperCase()
  for (const row of positions) {
    if (row.isOption || !row.symbol || row.symbol === 'UNKNOWN') continue
    knownSymbols.add(normTicker(row.symbol))
    add(byId, cusip(row.securityId), row.symbol)
    if (distinctive(row.name)) add(names, nameKey(row.name), row.symbol)
  }
  for (const row of transactions) {
    if (!row.symbol || row.symbolSource === 'inferred') continue
    // Do not learn equity identities from option contracts or currency legs.
    if (!/^[A-Z][A-Z0-9./-]{0,9}$/i.test(row.symbol) || row.symbol.startsWith('CURRENCY')) continue
    knownSymbols.add(normTicker(row.symbol))
    add(byId, cusip(row.securityId), row.symbol)
    if (row.securityName && distinctive(row.securityName)) add(names, nameKey(row.securityName), row.symbol)
    if (row.type === 'Dividend' && distinctive(row.description)) add(learned, dividendDescriptionKey(row.description), row.symbol)
    if (['Buy', 'Sell'].includes(row.type) && distinctive(row.description)) {
      const name = nameKey(row.description.replace(/\b(?:BUY|BOUGHT|SELL|SOLD|REINVEST)\b/gi, ' '))
      if (name.length >= 6) add(names, name, row.symbol)
    }
  }
  // Explicit description mappings can transfer across accounts only when all
  // saved mappings for the same distinctive payer description agree.
  const sharedRules = new Map<string, Set<string>>()
  for (const rule of rules) if (distinctive(rule.contains)) add(sharedRules, dividendDescriptionKey(rule.contains), rule.symbol)

  let resolved = 0
  for (const row of transactions) {
    if (row.type !== 'Dividend' || row.symbol) continue
    const description = dividendDescriptionKey(row.description)
    const matchingRules = rules.filter((rule) => (!rule.accountId || rule.accountId === row.accountId) && dividendDescriptionKey(rule.contains) && description.includes(dividendDescriptionKey(rule.contains)))
      .sort((a, b) => Number(b.accountId === row.accountId) - Number(a.accountId === row.accountId) || b.contains.length - a.contains.length)
    const saved = matchingRules[0]
    let symbol: string | undefined = saved?.symbol
    if (!symbol && row.securityId) symbol = unique(byId.get(cusip(row.securityId)))
    if (!symbol && distinctive(row.description)) symbol = unique(sharedRules.get(description)) ?? unique(learned.get(description))
    if (!symbol) {
      const text = identity(row.description)
      const matches = new Set([...knownSymbols].filter((ticker) => {
        // normTicker restricts candidates to letters and digits.
        return ticker.length > 1 && new RegExp(`(^|[^A-Z0-9])${ticker}([^A-Z0-9]|$)`).test(text)
      }))
      symbol = unique(matches)
    }
    if (!symbol) {
      const text = nameKey(row.securityName || row.description)
      const matches = new Set<string>()
      if (distinctive(text)) for (const [name, symbols] of names) {
        if (name.length >= 6 && text.length >= 6 && (text.includes(name) || name.includes(text))) {
          for (const candidate of symbols) matches.add(candidate)
        }
      }
      symbol = unique(matches)
    }
    if (symbol) {
      row.symbol = normTicker(symbol)
      row.symbolSource = saved ? 'manual' : 'inferred'
      resolved++
    }
  }
  return resolved
}
