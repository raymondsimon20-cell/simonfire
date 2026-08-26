// Reports whether we currently hold valid Schwab tokens.
import { readTokens, json } from './lib/schwab'

export default async () => {
  const t = await readTokens()
  if (!t) return json({ connected: false })
  const refreshAgeDays = (Date.now() - t.refresh_saved_at) / (24 * 3600 * 1000)
  return json({ connected: refreshAgeDays < 7, needsReconnect: refreshAgeDays >= 7, refreshAgeDays })
}
