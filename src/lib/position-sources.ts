import type { Account, CsvPositionAuthority, HistoricalBalance, Position } from './types'
import { statementAccount } from './statement-history'
const symbol = (s: string) => s.toUpperCase().replace(/\s+/g, '')
export function positionSources(accounts: Account[], positions: Position[], authority: CsvPositionAuthority[], history: HistoricalBalance[]) {
  const active = positions.flatMap(p => {
    const account = accounts.find(a => a.id === p.accountId)
    const csv = authority.find(row => row.accountMask === account?.mask && symbol(row.position.symbol) === symbol(p.symbol))
    return p.dataSource === 'csv' && csv ? [{position:p, csv}] : []
  })
  const statementMonths = history.filter(row => (row.source === 'Schwab statement' || row.statementSnapshot) && statementAccount(row, accounts)).map(row => row.month).sort()
  return { statementCostCount: positions.filter(p=>p.dataSource==='statement').length, csvCount: active.length, oldestCsv: active.map(r => r.csv.importedAt).sort()[0], quantityChanges: active.filter(r => Math.abs(r.position.shares - r.csv.position.shares) > .000001).length, latestStatement: statementMonths.at(-1) }
}
