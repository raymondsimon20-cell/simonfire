import { fetchBalanceSnapshots } from './schwab'
import { saveBalanceSnapshots, saveSnapshotStatus } from './snapshot-store'
import type { BalanceSnapshot } from '../../../src/lib/types'

export async function captureBalances(token: string, source: BalanceSnapshot['source']) {
  const snapshots = await fetchBalanceSnapshots(token, source)
  await saveBalanceSnapshots(snapshots)
  const status = { attemptedAt: new Date().toISOString(), state: snapshots.every((row) => row.flows.available && !row.flows.reviewRequired) ? 'ok' as const : 'partial' as const }
  await saveSnapshotStatus(status)
  return status
}
