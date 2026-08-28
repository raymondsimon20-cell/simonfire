import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, createHashRouter, RouterProvider } from 'react-router-dom'
import Layout from './components/Layout'
import { PageSkeleton } from './components/Toast'
import NotFound from './pages/NotFound'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Positions = lazy(() => import('./pages/Positions'))
const Transactions = lazy(() => import('./pages/Transactions'))
const CashFlow = lazy(() => import('./pages/CashFlow'))
const Dividends = lazy(() => import('./pages/Dividends'))
const MonthClose = lazy(() => import('./pages/MonthClose'))
const Ledger = lazy(() => import('./pages/Ledger'))
const Connections = lazy(() => import('./pages/Connections'))
const AccountDetail = lazy(() => import('./pages/AccountDetail'))
const Allocation = lazy(() => import('./pages/Allocation'))
const StrategyLab = lazy(() => import('./pages/StrategyLab'))
const page = (node: ReactNode) => <Suspense fallback={<PageSkeleton />}>{node}</Suspense>
const makeRouter = import.meta.env.VITE_SINGLEFILE ? createHashRouter : createBrowserRouter
const router = makeRouter([{ path: '/', element: <Layout />, errorElement: <NotFound />, children: [
  { index: true, element: page(<Dashboard />) }, { path: 'positions', element: page(<Positions />) },
  { path: 'account/:id', element: page(<AccountDetail />) }, { path: 'allocation', element: page(<Allocation />) },
  { path: 'transactions', element: page(<Transactions />) }, { path: 'cash-flow', element: page(<CashFlow />) },
  { path: 'dividends', element: page(<Dividends />) }, { path: 'month-close', element: page(<MonthClose />) },
  { path: 'ledger', element: page(<Ledger />) }, { path: 'connections', element: page(<Connections />) },
  { path: 'strategy-lab', element: page(<StrategyLab />) },
  { path: '*', element: <NotFound /> },
] }])

export default function App() { return <RouterProvider router={router} /> }
