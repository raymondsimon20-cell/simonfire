import { accessToken } from './lib/schwab'
import { captureBalances } from './lib/capture-balances'
import { saveSnapshotStatus, snapshotFailureState } from './lib/snapshot-store'

// Nightly, including weekends/month-end holidays, after the US regular close.
// Netlify invokes this only on the published deploy, without an open browser.
export const config = { schedule: '50 23 * * *' }

export default async () => {
  try {
    await captureBalances(await accessToken(), 'scheduled')
  } catch (error) {
    const state = snapshotFailureState(error)
    await saveSnapshotStatus({ attemptedAt: new Date().toISOString(), state })
    // Avoid putting brokerage responses/account identifiers in function logs.
    throw new Error(`Balance capture ${state}`)
  }
}
