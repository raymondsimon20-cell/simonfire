import { useMemo } from 'react'
import { useStore } from '../lib/store'
import { reconcileStatementTransactions } from '../lib/statement-transactions'

export function StatementImportStatus() {
  const { data } = useStore()
  const review = useMemo(() => reconcileStatementTransactions(data.accounts, data.transactions, data.statementTransactions ?? []), [data.accounts, data.transactions, data.statementTransactions])
  const snapshots=(data.historicalBalances ?? []).filter(b=>b.statementSnapshot).sort((a,b)=>b.month.localeCompare(a.month))
  if (!data.statementTransactions?.length && !snapshots.length) return null
  return <div className="card mb-6 p-5">
    <h2 className="font-semibold">Imported statements</h2>
    <p className="mt-1 text-xs text-faint">{data.statementTransactions?.length ?? 0} monthly statements saved across devices. Each imported transaction links back to its statement page.</p>
    {snapshots.length>0&&<details className="mt-3 rounded-lg border border-border-soft p-3 text-xs"><summary className="cursor-pointer font-medium">Holding snapshots and statement summaries · {snapshots.length} months</summary><p className="mt-2 text-faint">Dated evidence from statements, not current quotes. Pending income is excluded from received cash.</p><div className="mt-3 max-h-96 space-y-3 overflow-auto">{snapshots.map(b=>{const s=b.statementSnapshot!;return <details key={`${b.accountMask}-${b.month}`} className="border-t border-border-soft pt-2"><summary className="cursor-pointer">····{b.accountMask} · {b.month} · {s.holdings.length} holdings · {s.complete?'Verified':'Needs review'}</summary><p className="mt-2 text-faint">{s.sourceFile??b.fileName}</p>{b.statementSnapshotWarning&&<p className="mt-2 text-[#e1c887]">{b.statementSnapshotWarning}</p>}<p className="mt-2">Equity ${b.closingEquity.toFixed(2)} · reported holding basis {s.summaryCostBasis==null?'Unavailable':`$${s.summaryCostBasis.toFixed(2)}`} · cash/debt {s.cashEnding==null?'Unavailable':`$${s.cashEnding.toFixed(2)}`}</p>{s.marginRate!=null&&<p>Reported margin rate {s.marginRate.toFixed(3)}% · interest ${Math.abs(s.marginInterest??0).toFixed(2)}</p>}{s.pendingActivity!=null&&<p>Pending activity ${s.pendingActivity.toFixed(2)} · not received</p>}{s.realizedShortTerm!=null&&<p>Reported realized gains: short term ${s.realizedShortTerm.toFixed(2)} · long term ${(s.realizedLongTerm??0).toFixed(2)}</p>}{s.issues.map((issue,i)=><p key={i} className="mt-1 text-[#e1c887]">{issue}</p>)}<div className="mt-2 space-y-1">{s.holdings.map(h=><p key={h.symbol}>{h.symbol} · {h.quantity} · value ${h.marketValue.toFixed(2)} · basis {h.costBasis==null?'Unavailable':`$${h.costBasis.toFixed(2)}`} · page {h.page}{h.annualIncome!=null?` · estimated annual income $${h.annualIncome.toFixed(2)}`:''}{h.yieldPct!=null?` · estimated yield ${h.yieldPct.toFixed(2)}%`:''}</p>)}</div></details>})}</div></details>}
    {review.ambiguous > 0 ? <details className="mt-3 rounded-lg border border-border-soft p-3 text-xs">
      <summary className="cursor-pointer font-medium text-[#f0a94a]">{review.ambiguous} uncertain matches need review</summary>
      <p className="mt-2 text-muted">These statement rows may overlap API records and have not been added again. Review the existing transactions and correct missing tickers where known, then sync again.</p>
      <div className="mt-2 max-h-64 overflow-auto">{review.pending.map((row, index) => <div key={index} className="border-t border-border-soft py-2"><span>{row.date} · {row.symbol ?? 'Cash activity'} · ${row.amount.toFixed(2)}</span><span className="block text-faint">{row.fileName} · page {row.page}</span></div>)}</div>
    </details> : <p className="mt-3 text-xs text-pos">No uncertain transaction matches.</p>}
  </div>
}
