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
const BASE = '#c7a96b'

const axisStyle = { fill: '#697485', fontSize: 11 }

function money(v: number) {
  const a = Math.abs(v)
  if (a >= 1000) return `$${(v / 1000).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

// Round down to a "nice" axis value (e.g. 71,340 -> 70,000).
function niceFloor(v: number) {
  if (v <= 0) return 0
  const mag = 10 ** Math.floor(Math.log10(v))
  const step = mag >= 10_000 ? mag / 2 : mag
  return Math.floor(v / step) * step
}

// Short labels stay legible on mobile. Full names remain in the tooltip,
// accessible summary, and clickable breakdown below the chart.
function WrappedTick({ x, y, payload }: any) {
  const text = String(payload?.value ?? '')
  const labels: Record<string, string> = { Opening: 'Open', Deposits: 'In', Withdrawals: 'Out', 'Income less expenses': 'Income', 'Market change': 'Market', 'Market & other (est.)': 'Market', Closing: 'Close', 'Contrib.': 'In', 'Net Oper.': 'Cash', 'Realized P/L': 'P/L', 'Realized P/L (est.)': 'P/L', 'Mkt & Other': 'Market' }
  return <text x={x} y={y + 14} textAnchor="middle" fill="#8792a2" fontSize={10}>{labels[text] ?? text}</text>
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-white/10 bg-[#10151d]/95 px-3 py-2 text-xs shadow-2xl backdrop-blur-xl">
      <div className="mb-0.5 text-muted">{label}</div>
      <div className="num font-semibold">{usd(payload[0].value)}</div>
    </div>
  )
}

function ChartSummary({ data, xKey, yKey, label }: { data: any[]; xKey: string; yKey: string; label: string }) {
  return <p className="sr-only">{label}. {data.map((row) => `${row[xKey]}: ${usd(Number(row[yKey]) || 0)}`).join('; ')}</p>
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
  return (<>
    <ChartSummary data={data} xKey={xKey} yKey={yKey} label="Signed value chart"/>
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <XAxis dataKey={xKey} tick={axisStyle} axisLine={false} tickLine={false} minTickGap={20} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={money} width={48} />
        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip />} />
        <ReferenceLine y={0} stroke="#252c37" />
        <Bar dataKey={yKey} radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d[yKey] >= 0 ? POS : NEG} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer></>)
}

// Positive-only monthly bars (projected income)
export function PositiveBars({
  data,
  xKey,
  yKey,
  height = 260,
  color = BASE,
}: {
  data: any[]
  xKey: string
  yKey: string
  height?: number
  color?: string
}) {
  return (<>
    <ChartSummary data={data} xKey={xKey} yKey={yKey} label="Monthly value chart"/>
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <XAxis dataKey={xKey} tick={axisStyle} axisLine={false} tickLine={false} minTickGap={8} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={money} width={48} />
        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip />} />
        <Bar dataKey={yKey} radius={[4, 4, 0, 0]} fill={color} />
      </BarChart>
    </ResponsiveContainer></>)
}

// Waterfall / equity-change bridge.
export interface BridgeStep {
  label: string
  value: number
  kind: 'base' | 'up' | 'down' | 'total'
}

export function Waterfall({ steps, height = 300, onStepClick }: { steps: BridgeStep[]; height?: number; onStepClick?: (index: number) => void }) {
  // Compute floating bar ranges.
  const rows = steps.reduce<(BridgeStep & { start: number; end: number; base: number; bar: number })[]>((result, step) => {
    const total = step.kind === 'base' || step.kind === 'total'
    const start = total ? 0 : result.at(-1)?.end ?? 0
    const end = total ? step.value : start + step.value
    result.push({ ...step, start, end, base: total ? 0 : Math.min(start, end), bar: total ? step.value : Math.abs(step.value) })
    return result
  }, [])

  const colorOf = (k: BridgeStep['kind']) =>
    k === 'base' || k === 'total' ? BASE : k === 'up' ? POS : NEG

  // Keep the opening/closing columns visible. A zoomed positive-only axis clips
  // those baseline columns because their transparent spacer starts at zero.
  const lowest = Math.min(0, ...rows.map((r) => Math.min(r.start, r.end)))
  const floor = lowest < 0 ? niceFloor(lowest * 1.05) : 0

  return (<>
    <ChartSummary data={rows} xKey="label" yKey="value" label="Equity bridge chart"/>
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
        <XAxis dataKey="label" tick={<WrappedTick />} axisLine={false} tickLine={false} interval={0} height={34} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={money} width={52} domain={[floor, 'auto']} allowDataOverflow />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          content={({ active, payload }: any) => {
            if (!active || !payload?.length) return null
            const r = payload[0].payload
            return (
              <div className="rounded-xl border border-white/10 bg-[#10151d]/95 px-3 py-2 text-xs shadow-2xl backdrop-blur-xl">
                <div className="mb-0.5 text-muted">{r.label}</div>
                <div className="num font-semibold">{usd(r.value)}</div>
              </div>
            )
          }}
        />
        {/* transparent spacer to float the visible bar */}
        <Bar dataKey="base" stackId="a" fill="transparent" isAnimationActive={false}/>
        <Bar dataKey="bar" stackId="a" radius={[3, 3, 0, 0]} isAnimationActive={false} onClick={(_, index) => onStepClick?.(index)} style={{ cursor: onStepClick ? 'pointer' : undefined }}>
          {rows.map((r, i) => (
            <Cell key={i} fill={colorOf(r.kind)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer></>)
}
