const reloadKey = 'simonfire.chunk-reload'
interface RecoveryEnvironment {
  storage: () => Pick<Storage, 'getItem' | 'setItem'>
  now: () => number
  reload: () => void
}
export function isChunkLoadError(message: string) {
  return /dynamically imported module|failed to fetch.*module|importing a module script failed|unable to preload css|_result is undefined|cannot read properties of undefined \(reading ['"]default['"]\)/i.test(message)
}
export function attemptChunkReload(environment: RecoveryEnvironment) {
  try {
    const storage = environment.storage()
    const now = environment.now()
    const last = Number(storage.getItem(reloadKey) ?? 0)
    if (Number.isFinite(last) && now - last <= 30000) return false
    // Persist the guard before navigating. If storage is blocked, let the user
    // reload explicitly rather than risking a loop on every new page load.
    storage.setItem(reloadKey, String(now))
    environment.reload()
    return true
  } catch { return false }
}
export function installChunkRecovery(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, environment: RecoveryEnvironment) {
  // Never preventDefault: Vite must reject its import promise. Canceling the
  // event resolves that promise as undefined, which crashes React.lazy.
  const onError = () => { attemptChunkReload(environment) }
  target.addEventListener('vite:preloadError', onError)
  return () => target.removeEventListener('vite:preloadError', onError)
}
