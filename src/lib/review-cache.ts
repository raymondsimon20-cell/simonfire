export interface ReviewStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function readReviewCache<T>(storage: ReviewStorage | null, key: string, fallback: T): T {
  try {
    const raw = storage?.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (parsed?.version !== 1 || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return fallback
    return parsed.value as T
  } catch { return fallback }
}
export function writeReviewCache(storage: ReviewStorage | null, key: string, value: unknown) {
  try { if (!storage) return false; storage.setItem(key, JSON.stringify({ version: 1, value })); return true } catch { return false }
}
