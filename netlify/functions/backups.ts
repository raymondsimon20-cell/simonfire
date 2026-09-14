import { getStore } from '@netlify/blobs'
import { json } from './lib/schwab'

const store = () => getStore('simonfire-backups')
const indexKey = 'index-v1'

export default async (request: Request) => {
  if (request.method === 'GET') {
    const index = await store().get(indexKey, { type: 'json' }).catch(() => []) as any[]
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return json({ ok: true, backups: index })
    const backup = await store().get(`backup-${id}`, { type: 'json' }).catch(() => null)
    return backup ? json({ ok: true, backup }) : json({ ok: false, error: 'not_found' }, 404)
  }
  if (request.method === 'POST') {
    const length = Number(request.headers.get('content-length') ?? 0)
    if (length > 6_000_000) return json({ ok: false, error: 'payload_too_large' }, 413)
    const body = await request.json().catch(() => null)
    if (!body?.data || body.data.version !== 1) return json({ ok: false, error: 'invalid_backup' }, 400)
    const id = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
    const metadata = { id, createdAt: new Date().toISOString(), reason: String(body.reason ?? 'Automatic backup').slice(0, 80), positions: body.data.positions?.length ?? 0, transactions: body.data.transactions?.length ?? 0 }
    const index = await store().get(indexKey, { type: 'json' }).catch(() => []) as any[]
    const next = [metadata, ...index].slice(0, 7)
    await store().setJSON(`backup-${id}`, body.data)
    await store().setJSON(indexKey, next)
    for (const old of index.slice(6)) await store().delete(`backup-${old.id}`).catch(() => undefined)
    return json({ ok: true, backup: metadata })
  }
  return json({ ok: false, error: 'method_not_allowed' }, 405)
}
