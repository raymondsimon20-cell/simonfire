// Client for the Schwab Netlify Functions. These only exist when deployed to
// Netlify (or running `netlify dev`); in a plain Vite/demo build the calls fail
// gracefully and the UI falls back to CSV import.
import type { ImportPayload } from './store'

const FN = '/.netlify/functions'

export const schwabLoginUrl = `${FN}/schwab-login`

export interface SchwabStatus {
  connected: boolean
  needsReconnect?: boolean
}

export async function schwabStatus(): Promise<SchwabStatus> {
  try {
    const r = await fetch(`${FN}/schwab-status`)
    if (!r.ok) return { connected: false }
    return (await r.json()) as SchwabStatus
  } catch {
    return { connected: false }
  }
}

export interface SyncResult {
  ok: boolean
  error?: string
  payload?: ImportPayload
}

export async function schwabSync(): Promise<SyncResult> {
  try {
    const r = await fetch(`${FN}/schwab-sync`)
    const d = await r.json().catch(() => ({ ok: false, error: 'bad_response' }))
    if (!d.ok) return { ok: false, error: d.error || `HTTP ${r.status}` }
    return {
      ok: true,
      payload: {
        accounts: d.accounts,
        positions: d.positions,
        transactions: d.transactions,
        broker: d.broker || 'Schwab',
      },
    }
  } catch {
    return { ok: false, error: 'unreachable' }
  }
}

export async function schwabDisconnect(): Promise<void> {
  try {
    await fetch(`${FN}/schwab-disconnect`, { method: 'POST' })
  } catch {
    /* ignore */
  }
}
