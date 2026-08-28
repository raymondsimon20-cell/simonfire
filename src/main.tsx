import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { StoreProvider } from './lib/store'
import { ToastProvider } from './components/Toast'
import App from './App'

// An open tab can outlive a Netlify deploy and request a hashed route chunk that
// no longer exists. Vite emits this event before surfacing the import error; one
// guarded reload fetches the current HTML/chunk manifest and recovers the route.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const key = 'simonfire.chunk-reload'
  const last = Number(sessionStorage.getItem(key) ?? 0)
  if (Date.now() - last > 30_000) {
    sessionStorage.setItem(key, String(Date.now()))
    window.location.reload()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider><StoreProvider><App /></StoreProvider></ToastProvider>
  </StrictMode>,
)
