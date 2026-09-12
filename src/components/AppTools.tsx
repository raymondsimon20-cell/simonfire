import { useState } from 'react'
import { BookOpen, Eye, EyeOff, Megaphone } from 'lucide-react'
import { useStore, type GlobalDateRange } from '../lib/store'
import { Modal } from './Modal'

const GLOSSARY = [
  ['Net equity', 'What remains after margin debt is subtracted from gross portfolio assets.'],
  ['Run rate', 'An estimate of the next 12 months of distributions using current shares and available forward or historical data.'],
  ['TWR', 'Time-weighted return: investment performance with deposits and withdrawals neutralized.'],
  ['Return of capital', 'A distribution tax classification that generally reduces cost basis; it is not automatically profit.'],
  ['Cost basis', 'The tracked purchase cost used to estimate gains or losses when an investment is sold.'],
  ['Distribution yield', 'Estimated annual distributions divided by current market value. It can change and is not guaranteed.'],
  ['Margin equity', 'The percentage of gross assets you own after subtracting borrowed funds.'],
]

export function AppTools({ privacy, onPrivacy }: { privacy: boolean; onPrivacy: () => void }) {
  const { dateRange, setDateRange } = useStore()
  const [glossary, setGlossary] = useState(false)
  const [release, setRelease] = useState(false)
  return <>
    <div className="flex flex-wrap items-center gap-1.5">
      <select aria-label="Global date range" value={dateRange} onChange={(event) => setDateRange(event.target.value as GlobalDateRange)} className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-[11px] text-muted outline-none"><option value="30">30 days</option><option value="90">90 days</option><option value="365">12 months</option><option value="all">All history</option></select>
      <ToolButton label={privacy ? 'Show balances' : 'Hide balances'} onClick={onPrivacy}>{privacy ? <Eye size={14}/> : <EyeOff size={14}/>}</ToolButton>
      <ToolButton label="Glossary" onClick={() => setGlossary(true)}><BookOpen size={14}/></ToolButton>
      <ToolButton label="What’s new" onClick={() => setRelease(true)}><Megaphone size={14}/></ToolButton>
    </div>
    <Modal open={glossary} onClose={() => setGlossary(false)} title="Financial glossary" subtitle="Plain-language definitions used throughout SimonFIRE" width="max-w-2xl"><div className="divide-y divide-border-soft">{GLOSSARY.map(([term, meaning]) => <div key={term} className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr]"><strong className="text-sm">{term}</strong><span className="text-sm leading-6 text-muted">{meaning}</span></div>)}</div></Modal>
    <Modal open={release} onClose={() => setRelease(false)} title="What’s new" subtitle="Plan Health polish release"><ul className="space-y-2 text-sm text-muted"><li>• Guided income-replacement dashboard with auditable formulas</li><li>• Portfolio-derived spending with exclusions and carrying costs</li><li>• Historical value, equity tracking, dividend calendar, and projection confidence</li><li>• Safer Schwab protective-put preview and roll workflow</li><li>• Cross-device planning preferences and classification rules</li></ul></Modal>
  </>
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button aria-label={label} title={label} onClick={onClick} className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-white/[.025] text-faint hover:text-ink">{children}</button>
}
