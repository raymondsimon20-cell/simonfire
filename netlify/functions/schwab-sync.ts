// Pulls accounts, positions, and 12 months of transactions from Schwab,
// mapped to the app's data model.
import { accessToken, fetchPortfolio, json } from './lib/schwab'
import { captureBalances } from './lib/capture-balances'
import { loadBalanceSnapshots, saveSnapshotStatus, snapshotFailureState } from './lib/snapshot-store'
import { loadDividendSyncContext, saveDividendLookupCache } from './lib/dividend-lookup-store'

export default async () => {
  try {
    const token = await accessToken()
    const context = await loadDividendSyncContext().catch(() => ({ preferences: {}, lookupCache: {} }))
    const [data, snapshotStatus] = await Promise.all([
      fetchPortfolio(token, context),
      captureBalances(token, 'sync').catch(async (error) => {
        const status = { attemptedAt: new Date().toISOString(), state: snapshotFailureState(error) }
        await saveSnapshotStatus(status).catch(() => undefined)
        return status
      }),
    ])
    await saveDividendLookupCache(context.lookupCache).catch(() => undefined)
    const balanceSnapshots = await loadBalanceSnapshots().catch(() => undefined)
    return json({ ok: true, ...data, balanceSnapshots, snapshotStatus })
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    if (msg.includes('NOT_CONNECTED')) return json({ ok: false, error: 'not_connected' }, 401)
    if (msg.includes('REFRESH_EXPIRED')) return json({ ok: false, error: 'refresh_expired' }, 401)
    return json({ ok: false, error: msg }, 500)
  }
}
