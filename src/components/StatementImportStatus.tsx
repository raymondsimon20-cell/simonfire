import { useMemo } from 'react'
import { useStore } from '../lib/store'
import { reconcileStatementTransactions } from '../lib/statement-transactions'

export function StatementImportStatus() {
  const { data } = useStore()
  const review = useMemo(() => reconcileStatementTransactions(data.accounts, data.transactions, data.statementTransactions ?? []), [data.accounts, data.transactions, data.statementTransactions])
  if (!data.statementTransactions?.length) return null
  return <div className="card mb-6 p-5">
    <h2 className="font-semibold">Imported statement transactions</h2>
    <p className="mt-1 text-xs text-faint">{data.statementTransactions.length} monthly statements saved across devices. Each imported transaction links back to its statement page.</p>
    {review.ambiguous > 0 ? <details className="mt-3 rounded-lg border border-border-soft p-3 text-xs">
      <summary className="cursor-pointer font-medium text-[#f0a94a]">{review.ambiguous} uncertain matches need review</summary>
      <p className="mt-2 text-muted">These statement rows may overlap API records and have not been added again. Review the existing transactions and correct missing tickers where known, then sync again.</p>
      <div className="mt-2 max-h-64 overflow-auto">{review.pending.map((row, index) => <div key={index} className="border-t border-border-soft py-2"><span>{row.date} · {row.symbol ?? 'Cash activity'} · ${row.amount.toFixed(2)}</span><span className="block text-faint">{row.fileName} · page {row.page}</span></div>)}</div>
    </details> : <p className="mt-3 text-xs text-pos">No uncertain transaction matches.</p>}
  </div>
}
