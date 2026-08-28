import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { StoreProvider } from './lib/store'
import { ToastProvider } from './components/Toast'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider><StoreProvider><App /></StoreProvider></ToastProvider>
  </StrictMode>,
)
