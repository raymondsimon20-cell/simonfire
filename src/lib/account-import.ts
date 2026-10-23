import { securityKey } from './csv-authority'
import type { Account, Position, Transaction } from './types'
const security = securityKey
const description = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ')
const cents = (n: number) => Math.round(n * 100)
const identity = (t: Transaction) => JSON.stringify([t.date, security(t.symbol), description(t.description), cents(t.amount), Math.round(Math.abs(t.units) * 1e6)])
const sameCash = (a: Transaction, b: Transaction) => cents(a.amount) === cents(b.amount) && Math.abs(Math.abs(a.units) - Math.abs(b.units)) < .000001
const sameSecurity = (a: Transaction, b: Transaction) => !!security(a.symbol) && security(a.symbol) === security(b.symbol)
const nearDate = (a: Transaction, b: Transaction) => Math.abs(Date.parse(a.date) - Date.parse(b.date)) <= 4 * 86400000
interface Incoming { accounts: Account[]; positions: Position[]; transactions: Transaction[] }
export interface AccountImportPlan {
  positions: Position[]; transactions: Transaction[]
  positionUpdates: Position[]; positionHeld: { row: Position; reason: string }[]
  matched: Transaction[]; added: Transaction[]; held: { row: Transaction; reason: string }[]
  authorityTransactions: Transaction[]
}
// This path is deliberately conservative. Uncertain identity never becomes a new record.
export function planAccountImport(account: Account, positions: Position[], transactions: Transaction[], incoming: Incoming, archived: Transaction[] = []): AccountImportPlan {
  if (!account.mask || incoming.accounts.length !== 1) throw Error('Choose one existing account and upload files for that account only.')
  const source = incoming.accounts[0]
  if (source.mask && !(source.mask === account.mask || (/^\d{3,4}$/.test(source.mask) && /^\d{3,4}$/.test(account.mask) && (source.mask.endsWith(account.mask) || account.mask.endsWith(source.mask))))) throw Error('The account in this CSV does not match the selected account.')
  if (incoming.positions.some(p => p.accountId !== source.id) || incoming.transactions.some(t => t.accountId !== source.id)) throw Error('This file contains records from another account.')
  const plan: AccountImportPlan = { positions: positions.map(p => ({...p})), transactions: transactions.map(t => ({...t})), positionUpdates: [], positionHeld: [], matched: [], added: [], held: [], authorityTransactions: [] }
  const existing = transactions.filter(t => t.accountId === account.id)
  const positionCounts = new Map<string, number>()
  for (const p of incoming.positions) positionCounts.set(security(p.symbol), (positionCounts.get(security(p.symbol)) ?? 0) + 1)
  for (const row of incoming.positions) {
    const matches = plan.positions.filter(p => p.accountId === account.id && security(p.symbol) === security(row.symbol))
    const p = matches[0]
    if (!security(row.symbol) || matches.length !== 1 || positionCounts.get(security(row.symbol)) !== 1 || row.costBasisUnavailable || !Number.isFinite(row.avgCost) || !Number.isFinite(row.shares) || Math.abs(row.shares - (p?.shares ?? 0)) > .000001) {
      plan.positionHeld.push({row, reason: 'Cost basis needs a known value, a unique current holding and matching quantity. Sync holdings or upload a current Positions CSV.'}); continue
    }
    p.avgCost = row.avgCost; p.dataSource = 'csv'; p.costBasisUnavailable = false
    plan.positionUpdates.push(p)
  }
  const inputCounts = new Map<string, number>()
  for (const row of incoming.transactions) inputCounts.set(identity(row), (inputCounts.get(identity(row)) ?? 0) + 1)
  const overlapping = new Set<Transaction>()
  for (const target of incoming.transactions.filter(t=>['Buy','Sell'].includes(t.type))) {
    const parts=incoming.transactions.filter(t=>t!==target && t.date===target.date && t.type===target.type && sameSecurity(t,target) && Math.sign(t.amount)===Math.sign(target.amount) && Math.abs(t.amount)<Math.abs(target.amount) && Math.abs(t.units)<Math.abs(target.units))
    let budget=20000
    const search=(at:number,cash:number,units:number,chosen:Transaction[]):Transaction[]|undefined=>{
      if(cash===Math.abs(cents(target.amount))&&Math.abs(units-Math.abs(target.units))<.000001&&chosen.length>1)return chosen
      if(--budget<0||at>=parts.length||cash>Math.abs(cents(target.amount))||units>Math.abs(target.units)+.000001)return
      return search(at+1,cash+Math.abs(cents(parts[at].amount)),units+Math.abs(parts[at].units),[...chosen,parts[at]])??search(at+1,cash,units,chosen)
    }
    const fills=search(0,0,0,[])
    if(fills){overlapping.add(target);fills.forEach(t=>overlapping.add(t))}
  }
  const used = new Set<string>()
  for (const row of incoming.transactions) {
    if(overlapping.has(row)){plan.held.push({row,reason:'This upload includes a possible aggregate trade and its individual fills. Compare the source rows before importing.'});continue}
    const valid = Number.isFinite(row.amount) && Number.isFinite(row.units) && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(Date.parse(row.date))
    if (archived.some(t => t.accountId === account.id && nearDate(t, row) && sameCash(t, row))) { plan.held.push({row, reason: 'Matches an archived record. Restore it from Data Quality if needed.'}); continue }
    const candidates = existing.filter(t => !(['Buy', 'Sell'].includes(row.type) && t.symbol && row.symbol && !sameSecurity(t, row)) && t.date === row.date && sameCash(t, row) && (sameSecurity(t, row) || description(t.description) === description(row.description)))
    if (!valid || inputCounts.get(identity(row)) !== 1 || incoming.transactions.filter(t => t !== row && t.date === row.date && sameCash(t, row) && (sameSecurity(t, row) || description(t.description) === description(row.description))).length > 0 || candidates.length > 1 || (candidates.length === 1 && used.has(candidates[0].id))) {
      plan.held.push({row, reason: 'Repeated or uncertain transaction identity. Compare these records before adding anything.'}); continue
    }
    if (candidates.length === 1) {
      const old = plan.transactions.find(t => t.id === candidates[0].id)!
      used.add(old.id)
      // Keep dates, manual classification, reviews, funding decisions and tags.
      if (!old.symbol && row.symbol && old.symbolSource !== 'manual') { old.symbol = row.symbol; old.symbolSource = 'broker' }
      if (row.pl != null && Number.isFinite(row.pl) && old.plSource !== 'manual') { old.pl = row.pl; old.plSource = 'csv'; old.plEstimated = row.plEstimated }
      old.dataSource = 'csv'
      plan.matched.push(old); plan.authorityTransactions.push({...old})
      continue
    }
    const possible = existing.some(t => nearDate(t, row) && (sameCash(t, row) || (sameSecurity(t, row) && ['Buy','Sell'].includes(row.type) && Math.sign(t.amount) === Math.sign(row.amount))))
    if (possible) { plan.held.push({row, reason: 'Possible date difference, split trade fills or overlapping record. No transaction was added.'}); continue }
    const added: Transaction = { ...row, id: `csv-update-${account.id}-${identity(row)}`, accountId: account.id, dataSource: 'csv' }
    plan.transactions.push(added); plan.added.push(added); plan.authorityTransactions.push(added)
  }
  plan.transactions.sort((a,b) => b.date.localeCompare(a.date))
  return plan
}
