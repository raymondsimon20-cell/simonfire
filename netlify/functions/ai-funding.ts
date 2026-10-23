import { reserveConfiguredAiRequest } from './lib/ai-usage'
import { createAiFundingHandler } from './lib/ai-funding-handler'
export default (req: Request) => createAiFundingHandler({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_CATEGORIZATION_MODEL || 'gpt-4o-mini', origin: process.env.APP_URL, reserveRequest: reserveConfiguredAiRequest, fetch })(req)
