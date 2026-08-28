import { Link, useRouteError } from 'react-router-dom'
import { CircleAlert, ArrowLeft } from 'lucide-react'
import { Button } from '../components/ui'

export default function NotFound() {
  const error = useRouteError() as { statusText?: string; message?: string } | undefined
  return <div className="grid min-h-[65vh] place-items-center"><div className="max-w-md text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-[#c7a96b]/20 bg-[#c7a96b]/10 text-[#d8bd7a]"><CircleAlert /></div><div className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-faint">SimonFIRE</div><h1 className="mt-2 text-3xl font-semibold">{error ? 'Something went wrong' : 'Page not found'}</h1><p className="mt-2 text-sm text-muted">{error?.statusText || error?.message || 'The portfolio page you requested does not exist.'}</p><Link to="/" className="mt-6 inline-block"><Button variant="primary"><ArrowLeft size={15} /> Return to overview</Button></Link></div></div>
}
