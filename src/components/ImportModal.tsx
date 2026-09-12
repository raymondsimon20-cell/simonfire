import { useState } from 'react'
import { FileText, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './ui'
import { useStore } from '../lib/store'
import { parseSchwabFiles, previewDividendEnrichment, type DividendEnrichmentPreview, type ImportResult } from '../lib/import'
import { useToast } from './Toast'

export function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, applyImport, enrichDividendSymbols } = useStore()
  const [broker, setBroker] = useState('Schwab')
  const [name, setName] = useState('')
  const [mask, setMask] = useState('')
  const [isMargin, setIsMargin] = useState(false)
  const [mode, setMode] = useState<'replace' | 'merge' | 'enrich'>('replace')
  const [posFile, setPosFile] = useState<{ name: string; text: string } | null>(null)
  const [txnFile, setTxnFile] = useState<{ name: string; text: string } | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [enrichment, setEnrichment] = useState<DividendEnrichmentPreview | null>(null)
  const [error, setError] = useState('')
  const { push } = useToast()

  const read = (file: File, set: (v: { name: string; text: string }) => void) => {
    const r = new FileReader()
    r.onload = () => set({ name: file.name, text: String(r.result ?? '') })
    r.readAsText(file)
  }

  const reset = () => {
    setPosFile(null)
    setTxnFile(null)
    setResult(null)
    setError('')
    setName('')
    setMask('')
    setIsMargin(false)
    setMode('replace')
    setEnrichment(null)
  }

  const doParse = () => {
    setError('')
    const files = [posFile, txnFile].filter(Boolean) as { name: string; text: string }[]
    if (!files.length) {
      setError('Upload at least one CSV file.')
      return
    }
    try {
      const r = parseSchwabFiles(files, { broker, name, mask, isMargin })
      setResult(r)
      setEnrichment(mode === 'enrich' ? previewDividendEnrichment(r, data.accounts, data.transactions) : null)
    } catch {
      setError('Could not parse the file. Make sure it is a Schwab CSV export.')
    }
  }

  const doApply = () => {
    if (!result) return
    if (mode === 'enrich') {
      if (!enrichment?.matches.length) return
      enrichDividendSymbols(enrichment.matches)
      push('Dividend symbols enriched', 'success', `${enrichment.matches.length} existing payments updated · no transactions added`)
    } else {
      applyImport({ accounts: result.accounts, positions: result.positions, transactions: result.transactions, broker }, mode)
      push('Portfolio import complete', 'success', `${result.positions.length} positions · ${result.transactions.length} transactions`)
    }
    reset()
    onClose()
  }

  const FileRow = ({
    label,
    hint,
    file,
    onPick,
  }: {
    label: string
    hint: string
    file: { name: string } | null
    onPick: (f: File) => void
  }) => (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border p-3 hover:border-brand">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-surface-2 text-brand">
        <FileText size={16} />
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-faint">{file ? file.name : hint}</div>
      </div>
      {file && <CheckCircle2 size={16} className="text-pos" />}
      <input
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onPick(f)
          setResult(null)
        }}
      />
    </label>
  )

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Import from CSV"
      subtitle="Load your real portfolio from Schwab CSV exports. Everything stays in your browser."
      width="max-w-lg"
      footer={
        result ? (
          <>
            <Button onClick={() => setResult(null)}>Back</Button>
            <Button variant="primary" onClick={doApply}>
              {mode === 'enrich' ? `Enrich ${enrichment?.matches.length ?? 0} payments` : mode === 'replace' ? 'Replace with imported data' : 'Add imported data'}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => { reset(); onClose() }}>Cancel</Button>
            <Button variant="primary" onClick={doParse}>Preview import</Button>
          </>
        )
      }
    >
      {!result ? (
        <div className="space-y-5">
          <div className="rounded-lg bg-surface-2 p-3 text-xs text-muted">
            In Schwab: <span className="text-ink">Positions</span> → Export, and{' '}
            <span className="text-ink">History → Transactions</span> → Export. Upload one or both below. If your export
            already lists accounts, they're detected automatically — otherwise the account details below are used.
          </div>

          <div className="space-y-2">
            <FileRow label="Positions CSV" hint="Click to choose your positions export" file={posFile} onPick={(f) => read(f, setPosFile)} />
            <FileRow label="Transactions CSV" hint="Click to choose your transactions export" file={txnFile} onPick={(f) => read(f, setTxnFile)} />
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold tracking-widest text-faint">DEFAULT ACCOUNT (if not in the file)</div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Broker" value={broker} onChange={setBroker} />
              <Input label="Account name" value={name} onChange={setName} placeholder="e.g. Raymond" />
              <Input label="Last 3–4 digits" value={mask} onChange={setMask} placeholder="e.g. 391" />
              <label className="flex items-end gap-2 pb-2 text-sm text-muted">
                <input type="checkbox" checked={isMargin} onChange={(e) => setIsMargin(e.target.checked)} />
                Margin account
              </label>
            </div>
          </div>

          <div><div className="mb-2 text-xs font-semibold tracking-widest text-faint">IMPORT MODE</div><div className="space-y-2">{([
            ['replace', 'Replace portfolio', 'Replace the current local portfolio with these files.'],
            ['merge', 'Add alongside', 'Append imported accounts and records; may duplicate overlapping data.'],
            ['enrich', 'Enrich existing dividends', 'Match by account, date, amount, and description; copy only missing tickers.'],
          ] as const).map(([value, label, hint]) => <label key={value} className={mode === value ? 'flex cursor-pointer gap-3 rounded-xl border border-brand/50 bg-brand/5 p-3' : 'flex cursor-pointer gap-3 rounded-xl border border-border p-3'}><input type="radio" name="import-mode" value={value} checked={mode === value} onChange={() => { setMode(value); setResult(null); setEnrichment(null) }}/><span><span className="block text-sm font-medium text-ink">{label}</span><span className="mt-0.5 block text-xs text-faint">{hint}</span></span></label>)}</div></div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-[#33161d] px-3 py-2 text-sm text-neg">
              <AlertTriangle size={15} /> {error}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {mode === 'enrich' && enrichment ? <><div className="grid grid-cols-3 gap-3 text-center"><Stat n={enrichment.matches.length} label="Matched"/><Stat n={enrichment.ambiguous.length} label="Ambiguous"/><Stat n={enrichment.unmatched.length} label="Unmatched"/></div><div className="rounded-lg border border-pos/20 bg-pos/5 p-3 text-xs text-muted">Only {enrichment.matches.length} existing dividend payment{enrichment.matches.length === 1 ? '' : 's'} will receive a ticker. No positions, balances, or transactions will be added.</div>{enrichment.matches.length > 0 && <div className="max-h-48 overflow-auto rounded-lg border border-border-soft">{enrichment.matches.slice(0, 100).map((match) => <div key={match.transactionId} className="flex items-center justify-between gap-3 border-b border-border-soft px-3 py-2 text-xs last:border-0"><span><strong className="text-brand">{match.symbol}</strong> · {match.date}</span><span className="num">${match.amount.toFixed(2)}</span></div>)}</div>}</> : <div className="grid grid-cols-3 gap-3 text-center"><Stat n={result.accounts.length} label="Accounts" /><Stat n={result.positions.length} label="Positions" /><Stat n={result.transactions.length} label="Transactions" /></div>}
          {mode !== 'enrich' && result.accounts.length > 0 && (
            <div className="rounded-lg border border-border-soft p-3 text-sm">
              <div className="mb-1 text-xs text-faint">Detected accounts</div>
              {result.accounts.map((a) => (
                <div key={a.id} className="flex justify-between py-0.5">
                  <span>{a.name}{a.mask ? ` ····${a.mask}` : ''}{a.isMargin ? ' (margin)' : ''}</span>
                  <span className="text-faint">{result.positions.filter((p) => p.accountId === a.id).length} pos</span>
                </div>
              ))}
            </div>
          )}
          {result.warnings.length > 0 && (
            <div className="space-y-1 rounded-lg bg-[#35240f] p-3 text-xs text-[#f0a94a]">
              {result.warnings.map((w, i) => (
                <div key={i} className="flex items-center gap-2">
                  <AlertTriangle size={13} /> {w}
                </div>
              ))}
            </div>
          )}
          <div className="text-xs text-faint">
            {mode === 'enrich'
              ? `${enrichment?.csvDividendCount ?? 0} symbol-bearing CSV dividends were inspected. Ambiguous and unmatched rows will not change.`
              : mode === 'replace'
              ? 'This will replace the current sample data with the imported data.'
              : 'This will add the imported data alongside what you have.'}
          </div>
        </div>
      )}
    </Modal>
  )
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-xs text-faint">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand"
      />
    </label>
  )
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-xl border border-border-soft bg-surface-2/50 p-3">
      <div className="num text-2xl font-bold">{n}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  )
}
