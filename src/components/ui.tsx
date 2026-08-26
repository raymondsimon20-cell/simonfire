import type { ReactNode } from 'react'
import clsx from 'clsx'

// ---- KPI card with tinted icon tile ----
export type Tile = 'green' | 'blue' | 'orange' | 'purple' | 'teal' | 'red'

const tileBg: Record<Tile, string> = {
  green: 'bg-[#123024] text-[#34d17d]',
  blue: 'bg-[#10233f] text-[#5aa2ff]',
  orange: 'bg-[#35240f] text-[#f0a94a]',
  purple: 'bg-[#241a3a] text-[#b18aff]',
  teal: 'bg-[#0e2e2e] text-[#3fd6c8]',
  red: 'bg-[#33161d] text-[#f2607a]',
}

export function KpiCard({
  label,
  value,
  icon,
  tile = 'blue',
  sub,
  info,
  valueClass,
}: {
  label: string
  value: ReactNode
  icon?: ReactNode
  tile?: Tile
  sub?: ReactNode
  info?: string
  valueClass?: string
}) {
  return (
    <div className="card p-5 fadein">
      <div className="flex items-start justify-between">
        {icon && (
          <div className={clsx('grid h-11 w-11 place-items-center rounded-xl', tileBg[tile])}>
            {icon}
          </div>
        )}
        {info && (
          <span
            title={info}
            className="grid h-5 w-5 cursor-help place-items-center rounded-full border border-[--color-border] text-[10px] text-[--color-faint]"
          >
            i
          </span>
        )}
      </div>
      <div className="mt-4 text-sm text-[--color-muted]">{label}</div>
      <div className={clsx('num mt-1 text-2xl font-semibold', valueClass)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-[--color-faint]">{sub}</div>}
    </div>
  )
}

export function Card({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={clsx('card p-5', className)}>{children}</div>
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[--color-muted]">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  )
}

const badgeStyle: Record<string, string> = {
  Dividend: 'bg-[#123024] text-[#3fd88a]',
  Contribution: 'bg-[#10233f] text-[#5aa2ff]',
  Buy: 'bg-[#10233f] text-[#5aa2ff]',
  Sell: 'bg-[#241a3a] text-[#b18aff]',
  Interest: 'bg-[#0e2e2e] text-[#3fd6c8]',
  'Bill Payment': 'bg-[#3a1a12] text-[#f08a5a]',
  Withdrawal: 'bg-[#33161d] text-[#f2607a]',
  Fee: 'bg-[#33161d] text-[#f2607a]',
  Other: 'bg-[#20293a] text-[#9fb0c9]',
  Active: 'bg-[#123024] text-[#3fd88a]',
  Margin: 'bg-[#3a1a12] text-[#f0a94a]',
}

export function Badge({ children }: { children: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        badgeStyle[children] ?? 'bg-[#20293a] text-[#9fb0c9]',
      )}
    >
      {children}
    </span>
  )
}

export function Button({
  children,
  variant = 'ghost',
  onClick,
  className,
  type = 'button',
}: {
  children: ReactNode
  variant?: 'primary' | 'ghost'
  onClick?: () => void
  className?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
        variant === 'primary'
          ? 'bg-[--color-brand] text-white hover:bg-[#2f74e6]'
          : 'border border-[--color-border] bg-[--color-surface-2] text-[--color-ink] hover:bg-[#1c2740]',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Select({
  value,
  onChange,
  options,
  className,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={clsx(
        'rounded-lg border border-[--color-border] bg-[--color-surface-2] px-3 py-2 text-sm text-[--color-ink] outline-none focus:border-[--color-brand]',
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-[--color-muted]">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="card grid place-items-center p-12 text-center text-sm text-[--color-muted]">
      {children}
    </div>
  )
}
