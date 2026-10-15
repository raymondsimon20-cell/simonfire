import { usd } from '../lib/format'

export type AllocationStep = 'overview' | 'targets' | 'plan' | 'review' | 'hedges' | 'orders'

export function AllocationOverview({ value, drift, balanced, fallbackCount, activePuts, queuedHedges, onChoose }: {
  value: number; drift: string; balanced: boolean; fallbackCount: number; activePuts: number; queuedHedges: number
  onChoose: (step: AllocationStep, rebalance?: boolean) => void
}) {
  const goals = [
    { title: 'Add money', detail: 'Choose an account and budget. See which holdings receive new money and why.', step: 'plan' as const },
    { title: 'Rebalance', detail: 'Compare your targets with today’s holdings and review proposed buys and trims.', step: 'plan' as const, rebalance: true },
    { title: 'Protect my portfolio', detail: 'Review existing puts, compare protection choices, and understand the cost.', step: 'hedges' as const },
    { title: 'Review holdings', detail: 'Check classifications and trend signals before making a decision.', step: 'review' as const },
  ]
  return <div className="space-y-5">
    <section className="card p-5"><h2 className="text-lg font-semibold">Where you stand</h2><div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Metric label="Long holdings" value={usd(value)}/><Metric label="Largest target difference" value={drift}/><Metric label="Active put positions" value={String(activePuts)}/><Metric label="Hedge plans to follow up" value={String(queuedHedges)}/>
    </div><p className="mt-4 text-xs text-muted">{!balanced ? 'Your targets need to total 100% before a buy plan can be prepared.' : fallbackCount ? `${fallbackCount} holdings use a default bucket. Check their classifications before planning.` : 'Choose a goal below to start. Plans remain separate from submitted orders.'}</p>
    <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-brand"><button onClick={() => onChoose('targets')}>Review targets</button>{queuedHedges > 0 && <button onClick={() => onChoose('hedges')}>Follow up on hedge plans</button>}<button onClick={() => onChoose('orders')}>Review buy orders</button></div></section>
    <section><h2 className="mb-3 text-lg font-semibold">What would you like to do?</h2><div className="grid gap-3 sm:grid-cols-2">{goals.map((goal) => <button key={goal.title} onClick={() => onChoose(goal.step, goal.rebalance)} className="card p-5 text-left transition-colors hover:border-brand focus-visible:outline-2 focus-visible:outline-brand"><h3 className="font-semibold text-brand">{goal.title} →</h3><p className="mt-2 text-sm text-muted">{goal.detail}</p></button>)}</div></section>
    <section className="card p-5"><h2 className="font-semibold">How decisions are made</h2><p className="mt-2 text-sm text-muted">Your targets set the direction. Account capacity and expense reserves limit spending. The chosen sizing rule allocates the budget. Protection uses separate loss scenarios and quote comparisons. You review every order before submission.</p><p className="mt-2 text-xs text-faint">Trend and contract-fit scores describe how inputs match a rule. A score of 80/100 is not a probability of profit.</p></section>
  </div>
}
function Metric({ label, value }: { label: string; value: string }) { return <div><div className="text-xs text-faint">{label}</div><div className="num mt-1 text-lg font-semibold">{value}</div></div> }
