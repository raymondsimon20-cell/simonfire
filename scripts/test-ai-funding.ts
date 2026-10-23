import assert from 'node:assert/strict'
import { validateFundingInput, validateFundingAdvice } from '../src/lib/ai-funding'
const input = { groups: [{ id: 'g0', month: '2026-09', issues: ['history_unavailable'], decisions: [], deposits: 100, ledgerDeposits: 0, withdrawals: 0, ledgerWithdrawals: 0, transactions: [] }] }
assert.deepEqual(validateFundingInput(input), input)
assert.throws(() => validateFundingInput({ groups: [{ ...input.groups[0], deposits: Infinity }] }))
assert.throws(() => validateFundingAdvice({ advice: [{ id: 'g99', explanation: 'Missing records', nextStep: 'Import statement' }] }, input))
assert.deepEqual(validateFundingAdvice({ advice: [{ id: 'g0', explanation: 'Deposit records are missing.', nextStep: 'Import the statement transaction details.' }] }, input).advice.length, 1)
assert.throws(() => validateFundingAdvice({ advice: [] }, input))
console.log('AI funding validation passed')

import { createAiFundingHandler } from '../netlify/functions/lib/ai-funding-handler'
async function testHandler() {
  let calls = 0
  const advice = { advice: [{ id: 'g0', explanation: 'Deposit records are missing.', nextStep: 'Import transaction details.' }] }
  const handler = createAiFundingHandler({ apiKey: 'test-only', model: 'test', reserveRequest: async () => true, fetch: async (_url, options) => {
    calls++
    const body = JSON.parse(String(options?.body))
    assert.equal(body.store, false)
    assert.deepEqual(JSON.parse(body.input), input)
    return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(advice) }] }] }))
  } })
  const request = (origin = 'https://example.test', payload: unknown = input) => new Request('https://example.test/.netlify/functions/ai-funding', { method: 'POST', headers: { origin, 'x-simonfire-ai-request': '1', 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  assert.equal((await handler(request('https://evil.test'))).status, 403)
  assert.equal((await handler(request('https://example.test', { groups: [] }))).status, 400)
  assert.equal(calls, 0)
  const response = await handler(request())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), advice)
  const limited = createAiFundingHandler({ apiKey: 'test', model: 'test', reserveRequest: async () => false, fetch: async () => { throw Error('must not call') } })
  assert.equal((await limited(request())).status, 429)
  const incomplete = createAiFundingHandler({ apiKey: 'test', model: 'test', reserveRequest: async () => true, fetch: async () => new Response(JSON.stringify({ status: 'incomplete' })) })
  assert.equal((await incomplete(request())).status, 502)
  const clean = validateFundingInput({ groups: [{ ...input.groups[0], accountName: 'PRIVATE', transactions: [] }] })
  assert.equal(JSON.stringify(clean).includes('PRIVATE'), false)
  console.log('AI funding handler checks passed')
}
testHandler().catch(e => { console.error(e); process.exitCode = 1 })
