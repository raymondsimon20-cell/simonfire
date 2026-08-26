import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, createHashRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import { StoreProvider } from './lib/store'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Positions from './pages/Positions'
import Transactions from './pages/Transactions'
import CashFlow from './pages/CashFlow'
import Dividends from './pages/Dividends'
import MonthClose from './pages/MonthClose'
import Ledger from './pages/Ledger'
import Connections from './pages/Connections'

// Use hash routing for the self-contained single-file demo (opened without a server),
// browser routing for the normal Netlify build.
const makeRouter = import.meta.env.VITE_SINGLEFILE ? createHashRouter : createBrowserRouter
const router = makeRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'positions', element: <Positions /> },
      { path: 'transactions', element: <Transactions /> },
      { path: 'cash-flow', element: <CashFlow /> },
      { path: 'dividends', element: <Dividends /> },
      { path: 'month-close', element: <MonthClose /> },
      { path: 'ledger', element: <Ledger /> },
      { path: 'connections', element: <Connections /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <RouterProvider router={router} />
    </StoreProvider>
  </StrictMode>,
)
