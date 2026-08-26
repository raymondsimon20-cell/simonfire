// Redirects the browser to Schwab's OAuth consent screen.
import { authorizeUrl, env } from './lib/schwab'

export default async () => {
  const { appKey, callback } = env()
  if (!appKey || !callback) {
    return new Response('Schwab is not configured (missing SCHWAB_APP_KEY / SCHWAB_CALLBACK_URL).', { status: 500 })
  }
  return new Response(null, { status: 302, headers: { Location: authorizeUrl() } })
}
