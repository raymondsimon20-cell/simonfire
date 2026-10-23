import { strict as assert } from 'node:assert'
import { aiCategoryInput, aiCategoryFingerprint, validateAiInputs, validateAiSuggestions, suggestionIsCurrent } from '../src/lib/ai-categorization'
import { reserveAiRequest } from '../netlify/functions/lib/ai-request-limit'
import { createAiCategoryHandler } from '../netlify/functions/lib/ai-categorization-handler'
import '../netlify/functions/ai-categorize'
import type { Transaction } from '../src/lib/types'

async function main() {
  const row: Transaction = { id: 'private-id', accountId: 'private-account', date: '2026-10-01', type: 'Other', description: 'PAYMENT ACCOUNT 1234567890', amount: -20, units: 0, tags: [] }
  const input = aiCategoryInput(row, 0)
  assert.equal(input.id, 'r0')
  assert.ok(!JSON.stringify(input).includes('1234567890'))
  assert.ok(!JSON.stringify(input).includes('private-account'))
  assert.ok(!JSON.stringify(input).includes('2026-10-01'))
  assert.deepEqual(validateAiInputs([{ ...input, accountId: 'hidden', date: 'hidden' }]), [input])
  assert.throws(() => validateAiInputs([]))
  assert.throws(() => validateAiInputs(Array(26).fill(input)))
  assert.throws(() => validateAiInputs([input, input]))
  assert.throws(() => validateAiInputs([{ ...input, amount: '20' }]))
  const suggestion = { id: 'r0', category: 'Bill Payment' as const, confidence: 'medium' as const, reason: 'Identified payment, confirm its purpose.' }
  assert.deepEqual(validateAiSuggestions([suggestion], [input]), [suggestion])
  assert.throws(() => validateAiSuggestions([{ ...suggestion, category: 'Invented' }], [input]))
  assert.throws(() => validateAiSuggestions([{ ...suggestion, id: 'r1' }], [input]))
  assert.throws(() => validateAiSuggestions([], [input]))
  const pending = { ...suggestion, transactionId: row.id, fingerprint: aiCategoryFingerprint(row) }
  assert.ok(suggestionIsCurrent(pending, row))
  assert.equal(suggestionIsCurrent(pending, { ...row, amount: -30 }), false)
  assert.equal(suggestionIsCurrent(pending, undefined), false)
  assert.equal(suggestionIsCurrent(pending, { ...row, classificationSource: 'manual' }), false)
  let calls = 0
  let providerBody: Record<string, unknown> = {}
  const mockFetch: typeof fetch = async (_url, init) => { calls++; providerBody = JSON.parse(String(init?.body)); return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ suggestions: [suggestion] }) }] }] }) }
  const dependencies = { apiKey: 'test-only', model: 'test-model', reserveRequest: async () => true, fetch: mockFetch }
  const request = (body: unknown = { transactions: [input] }, origin = 'https://app.example') => new Request('https://app.example/api', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Simonfire-Ai-Request': '1' }, body: JSON.stringify(body) })
  const handler = createAiCategoryHandler(dependencies)
  const success = await handler(request())
  assert.equal(success.status, 200)
  assert.deepEqual((await success.json()).suggestions, [suggestion])
  assert.equal(providerBody.store, false)
  assert.ok(!JSON.stringify(providerBody).includes('private-account'))
  assert.equal((await handler(request(undefined, 'https://other.example'))).status, 403)
  assert.equal((await handler(request({ transactions: [] }))).status, 400)
  assert.equal((await createAiCategoryHandler({ ...dependencies, apiKey: undefined })(request())).status, 503)
  assert.equal((await createAiCategoryHandler({ ...dependencies, reserveRequest: async () => false })(request())).status, 429)
  assert.equal(calls, 1, 'rejected requests never reach OpenAI')
  const incomplete: typeof fetch = async () => Response.json({ status: 'incomplete', output: [] })
  assert.equal((await createAiCategoryHandler({ ...dependencies, fetch: incomplete })(request())).status, 502)
  const badIds: typeof fetch = async () => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ suggestions: [{ ...suggestion, id: 'wrong' }] }) }] }] })
  assert.equal((await createAiCategoryHandler({ ...dependencies, fetch: badIds })(request())).status, 502)
  const unauthorized: typeof fetch = async () => new Response('provider secret details', { status: 401 })
  const denied = await createAiCategoryHandler({ ...dependencies, fetch: unauthorized })(request())
  assert.equal(denied.status, 502)
  assert.ok(!(await denied.text()).includes('provider secret'))
  const usage = new Map<string, { count: number; etag: string }>()
  const storage = {
    getWithMetadata: async (key: string) => { const v = usage.get(key); return v ? { data: { count: v.count }, etag: v.etag } : null },
    setJSON: async (key: string, value: unknown, options: { onlyIfMatch?: string; onlyIfNew?: boolean }) => {
      const existing = usage.get(key)
      if (options.onlyIfNew ? !!existing : existing?.etag !== options.onlyIfMatch) return { modified: false }
      usage.set(key, { count: (value as { count: number }).count, etag: String((existing?.count ?? 0) + 1) })
      return { modified: true }
    },
  }
  const reservations = await Promise.all(Array.from({ length: 20 }, () => reserveAiRequest(storage, 3, '2026-10-23')))
  assert.equal(reservations.filter(Boolean).length, 3, 'parallel requests cannot exceed the daily limit')
  assert.equal(await reserveAiRequest(storage, 3, '2026-10-23'), false)
  assert.equal(await reserveAiRequest(storage, 3, '2026-10-24'), true, 'a new UTC day gets a fresh quota')
  assert.equal(await reserveAiRequest(storage, 0, '2026-10-25'), false)
  console.log('AI input privacy, bounded batches, response validation, stale suggestions, origin checks, quota and provider failures passed')
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
