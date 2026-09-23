import { getStore } from '@netlify/blobs'
import type { DividendLookupCache } from './dividend-api'
import type { DividendPreferences } from './dividend-preferences'

const storage = () => getStore({ name: 'simonfire', consistency: 'strong' })
const CACHE_KEY = 'dividend-lookups-v1'

export function mergeDividendLookupCache(current: DividendLookupCache = {}, incoming: DividendLookupCache = {}, now = Date.now()): DividendLookupCache {
  const merged = { ...current }
  for (const [key, value] of Object.entries(incoming)) {
    if (!merged[key] || value.expiresAt > merged[key].expiresAt) merged[key] = value
  }
  return Object.fromEntries(Object.entries(merged)
    .filter(([key, entry]) => /^[a-f0-9]{64}$/.test(key) && entry?.expiresAt > now && entry.result && !entry.result.failed && !entry.result.limited)
    .sort((a, b) => b[1].expiresAt - a[1].expiresAt).slice(0, 6_000))
}

export async function loadDividendSyncContext() {
  const store = storage()
  const [preferences, cached] = await Promise.all([
    store.get('preferences-v1', { type: 'json' }).catch(() => null),
    store.get(CACHE_KEY, { type: 'json' }).catch(() => null),
  ])
  return { preferences: (preferences ?? {}) as DividendPreferences, lookupCache: mergeDividendLookupCache({}, cached ?? {}) }
}

export async function saveDividendLookupCache(cache: DividendLookupCache) {
  if (!Object.keys(cache).length) return
  const store = storage()
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await store.getWithMetadata(CACHE_KEY, { type: 'json' })
    if (current && !current.etag) return
    const merged = mergeDividendLookupCache(current?.data, cache)
    const result = await store.setJSON(CACHE_KEY, merged, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true })
    if (result.modified) return
  }
}
