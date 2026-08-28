import { useEffect } from 'react'
import { Link, useRouteError } from 'react-router-dom'
import { CircleAlert, ArrowLeft } from 'lucide-react'
import { Button } from '../components/ui'

export default function NotFound() {
  const error = useRouteError() as { statusText?: string; message?: string } | undefined
  const message = error?.message || error?.statusText || ''
  const staleChunk = /dynamically imported module|failed to fetch.*module|importing a module script failed/i.test(message)
  useEffect(() => {
    if (!staleChunk) return
    const key = 'simonfire.chunk-reload'
    const last = Number(sessionStorage.getItem(key) ?? 0)
    if (Date.now() - last > 30_000) {
      sessionStorage.setItem(key, String(Date.now()))
      window.location.reload()
    }
  }, [staleChunk])
  return <div className="grid min-h-[65vh] place-items-center"><div className="max-w-md text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-[#c7a96b]/20 bg-[#c7a96b]/10 text-[#d8bd7a]"><CircleAlert /></div><div className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-faint">SimonFIRE</div><h1 className="mt-2 text-3xl font-semibold">{staleChunk ? 'Updating your session' : error ? 'Something went wrong' : 'Page not found'}</h1><p className="mt-2 text-sm text-muted">{staleChunk ? 'A new version was deployed. Reloading the latest portfolio experience…' : message || 'The portfolio page you requested does not exist.'}</p><Link to="/" className="mt-6 inline-block"><Button variant="primary"><ArrowLeft size={15} /> Return to overview</Button></Link></div></div>
}
