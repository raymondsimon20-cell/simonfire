import { getStore } from '@netlify/blobs'
import { reserveAiRequest } from './lib/ai-request-limit'
import { createAiCategoryHandler } from './lib/ai-categorization-handler'

// A shared, atomic daily ceiling bounds paid requests across function instances.
async function reserveRequest() {
  const storage = getStore({ name: 'simonfire-ai-usage', consistency: 'strong' })
  const configured = Number(process.env.AI_CATEGORIZATION_DAILY_LIMIT ?? 50)
  const limit = Number.isSafeInteger(configured) ? Math.max(0, Math.min(200, configured)) : 50
  return reserveAiRequest(storage, limit)
}
export default (req: Request) => createAiCategoryHandler({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_CATEGORIZATION_MODEL || 'gpt-4o-mini', origin: process.env.APP_URL, reserveRequest, fetch })(req)
