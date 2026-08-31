import { getStore } from '@netlify/blobs'
import { json } from './lib/schwab'

type SharedPreferences = {
  bucketOverrides?: Record<string, string>
  tagRules?: unknown[]
  targetAlloc?: Record<string, number>
  keepList?: string[]
  soldSymbols?: string[]
}

const store = () => getStore('simonfire')
const KEY = 'preferences-v1'
const allowed = new Set(['Growth', 'CEFs', 'High Yield', 'Leveraged'])

function clean(input: any): SharedPreferences {
  const bucketOverrides = Object.fromEntries(
    Object.entries(input?.bucketOverrides ?? {})
      .filter(([key, value]) => key.length <= 160 && allowed.has(String(value)))
      .slice(0, 2_000),
  )
  const tagRules = Array.isArray(input?.tagRules) ? input.tagRules
    .filter((rule: any) => rule && typeof rule === 'object' && typeof rule.id === 'string' && typeof rule.contains === 'string' && typeof rule.tag === 'string' && typeof rule.enabled === 'boolean')
    .slice(0, 500)
    .map((rule: any) => ({
      id: rule.id.slice(0, 80),
      contains: rule.contains.slice(0, 300),
      tag: rule.tag.slice(0, 100),
      ...(typeof rule.setType === 'string' ? { setType: rule.setType.slice(0, 40) } : {}),
      ...(['positive', 'negative', 'zero'].includes(rule.amountDirection) ? { amountDirection: rule.amountDirection } : {}),
      enabled: rule.enabled,
    })) : []
  const targetAlloc = Object.fromEntries(
    Object.entries(input?.targetAlloc ?? {})
      .filter(([, value]) => Number.isFinite(value) && Number(value) >= 0 && Number(value) <= 100)
      .slice(0, 20),
  ) as Record<string, number>
  const strings = (value: unknown, limit: number) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length <= 160).slice(0, limit)
    : []
  return {
    bucketOverrides,
    tagRules,
    targetAlloc,
    keepList: strings(input?.keepList, 2_000),
    soldSymbols: strings(input?.soldSymbols, 2_000),
  }
}

export default async (request: Request) => {
  if (request.method === 'GET') {
    const preferences = await store().get(KEY, { type: 'json' }).catch(() => null)
    return json({ ok: true, preferences })
  }
  if (request.method === 'PUT') {
    const length = Number(request.headers.get('content-length') ?? 0)
    if (length > 500_000) return json({ ok: false, error: 'payload_too_large' }, 413)
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return json({ ok: false, error: 'invalid_body' }, 400)
    const preferences = clean(body)
    await store().setJSON(KEY, preferences)
    return json({ ok: true, preferences })
  }
  return json({ ok: false, error: 'method_not_allowed' }, 405)
}
