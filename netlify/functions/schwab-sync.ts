// Pulls accounts, positions, and 12 months of transactions from Schwab,
// mapped to the app's data model.
import { accessToken, fetchPortfolio, json } from './lib/schwab'

export default async () => {
  try {
    const token = await accessToken()
    const data = await fetchPortfolio(token)
    return json({ ok: true, ...data })
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    if (msg.includes('NOT_CONNECTED')) return json({ ok: false, error: 'not_connected' }, 401)
    if (msg.includes('REFRESH_EXPIRED')) return json({ ok: false, error: 'refresh_expired' }, 401)
    return json({ ok: false, error: msg }, 500)
  }
}
