import { accessToken, API_BASE, json } from './lib/schwab'
import { schwabProtectionData } from '../../src/lib/schwab-protection-data'
export default async (request: Request) => {
  if (request.method !== 'GET') return json({ok:false,error:'method_not_allowed'},405)
  try {
    const token = await accessToken()
    const response = await fetch(`${API_BASE}/accounts?fields=positions`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error('Schwab unavailable')
    return json({ok:true, fetchedAt:new Date().toISOString(), accounts:schwabProtectionData(await response.json())})
  } catch { return json({ok:false,error:'Schwab risk data is unavailable. Check the Schwab connection and retry.'},503) }
}
