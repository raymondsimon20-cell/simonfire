import { getStore } from '@netlify/blobs'
import { mergeSnapshotMonths, snapshotMonth } from '../../../src/lib/balance-snapshots'
import type { BalanceSnapshot, MonthlyBalanceSnapshot, SnapshotStatus } from '../../../src/lib/types'

export interface SnapshotStore {
  getWithMetadata(key: string, options: { type: 'json' }): Promise<{ data: MonthlyBalanceSnapshot; etag?: string } | null>
  setJSON(key: string, value: unknown, options?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean }>
  get(key: string, options: { type: 'json' }): Promise<any>
  list(options: { prefix: string }): Promise<{ blobs: { key: string }[] }>
}

const store = () => getStore({ name: 'simonfire-balance-history', consistency: 'strong' }) as SnapshotStore

export async function saveBalanceSnapshots(snapshots: BalanceSnapshot[], storage = store()) {
  await Promise.all(snapshots.map(async (snapshot) => {
    const incoming = snapshotMonth(snapshot)
    const key = `months/${incoming.month}/${incoming.accountMask}`
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await storage.getWithMetadata(key, { type: 'json' })
      const [merged] = mergeSnapshotMonths(existing ? [existing.data] : [], [incoming])
      // Conditional writes prevent concurrent sync/nightly captures overwriting
      // a later observation or the original baseline. No global index to race.
      if (existing && !existing.etag) throw new Error('SNAPSHOT_ETAG_MISSING')
      const result = await storage.setJSON(key, merged, existing ? { onlyIfMatch: existing.etag } : { onlyIfNew: true })
      if (result.modified) return
    }
    throw new Error('SNAPSHOT_WRITE_CONFLICT')
  }))
}

export async function loadBalanceSnapshots(storage = store()): Promise<MonthlyBalanceSnapshot[]> {
  const { blobs } = await storage.list({ prefix: 'months/' })
  const rows: MonthlyBalanceSnapshot[] = []
  for (let offset = 0; offset < blobs.length; offset += 12) {
    const batch = await Promise.all(blobs.slice(offset, offset + 12).map(({ key }) => storage.get(key, { type: 'json' })))
    rows.push(...batch.filter((row): row is MonthlyBalanceSnapshot => !!row))
  }
  return mergeSnapshotMonths([], rows)
}

export const saveSnapshotStatus = (status: SnapshotStatus, storage = store()) => storage.setJSON('status', status)
export const loadSnapshotStatus = async (storage = store()): Promise<SnapshotStatus | null> => storage.get('status', { type: 'json' })

export function snapshotFailureState(error: unknown): SnapshotStatus['state'] {
  return /NOT_CONNECTED|REFRESH_EXPIRED|Token refresh failed \((400|401)\)/.test(String(error)) ? 'reconnect' : 'error'
}
