import clsx from 'clsx'

export function SummaryMetric({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'warn' }) {
  return <div><div className="text-[10px] font-medium uppercase tracking-[.12em] text-faint">{label}</div><div className={clsx('num mt-1 text-lg font-semibold', tone === 'positive' ? 'text-pos' : tone === 'warn' ? 'text-[#e7c88f]' : 'text-ink')}>{value}</div></div>
}
