import { useState } from 'react'
import { bridgeTransactions, type MonthClose } from '../lib/calc'
import type { Account, Position, Transaction } from '../lib/types'
import { monthLabel, shortDate, usd } from '../lib/format'
import { Waterfall } from './Charts'
import { TransactionDrawer } from './TransactionDrawer'
import { statementBridgeValues } from '../lib/statement-history'

export function EquityBridge({ close, transactions, positions, accounts, scope, chart = false }: {
  close: MonthClose; transactions: Transaction[]; positions: Position[]; accounts: Account[]; scope: string; chart?: boolean
}) {
  const [selected, setSelected] = useState<number | null>(null)
  const [transactionId, setTransactionId] = useState<string | null>(null)
  const step = selected == null ? null : close.bridge[selected]
  const monthly = transactions.filter((t) => t.date.slice(0, 7) === close.ym)
  const rows = bridgeTransactions(transactions, close.ym, selected)
  const scopedAccounts = accounts.filter((a) => scope === 'all' || a.id === scope)
  const byTicker = new Map<string, number>()
  for (const p of positions) byTicker.set(p.symbol, (byTicker.get(p.symbol) ?? 0) + p.shares * p.lastPrice)
  const currentClosing = close.currentBalance
  const automatic = close.statement?.statements.some((row) => row.source === 'Automatic snapshot')
  const knownValue = (index: number) => close.statement
    ? index === 0 ? close.historyAvailable : index === 5 ? true : index === 4 ? close.reconciliationAvailable : close.statement.flowsAvailable !== false
    : [1, 2, 3].includes(index) || (index === 5 && currentClosing) || close.historyAvailable
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id
  const total = rows.reduce((n, r) => n + r.value, 0)
  return <>
    {chart && close.reconciliationAvailable && <Waterfall steps={close.bridge} height={300} onStepClick={setSelected} />}
    {!close.reconciliationAvailable && <p className="mt-4 rounded-lg bg-white/[.025] p-3 text-xs leading-relaxed text-muted">{close.statement ? close.statement.coverageNote || 'An opening balance and complete cash flows are needed to reconcile this month.' : 'Historical equity snapshots are unavailable. Transaction totals are shown; opening equity, market movement, and historical closing equity are not inferred.'}</p>}
    <p className="mt-2 text-xs text-muted">Select a bridge value to see its breakdown.</p>
    <div className={chart ? 'mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3' : 'mt-3 divide-y divide-border-soft'}>
      {close.bridge.map((row, index) => <button key={row.label} type="button" aria-expanded={selected === index} aria-controls="equity-bridge-detail" onClick={() => setSelected(selected === index ? null : index)} className={`flex w-full items-center justify-between gap-3 rounded-lg p-2 text-left text-xs hover:bg-white/[.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${selected === index ? 'bg-white/[.08] text-ink' : 'text-muted'}`}><span>{row.label}</span><span className="num">{knownValue(index) ? usd(row.value, { sign: row.kind !== 'base' && row.kind !== 'total' }) : '—'}</span></button>)}
    </div>
    {step && <section id="equity-bridge-detail" aria-label={`${step.label} breakdown`} className="mt-4 rounded-xl border border-border-soft p-4">
      <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{step.label}: {knownValue(selected!) ? usd(step.value, { sign: true }) : 'Unavailable'}</h3><p className="mt-1 text-xs text-muted">{monthLabel(close.ym)}</p></div><button type="button" onClick={() => setSelected(null)} className="text-xs text-muted hover:text-ink">Close</button></div>
      {close.statement ? <>
        <p className="mt-3 text-xs leading-relaxed text-muted">{automatic ? 'Saved brokerage balances and cash flows. Market & other is the residual after funding, income, and expenses; it includes realized and unrealized changes and is an estimate.' : 'Amounts from the imported monthly summaries. Market change already includes trading gains and losses; realized P/L is not added again. Statement summaries do not provide a transaction or ticker breakdown.'}</p>
        <dl className="mt-3 space-y-2 text-xs">{close.statement.statements.map((row) => <div key={`${row.accountMask}-${row.month}`}><Detail label={`${row.source} · ${row.accountMask ? `•••${row.accountMask}` : 'Unassigned account'}`} value={knownValue(selected!) ? statementBridgeValues(row)[selected!] : undefined}/><p className="text-faint">{row.fileName}{row.asOf ? ` · ${shortDate(row.asOf)}` : ''}</p>{selected === 3 && row.flowsAvailable !== false && <><Detail label="Dividends and interest" value={row.dividendsInterest}/><Detail label="Expenses" value={row.expenses}/></>}</div>)}</dl>
      </> : <>
      {(selected === 1 || selected === 2 || selected === 3) && <>
        <p className="mt-3 text-xs text-muted">{selected === 3 ? 'Realized profit or loss, not sale proceeds. Missing P/L contributes $0 to this bridge.' : selected === 2 ? 'Income less operating expenses, including withdrawals, bill payments, margin interest, fees, and withholding.' : 'Recorded contributions for this month.'}</p>
        {rows.length === 0 ? <p className="mt-3 text-sm text-muted">No contributing transactions in this month.</p> : <div className="mt-3 max-h-80 overflow-auto"><table className="w-full text-left text-xs"><thead><tr className="text-muted"><th className="p-2">Date / account</th><th className="p-2">Ticker / transaction</th><th className="p-2 text-right">{selected === 3 ? 'Realized P/L' : 'Amount'}</th></tr></thead><tbody>{rows.map(({ transaction: t, value }) => <tr key={t.id} className="border-t border-border-soft"><td className="p-2 whitespace-nowrap">{shortDate(t.date)}<div className="text-faint">{accountName(t.accountId)}</div></td><td className="p-2"><button type="button" onClick={() => setTransactionId(t.id)} className="text-left text-brand underline">{t.symbol || t.type}</button><div className="mt-1 text-faint">{t.description || t.type}</div>{selected === 3 && t.plEstimated && <div className="text-faint">Estimated P/L</div>}{selected === 3 && t.pl == null && <div className="text-[#f0a94a]">P/L missing</div>}</td><td className={`num p-2 text-right whitespace-nowrap ${value < 0 ? 'text-neg' : 'text-pos'}`}>{usd(value, { sign: true })}</td></tr>)}</tbody><tfoot><tr><th colSpan={2} className="p-2">Transaction total</th><td className="num p-2 text-right">{usd(total, { sign: true })}</td></tr></tfoot></table></div>}
      </>}
      {selected === 4 && <p className="mt-3 text-sm text-muted">Market movement requires recorded beginning and ending equity. Those historical balances are unavailable; no market gain or loss is assigned.</p>}
      {selected === 0 && <p className="mt-3 text-sm text-muted">No recorded opening net-equity balance is available for this month. Deposits and spending alone cannot establish it.</p>}
      {selected === 5 && (currentClosing ? <><p className="mt-3 text-xs text-muted">Current net equity uses the reported account balance. The adjustment reconciles holdings priced separately to that balance; it is not investment profit.</p><dl className="mt-3 max-h-80 space-y-2 overflow-auto text-xs">{[...byTicker].sort((a, b) => b[1] - a[1]).map(([symbol, value]) => <Detail key={symbol} label={symbol} value={value}/>)}{scopedAccounts.map((a) => <div key={a.id}><Detail label={`${a.name} · cash`} value={a.cash}/><Detail label={`${a.name} · margin debt`} value={-a.marginBalance}/></div>)}<Detail label="Balance / valuation adjustment" value={close.closing - ([...byTicker.values()].reduce((sum, value) => sum + value, 0) + scopedAccounts.reduce((sum, a) => sum + a.cash - a.marginBalance, 0))}/><Detail label="Current net equity" value={close.closing}/></dl></> : <p className="mt-3 text-sm text-muted">No recorded closing equity or holdings snapshot is available for this month.</p>)}
      </>}
    </section>}
    <TransactionDrawer txn={monthly.find((t) => t.id === transactionId) ?? null} onClose={() => setTransactionId(null)}/>
  </>
}

function Detail({ label, value }: { label: string; value?: number }) {
  return <div className="flex justify-between gap-3 py-1"><dt className="text-muted">{label}</dt><dd className="num">{value == null ? 'Unavailable' : usd(value, { sign: true })}</dd></div>
}
