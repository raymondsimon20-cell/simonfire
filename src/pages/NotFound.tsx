import { useEffect } from 'react'
import { Link, useRouteError } from 'react-router-dom'
import { CircleAlert, ArrowLeft } from 'lucide-react'
import { Button } from '../components/ui'
import { attemptChunkReload, isChunkLoadError } from '../lib/chunk-recovery'

export default function NotFound() {
  const error = useRouteError() as { statusText?: string; message?: string } | undefined
  const message = error?.message || error?.statusText || ''
  const staleChunk = isChunkLoadError(message)
  useEffect(() => {
    if (staleChunk) attemptChunkReload({storage:()=>window.sessionStorage, now:Date.now, reload:()=>window.location.reload()})
  }, [staleChunk])
  return <div className="grid min-h-[65vh] place-items-center"><div className="max-w-md text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-[#c7a96b]/20 bg-[#c7a96b]/10 text-[#d8bd7a]"><CircleAlert /></div><div className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-faint">SimonFIRE</div><h1 className="mt-2 text-3xl font-semibold">{staleChunk ? 'This page needs a refresh' : error ? 'Something went wrong' : 'Page not found'}</h1><p className="mt-2 text-sm text-muted">{staleChunk ? 'A page update could not finish loading. Reload the latest version to continue.' : message || 'The portfolio page you requested does not exist.'}</p>{error && <div className="mt-6"><Button variant="primary" onClick={()=>window.location.reload()}>Reload latest version</Button></div>}<Link to="/" className="mt-4 inline-block"><Button variant="primary"><ArrowLeft size={15} /> Return to overview</Button></Link></div></div>
}
