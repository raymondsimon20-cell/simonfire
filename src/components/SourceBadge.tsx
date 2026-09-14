import clsx from 'clsx'

export function SourceBadge({ source, label }: { source?: 'csv' | 'api' | 'manual' | 'estimated' | 'broker'; label?: string }) {
  const config = source === 'csv' ? ['Schwab CSV', 'border-[#5aa2ff]/25 bg-[#5aa2ff]/10 text-[#7fb5ff]']
    : source === 'manual' ? ['Manual', 'border-[#b18aff]/25 bg-[#b18aff]/10 text-[#c3a4ff]']
      : source === 'estimated' ? ['Estimated', 'border-[#e1c887]/25 bg-[#e1c887]/10 text-[#e1c887]']
        : ['Live API', 'border-pos/25 bg-pos/10 text-pos']
  return <span className={clsx('inline-flex whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', config[1])}>{label ?? config[0]}</span>
}
