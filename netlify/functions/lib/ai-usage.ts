import { getStore } from '@netlify/blobs'
import { reserveAiRequest } from './ai-request-limit'
export function reserveConfiguredAiRequest() {
  const configured = Number(process.env.AI_CATEGORIZATION_DAILY_LIMIT ?? 50)
  const limit = Number.isSafeInteger(configured) ? Math.max(0, Math.min(200, configured)) : 50
  return reserveAiRequest(getStore({ name: 'simonfire-ai-usage', consistency: 'strong' }), limit)
}
