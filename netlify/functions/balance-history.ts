import { json } from './lib/schwab'
import { loadBalanceSnapshots, loadSnapshotStatus } from './lib/snapshot-store'

export default async (request: Request) => {
  if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405)
  try {
    const [snapshots, status] = await Promise.all([loadBalanceSnapshots(), loadSnapshotStatus()])
    return json({ ok: true, snapshots, status })
  } catch {
    return json({ ok: false, error: 'history_unavailable' }, 503)
  }
}
