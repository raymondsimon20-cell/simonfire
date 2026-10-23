import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import { readReviewCache, writeReviewCache } from './review-cache'
function storage() { try { return window.localStorage } catch { return null } }
// Use a stable storage key; account/source scopes live inside the saved record.
export function useReviewCache<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readReviewCache(storage(), key, fallback))
  const latest = useRef(value)
  const initial = useRef(fallback)
  const [saveError, setSaveError] = useState(false)
  const update = useCallback((action: SetStateAction<T>) => {
    const next = typeof action === 'function' ? (action as (value: T) => T)(latest.current) : action
    // Write before updating React so immediate navigation/reload cannot lose it.
    const saved = writeReviewCache(storage(), key, next)
    latest.current = next
    setValue(next)
    setSaveError(!saved)
  }, [key])
  useEffect(() => {
    const receive = (event: StorageEvent) => {
      if (event.key !== key) return
      const next = readReviewCache(storage(), key, initial.current)
      latest.current = next; setValue(next)
    }
    window.addEventListener('storage', receive)
    return () => window.removeEventListener('storage', receive)
  }, [key])
  return [value, update, saveError] as const
}
