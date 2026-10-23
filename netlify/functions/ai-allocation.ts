import { reserveConfiguredAiRequest } from './lib/ai-usage'
import { createAiAllocationHandler } from './lib/ai-allocation-handler'
export default (req: Request) => createAiAllocationHandler({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_ALLOCATION_MODEL || process.env.OPENAI_CATEGORIZATION_MODEL || 'gpt-4o-mini', origin: process.env.APP_URL, reserveRequest: reserveConfiguredAiRequest, fetch })(req)
