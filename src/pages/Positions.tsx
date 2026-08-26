import { useMemo, useState } from 'react'
import { Download, Search, DollarSign, Layers, TrendingUp, Trophy, ArrowUpDown } from 'lucide-react'
import { useScoped, useStore } from '../lib/store'
import { positionMetrics } from '../lib/calc'
import { usd, pct, num, intfmt, shortDate, posNeg } from '../lib/format'
import { KpiCard, PageHeader, Button } from '../components/ui'
import { PositionDrawer } from '../components/PositionDrawer'
import { downloadCsv } from '../lib/csv'
import type { Position } from '../lib/types'
import clsx from 'clsx'

type SortKey =
  | 'symbol'
  | 'shares'
  | 'price'
  | 'dayChange'
  | 'dayChangePct'
  | 'totalGain'
  | 'totalGainPct'
  | 'totalReturn'
  | 'totalReturnPct'
  | 'value'
  | 'weight'

export default function Positions() {
  const { data } = useStore()
  const { positions, accounts } = useScoped()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('value')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [selected, setSelected] = useState<Position | null>(null)

  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? ''

  const rows = useMemo(() => {
    const r = positions.map((p) => ({ p, m: positionMetrics(p) }))
    const total = r.reduce((s, x) => s + x.m.value, 0)
    const withWeight = r.map((x) => ({ ...x, weight: total ? x.m.value / total : 0 }))
    const filtered = withWeight.filter(
      (x) =>
        !query ||
        x.p.symbol.toLowerCase().includes(query.toLowerCase()) ||
        x.p.name.toLowerCase().includes(query.toLowerCase()),
    )
    const val = (x: (typeof withWeight)[number]) => {
      switch (sort) {
        case 'symbol':
          return x.p.symbol
        case 'shares':
          return x.p.shares
        case 'price':
          return x.p.lastPrice
        case 'dayChange':
          return x.m.dayChange
        case 'dayChangePct':
          return x.m.dayChangePct
        case 'totalGain':
          return x.m.totalGain
        case 'totalGainPct':
          return x.m.totalGainPct
        case 'totalReturn':
          return x.m.totalReturn
        case 'totalReturnPct':
          return x.m.totalReturnPct
        case 'weight':
          return x.weight
        default:
          return x.m.value
      }
    }
    filtered.sort((a, b) => {
      const av = val(a)
      const bv = val(b)
      if (typeof av === 'string' && typeof bv === 'string')
        return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    return { filtered, total }
  }, [positions, query, sort, dir])

  const totals = useMemo(() => {
    const m = positions.map(positionMetrics)
    return {
      value: m.reduce((s, x) => s + x.value, 0),
      dayChange: m.reduce((s, x) => s + x.dayChange, 0),
      totalGain: m.reduce((s, x) => s + x.totalGain, 0),
      totalReturn: m.reduce((s, x) => s + x.totalReturn, 0),
      cost: m.reduce((s, x) => s + x.costBasis, 0),
    }
  }, [positions])

  const top = useMemo(() => {
    let best: { symbol: string; value: number } | null = null
    for (const p of positions) {
      const v = p.shares * p.lastPrice
      if (!best || v > best.value) best = { symbol: p.symbol, value: v }
    }
    return best
  }, [positions])

  const toggle = (k: SortKey) => {
    if (sort === k) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(k)
      setDir('desc')
    }
  }

  const exportCsv = () => {
    const header = [
      'Holding',
      'Account',
      'Shares',
      'Price',
      'Day Chg $',
      'Day Chg %',
      'Total Gain $',
      'Total Gain %',
      'Total Return $',
      'Total Return %',
      'Value',
      '% of Portfolio',
    ]
    const body = rows.filtered.map((x) => [
      x.p.symbol,
      accName(x.p.accountId),
      x.p.shares,
      x.p.lastPrice,
      x.m.dayChange.toFixed(2),
      (x.m.dayChangePct * 100).toFixed(2),
      x.m.totalGain.toFixed(2),
      (x.m.totalGainPct * 100).toFixed(2),
      x.m.totalReturn.toFixed(2),
      (x.m.totalReturnPct * 100).toFixed(2),
      x.m.value.toFixed(2),
      (x.weight * 100).toFixed(2),
    ])
    downloadCsv('positions.csv', [header, ...body])
  }

  return (
    <div>
      <PageHeader
        title="Positions"
        subtitle={`As of ${shortDate(data.lastSyncAt.slice(0, 10))}`}
        right={
          <>
            <span className="hidden items-center gap-1.5 text-xs text-faint sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-[#3fd88a]" /> Prices as of Just now
            </span>
            <Button onClick={exportCsv}>
              <Download size={15} /> Export CSV
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Value" value={usd(totals.value)} icon={<DollarSign size={20} />} tile="green" />
        <KpiCard label="Positions" value={intfmt(positions.length)} icon={<Layers size={20} />} tile="blue" />
        <KpiCard
          label="Unique Symbols"
          value={intfmt(new Set(positions.map((p) => p.symbol)).size)}
          icon={<TrendingUp size={20} />}
          tile="purple"
        />
        <KpiCard
          label="Top Position"
          value={top?.symbol ?? '—'}
          sub={top ? usd(top.value) : ''}
          icon={<Trophy size={20} />}
          tile="orange"
        />
      </div>

      <div className="card mt-4 flex flex-wrap items-center gap-3 p-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol…"
            className="w-56 rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand"
          />
        </div>
        <div className="text-xs text-faint">
          {rows.filtered.length} of {positions.length} holdings
        </div>
      </div>

      <div className="card mt-4 overflow-x-auto p-0">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-border-soft text-left text-xs text-muted">
              <Th onClick={() => toggle('symbol')} active={sort === 'symbol'}>Holding</Th>
              <th className="px-4 py-3 font-medium">Account</th>
              <Th onClick={() => toggle('shares')} active={sort === 'shares'} right>Shares / Contracts</Th>
              <Th onClick={() => toggle('price')} active={sort === 'price'} right>Price</Th>
              <Th onClick={() => toggle('dayChange')} active={sort === 'dayChange'} right>Day Chg $</Th>
              <Th onClick={() => toggle('dayChangePct')} active={sort === 'dayChangePct'} right>Day Chg %</Th>
              <Th onClick={() => toggle('totalGain')} active={sort === 'totalGain'} right>Total Gain $</Th>
              <Th onClick={() => toggle('totalGainPct')} active={sort === 'totalGainPct'} right>Total Gain %</Th>
              <Th onClick={() => toggle('totalReturn')} active={sort === 'totalReturn'} right>Total Return $</Th>
              <Th onClick={() => toggle('totalReturnPct')} active={sort === 'totalReturnPct'} right>Total Return %</Th>
              <Th onClick={() => toggle('value')} active={sort === 'value'} right>Value</Th>
              <Th onClick={() => toggle('weight')} active={sort === 'weight'} right>%</Th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border-soft bg-surface-2/40 font-semibold">
              <td className="px-4 py-3" colSpan={4}>
                Portfolio Total
              </td>
              <td className={clsx('num px-4 py-3 text-right', posNeg(totals.dayChange))}>
                {usd(totals.dayChange, { sign: true })}
              </td>
              <td className={clsx('num px-4 py-3 text-right', posNeg(totals.dayChange))}>
                {pct((totals.dayChange / (totals.value - totals.dayChange)) * 100, { sign: true })}
              </td>
              <td className={clsx('num px-4 py-3 text-right', posNeg(totals.totalGain))}>
                {usd(totals.totalGain, { sign: true })}
              </td>
              <td className={clsx('num px-4 py-3 text-right', posNeg(totals.totalGain))}>
                {pct((totals.totalGain / totals.cost) * 100, { sign: true })}
              </td>
              <td className={clsx('num px-4 py-3 text-right', posNeg(totals.totalReturn))}>
                {usd(totals.totalReturn, { sign: true })}
              </td>
              <td className={clsx('num px-4 py-3 text-right', posNeg(totals.totalReturn))}>
                {pct((totals.totalReturn / totals.cost) * 100, { sign: true })}
              </td>
              <td className="num px-4 py-3 text-right">{usd(totals.value)}</td>
              <td className="num px-4 py-3 text-right">100%</td>
            </tr>
            {rows.filtered.map(({ p, m, weight }) => (
              <tr
                key={p.id}
                onClick={() => setSelected(p)}
                className="cursor-pointer border-b border-border-soft hover:bg-surface-2/40"
              >
                <td className="px-4 py-3">
                  <div className="font-semibold">{p.symbol}</div>
                  <div className="max-w-[180px] truncate text-xs text-faint">{p.name}</div>
                </td>
                <td className="px-4 py-3 text-xs text-muted">{accName(p.accountId)}</td>
                <td className="num px-4 py-3 text-right">{num(p.shares)}</td>
                <td className="num px-4 py-3 text-right">{usd(p.lastPrice)}</td>
                <td className={clsx('num px-4 py-3 text-right', posNeg(m.dayChange))}>{usd(m.dayChange, { sign: true })}</td>
                <td className={clsx('num px-4 py-3 text-right', posNeg(m.dayChange))}>{pct(m.dayChangePct * 100, { sign: true })}</td>
                <td className={clsx('num px-4 py-3 text-right', posNeg(m.totalGain))}>{usd(m.totalGain, { sign: true })}</td>
                <td className={clsx('num px-4 py-3 text-right', posNeg(m.totalGain))}>{pct(m.totalGainPct * 100, { sign: true })}</td>
                <td className={clsx('num px-4 py-3 text-right', posNeg(m.totalReturn))}>{usd(m.totalReturn, { sign: true })}</td>
                <td className={clsx('num px-4 py-3 text-right', posNeg(m.totalReturn))}>{pct(m.totalReturnPct * 100, { sign: true })}</td>
                <td className="num px-4 py-3 text-right font-semibold">{usd(m.value)}</td>
                <td className="num px-4 py-3 text-right text-muted">{pct(weight * 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PositionDrawer position={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function Th({
  children,
  onClick,
  active,
  right,
}: {
  children: React.ReactNode
  onClick: () => void
  active: boolean
  right?: boolean
}) {
  return (
    <th
      onClick={onClick}
      className={clsx(
        'cursor-pointer select-none px-4 py-3 font-medium hover:text-ink',
        right && 'text-right',
        active && 'text-ink',
      )}
    >
      <span className={clsx('inline-flex items-center gap-1', right && 'flex-row-reverse')}>
        {children}
        <ArrowUpDown size={11} className={active ? 'text-brand' : 'text-faint'} />
      </span>
    </th>
  )
}
