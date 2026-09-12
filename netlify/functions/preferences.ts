import { getStore } from '@netlify/blobs'
import { json } from './lib/schwab'

type SharedPreferences = {
  bucketOverrides?: Record<string, string>
  tagRules?: unknown[]
  symbolRules?: unknown[]
  targetAlloc?: Record<string, number>
  keepList?: string[]
  soldSymbols?: string[]
  incomePlan?: {
    annualW2Target: number
    monthlySpending: number
    estimatedTaxRate: number
    distributionCutPct: number
    cashReserveMonths: number
  }
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
  const symbolRules = Array.isArray(input?.symbolRules) ? input.symbolRules
    .filter((rule: any) => rule && typeof rule.id === 'string' && typeof rule.contains === 'string' && typeof rule.symbol === 'string')
    .slice(0, 500)
    .map((rule: any) => ({ id: rule.id.slice(0, 80), contains: rule.contains.slice(0, 300), symbol: rule.symbol.replace(/[^A-Za-z0-9./-]/g, '').toUpperCase().slice(0, 20), ...(typeof rule.accountId === 'string' ? { accountId: rule.accountId.slice(0, 80) } : {}) })) : []
  const targetAlloc = Object.fromEntries(
    Object.entries(input?.targetAlloc ?? {})
      .filter(([, value]) => Number.isFinite(value) && Number(value) >= 0 && Number(value) <= 100)
      .slice(0, 20),
  ) as Record<string, number>
  const strings = (value: unknown, limit: number) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length <= 160).slice(0, limit)
    : []
  const numberIn = (value: unknown, min: number, max: number, fallback: number) => {
    const number = Number(value)
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
  }
  const rawPlan = input?.incomePlan
  const incomePlan = rawPlan && typeof rawPlan === 'object' ? {
    annualW2Target: numberIn(rawPlan.annualW2Target, 0, 10_000_000, 0),
    monthlySpending: numberIn(rawPlan.monthlySpending, 0, 1_000_000, 0),
    estimatedTaxRate: numberIn(rawPlan.estimatedTaxRate, 0, 60, 20),
    distributionCutPct: numberIn(rawPlan.distributionCutPct, 0, 100, 20),
    cashReserveMonths: numberIn(rawPlan.cashReserveMonths, 0, 60, 6),
  } : undefined
  return {
    bucketOverrides,
    tagRules,
    symbolRules,
    targetAlloc,
    keepList: strings(input?.keepList, 2_000),
    soldSymbols: strings(input?.soldSymbols, 2_000),
    incomePlan,
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
