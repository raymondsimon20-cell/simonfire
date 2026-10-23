import { aiCategoryInput, validateAiInputs, type AiCategoryInput } from './ai-categorization'
import type { EquityGrowth } from './equity-growth'
const ISSUE_CODES = ['history_unavailable', 'deposit_mismatch', 'withdrawal_mismatch', 'transfers_exceed_deposits', 'saved_pair_changed', 'ambiguous_matches', 'unmatched_transfer', 'unclassified_activity', 'other_review'] as const
const issueCode = (issue: string) => ISSUE_CODES[['Funding history', 'Deposit transactions', 'Withdrawal transactions', 'Matched transfers', 'A saved transfer', 'Multiple equal', 'Unmatched transfers', 'Unclassified activity'].findIndex(prefix => issue.startsWith(prefix))] ?? 'other_review'
export interface FundingGroup { id: string; month: string; issues: string[]; decisions: ('auto' | 'external' | 'internal')[]; deposits: number; ledgerDeposits: number; withdrawals: number; ledgerWithdrawals: number; transactions: AiCategoryInput[] }
export interface FundingInput { groups: FundingGroup[] }
export interface FundingAdvice { advice: { id: string; explanation: string; nextStep: string }[] }
export function fundingInput(result: EquityGrowth): FundingInput {
  return { groups: result.funding.filter(f => f.issues.length).slice(0, 6).map((f, i) => ({ id: `g${i}`, month: f.month, issues: f.issues.map(issueCode), decisions: f.transactions.slice(0, 12).map(t => t.fundingReview?.kind ?? 'auto'), deposits: f.deposits, ledgerDeposits: f.ledgerDeposits, withdrawals: f.withdrawals, ledgerWithdrawals: f.ledgerWithdrawals, transactions: f.transactions.slice(0, 12).map((t, index) => aiCategoryInput({ ...t, description: t.description.trim() || 'No description' }, index)) })) }
}
export function validateFundingInput(raw: unknown): FundingInput {
  const input = raw as FundingInput
  if (!Array.isArray(input?.groups) || !input.groups.length || input.groups.length > 6) throw Error('invalid_input')
  const seen = new Set<string>()
  return { groups: input.groups.map(g => {
    if (!g || !Array.isArray(g.issues) || !g.issues.length || g.issues.length > 12 || !g.issues.every(i => (ISSUE_CODES as readonly string[]).includes(i)) || !Array.isArray(g.decisions) || g.decisions.length !== g.transactions?.length || !g.decisions.every(d => ['auto', 'external', 'internal'].includes(d)) || !/^g[0-5]$/.test(g.id) || seen.has(g.id) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(g.month) || ![g.deposits, g.ledgerDeposits, g.withdrawals, g.ledgerWithdrawals].every(Number.isFinite) || !Array.isArray(g.transactions) || g.transactions.length > 12) throw Error('invalid_input')
    seen.add(g.id)
    return { id: g.id, month: g.month, issues: [...g.issues], decisions: [...g.decisions], deposits: g.deposits, ledgerDeposits: g.ledgerDeposits, withdrawals: g.withdrawals, ledgerWithdrawals: g.ledgerWithdrawals, transactions: g.transactions.length ? validateAiInputs(g.transactions) : [] }
  }) }
}
export function validateFundingAdvice(raw: unknown, input: FundingInput): FundingAdvice {
  const value = raw as FundingAdvice
  if (!Array.isArray(value?.advice) || value.advice.length !== input.groups.length) throw Error('invalid_response')
  const seen = new Set<string>()
  return { advice: value.advice.map(a => {
    if (!a || !input.groups.some(g => g.id === a.id) || seen.has(a.id) || ![a.explanation, a.nextStep].every(s => typeof s === 'string' && !!s.trim() && s.length <= 1200)) throw Error('invalid_response')
    seen.add(a.id)
    return { id: a.id, explanation: a.explanation, nextStep: a.nextStep }
  }) }
}
