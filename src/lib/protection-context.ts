import type { Account, Position } from './types'

/** Short fingerprint of the holdings a protection review was built from. A
 * saved review only feeds the AI allocation review while this still matches. */
export function protectionContextKey(scope: string, positions: Position[], accounts: Account[]): string {
  const text = JSON.stringify({ scope, positions, accounts })
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  return `${text.length}:${(hash >>> 0).toString(36)}`
}
