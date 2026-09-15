import { Bell, Database, Eye, HardDrive, Rows3 } from 'lucide-react'
import { DEFAULT_FRESHNESS, useStore } from '../lib/store'
import { PageHeader } from '../components/ui'

export default function Preferences() {
  const { data, setFreshnessThresholds } = useStore()
  const thresholds = data.freshnessThresholds ?? DEFAULT_FRESHNESS
  const setLocal = (key: string, value: string) => { localStorage.setItem(key, value); window.location.reload() }
  const backupStatus = localStorage.getItem('simonfire.last-server-backup-status')
  return <div><PageHeader title="Preferences" subtitle="Freshness, notifications, privacy, backups, and display density"/>
    <div className="grid gap-4 lg:grid-cols-2"><Setting icon={<Database size={17}/>} title="Data freshness" detail="Warning thresholds for authoritative accounting exports"><div className="grid grid-cols-3 gap-2">{([['Positions','positions'],['Transactions','transactions'],['Realized P/L','realizedPl']] as const).map(([label,key]) => <label key={key} className="text-[10px] text-faint">{label}<input type="number" min="1" max="365" value={thresholds[key]} onChange={(event) => setFreshnessThresholds({ ...thresholds, [key]: Math.max(1, Number(event.target.value) || 1) })} className="num mt-1 w-full rounded-lg border border-border bg-surface-2 px-2 py-2 text-sm text-ink"/></label>)}</div></Setting>
      <Setting icon={<Bell size={17}/>} title="Notifications" detail="Dismissed and snoozed alerts are stored on this device"><button onClick={() => { localStorage.removeItem('simonfire.notifications'); window.location.reload() }} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-brand">Reset notification state</button></Setting>
      <Setting icon={<Eye size={17}/>} title="Privacy" detail="Blur monetary values when sharing your screen"><select defaultValue={localStorage.getItem('simonfire.privacy') ?? 'off'} onChange={(event) => setLocal('simonfire.privacy', event.target.value)} className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"><option value="off">Show balances</option><option value="on">Blur balances</option></select></Setting>
      <Setting icon={<Rows3 size={17}/>} title="Display density" detail="Choose comfortable or compact records"><select defaultValue={localStorage.getItem('simonfire.density') ?? 'comfortable'} onChange={(event) => setLocal('simonfire.density', event.target.value)} className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></Setting>
      <Setting icon={<HardDrive size={17}/>} title="Automatic backups" detail="Daily rotating server backup status"><div className="text-xs"><strong>{backupStatus?.startsWith('ok:') ? 'Healthy' : backupStatus?.startsWith('error:') ? 'Needs attention' : 'Waiting for first backup'}</strong><div className="mt-1 text-faint">{backupStatus?.split(':').slice(1).join(':') || 'A backup is attempted after the first live sync.'}</div></div></Setting>
    </div>
  </div>
}
function Setting({ icon, title, detail, children }: { icon: React.ReactNode; title: string; detail: string; children: React.ReactNode }) { return <section className="card p-5"><div className="flex items-start gap-3"><span className="text-brand">{icon}</span><div className="flex-1"><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs text-faint">{detail}</p><div className="mt-4">{children}</div></div></div></section> }
