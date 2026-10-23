import type { Transaction, TxnType } from './types'
import { transactionReviewFingerprint } from './transaction-review'

export const AI_CATEGORIES: TxnType[] = ['Buy', 'Sell', 'Dividend', 'Interest', 'Contribution', 'Withdrawal', 'Bill Payment', 'Transfer', 'Fee', 'Tax Withholding', 'Corporate Action', 'Other']
export const AI_BATCH_SIZE = 25
export interface AiCategoryInput { id: string; description: string; symbol: string; amount: number; units: number; type: TxnType }
export interface AiCategorySuggestion { id: string; category: TxnType; confidence: 'high' | 'medium' | 'low'; reason: string }
export interface PendingAiCategory extends AiCategorySuggestion { transactionId: string; fingerprint: string }

export function aiCategoryInput(t: Transaction, index: number): AiCategoryInput {
  return { id: `r${index}`, description: t.description.replace(/\b[\w*-]*\d{4,}[\w*-]*\b/g, '[redacted]').slice(0, 500), symbol: (t.symbol ?? '').slice(0, 32), amount: t.amount, units: t.units, type: t.type }
}
export function validateAiInputs(input: unknown): AiCategoryInput[] {
  if (!Array.isArray(input) || !input.length || input.length > AI_BATCH_SIZE) throw new Error('invalid_transactions')
  const ids = new Set<string>()
  return input.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('invalid_transactions')
    const t = raw as AiCategoryInput
    if (!/^r\d{1,2}$/.test(t.id) || ids.has(t.id) || typeof t.description !== 'string' || !t.description.trim() || t.description.length > 500 || typeof t.symbol !== 'string' || t.symbol.length > 32 || !Number.isFinite(t.amount) || !Number.isFinite(t.units) || !AI_CATEGORIES.includes(t.type)) throw new Error('invalid_transactions')
    ids.add(t.id)
    // Allowlist fields so extra client properties never reach the provider.
    return aiCategoryInput({ ...t, id: '', accountId: '', date: '', tags: [] }, Number(t.id.slice(1)))
  })
}
export function validateAiSuggestions(input: unknown, rows: AiCategoryInput[]): AiCategorySuggestion[] {
  if (!Array.isArray(input) || input.length !== rows.length) throw new Error('invalid_ai_response')
  const seen = new Set<string>()
  return input.map((raw) => {
    const s = raw as AiCategorySuggestion
    if (!s || !rows.some((r) => r.id === s.id) || seen.has(s.id) || !AI_CATEGORIES.includes(s.category) || !['high', 'medium', 'low'].includes(s.confidence) || typeof s.reason !== 'string' || !s.reason.trim() || s.reason.length > 600) throw new Error('invalid_ai_response')
    seen.add(s.id)
    return { id: s.id, category: s.category, confidence: s.confidence, reason: s.reason }
  })
}
export function aiCategoryFingerprint(t: Transaction) {
  return JSON.stringify([transactionReviewFingerprint(t), t.classificationSource ?? ''])
}
export function suggestionIsCurrent(s: PendingAiCategory, t?: Transaction) {
  return !!t && t.id === s.transactionId && aiCategoryFingerprint(t) === s.fingerprint
}
