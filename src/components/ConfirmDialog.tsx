import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import { Button } from './ui'

type Request = { title: string; message: string; confirmLabel: string; tone?: 'normal' | 'danger'; input?: { label: string; initial?: string }; resolve: (value: string | boolean | null) => void }
const Context = createContext<{ confirm: (title: string, message: string, confirmLabel?: string) => Promise<boolean>; prompt: (title: string, message: string, label: string, initial?: string) => Promise<string | null> } | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null)
  const [value, setValue] = useState('')
  const finish = (result: string | boolean | null) => { request?.resolve(result); setRequest(null); setValue('') }
  const api = useMemo(() => ({
    confirm: (title: string, message: string, confirmLabel = 'Confirm') => new Promise<boolean>((resolve) => setRequest({ title, message, confirmLabel, resolve: (result) => resolve(result === true) })),
    prompt: (title: string, message: string, label: string, initial = '') => new Promise<string | null>((resolve) => { setValue(initial); setRequest({ title, message, confirmLabel: 'Save', input: { label, initial }, resolve: (result) => resolve(typeof result === 'string' ? result : null) }) }),
  }), [])
  return <Context.Provider value={api}>{children}<Modal open={!!request} onClose={() => finish(null)} title={request?.title ?? ''} subtitle={request?.message} footer={<><Button onClick={() => finish(null)}>Cancel</Button><Button variant="primary" disabled={!!request?.input && !value.trim()} onClick={() => finish(request?.input ? value.trim() : true)}>{request?.confirmLabel}</Button></>}>{request?.input && <label className="text-xs text-muted"><span>{request.input.label}</span><input autoFocus value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && value.trim()) finish(value.trim()) }} className="mt-2 w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:border-brand"/></label>}</Modal></Context.Provider>
}

export function useConfirmDialog() { const context = useContext(Context); if (!context) throw new Error('useConfirmDialog must be inside ConfirmProvider'); return context }
