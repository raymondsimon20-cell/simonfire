import { StrictMode } from 'react'
import { installChunkRecovery } from './lib/chunk-recovery'
import { createRoot } from 'react-dom/client'
import './index.css'
import { StoreProvider } from './lib/store'
import { ToastProvider } from './components/Toast'
import App from './App'
import { ConfirmProvider } from './components/ConfirmDialog'

// A deploy can replace the route chunks an already-open tab expects.
// Reload once, while preserving the original import rejection for React.
installChunkRecovery(window, {
  storage: () => window.sessionStorage,
  now: Date.now,
  reload: () => window.location.reload(),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider><StoreProvider><ConfirmProvider><App /></ConfirmProvider></StoreProvider></ToastProvider>
  </StrictMode>,
)
