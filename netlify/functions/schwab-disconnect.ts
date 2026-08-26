import { clearTokens, json } from './lib/schwab'

export default async () => {
  await clearTokens()
  return json({ ok: true })
}
