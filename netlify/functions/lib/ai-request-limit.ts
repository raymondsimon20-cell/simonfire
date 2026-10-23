interface UsageStore {
  getWithMetadata(key: string, options: { type: 'json' }): Promise<{ data: { count?: unknown }; etag?: string } | null>
  setJSON(key: string, value: unknown, options: { onlyIfMatch: string; onlyIfNew?: never } | { onlyIfNew: true; onlyIfMatch?: never }): Promise<{ modified: boolean }>
}
export async function reserveAiRequest(storage: UsageStore, limit: number, day = new Date().toISOString().slice(0, 10)) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await storage.getWithMetadata(day, { type: 'json' })
    const count = Number(current?.data?.count ?? 0)
    if (!Number.isSafeInteger(count) || count < 0 || count >= limit || (current && !current.etag)) return false
    const result = await storage.setJSON(day, { count: count + 1 }, current ? { onlyIfMatch: current.etag! } : { onlyIfNew: true })
    if (result.modified) return true
  }
  return false
}
