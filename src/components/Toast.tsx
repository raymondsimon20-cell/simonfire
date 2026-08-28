import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react'
import clsx from 'clsx'

type Tone = 'success' | 'error' | 'info'
type ToastItem = { id: number; message: string; detail?: string; tone: Tone }
const ToastCtx = createContext<{ push: (message: string, tone?: Tone, detail?: string) => void } | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), [])
  const push = useCallback((message: string, tone: Tone = 'success', detail?: string) => {
    const id = Date.now() + Math.random()
    setItems((all) => [...all.slice(-3), { id, message, detail, tone }])
    window.setTimeout(() => dismiss(id), 4200)
  }, [dismiss])
  const value = useMemo(() => ({ push }), [push])
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[200] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {items.map((t) => {
          const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? CircleAlert : Info
          return (
            <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-white/10 bg-[#11161e]/95 p-3.5 shadow-2xl backdrop-blur-xl fadein">
              <Icon size={18} className={clsx('mt-0.5 shrink-0', t.tone === 'success' ? 'text-pos' : t.tone === 'error' ? 'text-neg' : 'text-[#d8bd7a]')} />
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">{t.message}</div>{t.detail && <div className="mt-0.5 text-xs text-muted">{t.detail}</div>}</div>
              <button onClick={() => dismiss(t.id)} className="text-faint hover:text-ink" aria-label="Dismiss notification"><X size={15} /></button>
            </div>
          )
        })}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}

export function PageSkeleton() {
  return <div className="space-y-5 animate-pulse"><div className="h-10 w-64 rounded-xl bg-white/[0.05]" /><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0,1,2,3].map((i) => <div key={i} className="h-36 rounded-[18px] bg-white/[0.035]" />)}</div><div className="h-80 rounded-[18px] bg-white/[0.035]" /></div>
}
