// Receives the OAuth redirect from Schwab, exchanges the code for tokens,
// stores them (Netlify Blobs), then sends the browser back into the app.
import { exchangeCode } from './lib/schwab'

// Serve at /api/auth/callback — an already-approved Schwab callback URL — so no
// new callback registration (and its ~24h activation delay) is needed.
export const config = { path: '/api/auth/callback' }

export default async (req: Request) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const back = `${url.origin}/connections`
  if (!code) {
    return new Response(null, { status: 302, headers: { Location: `${back}?connected=error` } })
  }
  try {
    await exchangeCode(code)
    return new Response(null, { status: 302, headers: { Location: `${back}?connected=1` } })
  } catch (e) {
    return new Response(null, { status: 302, headers: { Location: `${back}?connected=error` } })
  }
}
