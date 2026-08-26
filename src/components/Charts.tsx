import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { usd } from '../lib/format'

const POS = '#34d17d'
const NEG = '#f2607a'
const BASE = '#4a86f0'

const axisStyle = { fill: '#5c6a80', fontSize: 11 }

function money(v: number) {
  const a = Math.abs(v)
  if (a >= 1000) return `$${(v / 1000).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-[--color-border] bg-[--color-surface] px-3 py-2 text-xs shadow-xl">
      <div className="mb-0.5 text-[--color-muted]">{label}</div>
      <div className="num font-semibold">{usd(payload[0].value)}</div>
    </div>
  )
}

// Daily / monthly signed bars (green up, red down)
export function SignedBars({
  data,
  xKey,
  yKey,
  height = 260,
}: {
  data: any[]
  xKey: string
  yKey: string
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <XAxis dataKey={xKey} tick={axisStyle} axisLine={false} tickLine={false} minTickGap={20} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={money} width={48} />
        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip />} />
        <ReferenceLine y={0} stroke="#222c3f" />
        <Bar dataKey={yKey} radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d[yKey] >= 0 ? POS : NEG} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// Positive-only monthly bars (projected income)
export function PositiveBars({
  data,
  xKey,
  yKey,
  height = 260,
}: {
  data: any[]
  xKey: string
  yKey: string
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <XAxis dataKey={xKey} tick={axisStyle} axisLine={false} tickLine={false} minTickGap={8} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={money} width={48} />
        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip />} />
        <Bar dataKey={yKey} radius={[4, 4, 0, 0]} fill={BASE} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// Waterfall / equity-change bridge.
export interface BridgeStep {
  label: string
  value: number
  kind: 'base' | 'up' | 'down' | 'total'
}

export function Waterfall({ steps, height = 300 }: { steps: BridgeStep[]; height?: number }) {
  // Compute floating bar ranges.
  let running = 0
  const rows = steps.map((s) => {
    if (s.kind === 'base' || s.kind === 'total') {
      const row = { ...s, start: 0, end: s.value, base: 0, bar: s.value }
      running = s.value
      return row
    }
    const start = running
    const end = running + s.value
    running = end
    return { ...s, start, end, base: Math.min(start, end), bar: Math.abs(s.value) }
  })

  const colorOf = (k: BridgeStep['kind']) =>
    k === 'base' || k === 'total' ? BASE : k === 'up' ? POS : NEG

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
        <XAxis dataKey="label" tick={axisStyle} axisLine={false} tickLine={false} interval={0} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={money} width={52} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          content={({ active, payload }: any) => {
            if (!active || !payload?.length) return null
            const r = payload[0].payload
            return (
              <div className="rounded-lg border border-[--color-border] bg-[--color-surface] px-3 py-2 text-xs shadow-xl">
                <div className="mb-0.5 text-[--color-muted]">{r.label}</div>
                <div className="num font-semibold">{usd(r.value)}</div>
              </div>
            )
          }}
        />
        {/* transparent spacer to float the visible bar */}
        <Bar dataKey="base" stackId="a" fill="transparent" />
        <Bar dataKey="bar" stackId="a" radius={[3, 3, 0, 0]}>
          {rows.map((r, i) => (
            <Cell key={i} fill={colorOf(r.kind)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
