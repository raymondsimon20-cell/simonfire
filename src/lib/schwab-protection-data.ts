export interface SchwabProtectionAccount {
  accountId: string; mask: string; cash: number | null; debt: number | null
  // Raw broker concepts remain separate; none is a proxy for maintenance excess.
  maintenanceRequirement?: number | null; maintenanceExcess?: number | null
  equity?: number | null; equityPercentage?: number | null; initialMarginRequirement?: number | null
  sma?: number | null; buyingPower?: number | null; availableFunds?: number | null
  cashAvailableForWithdrawal?: number | null; liquidationValue?: number | null
  positions: {
    symbol: string; shares: number; lastPrice: number; maintenancePct?: number
    maintenanceRequirement?: number | null; marginEligible?: boolean | null
    specialMaintenanceRequirement?: number | null; concentrationRequirement?: number | null
    optionMarginTreatment?: string | null; leveragedEtfTreatment?: string | null
  }[]
}
const number = (n: unknown): number | null => typeof n === 'number' && Number.isFinite(n) ? n : null
// Only explicit position-level requirements can establish a holding's rate.
// An account-level requirement cannot be distributed reliably across holdings.
export function schwabProtectionData(raw: unknown): SchwabProtectionAccount[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error('Missing Schwab account data')
  const masks = new Set<string>()
  return raw.map((entry) => {
    const account = entry?.securitiesAccount ?? entry
    const mask = String(account?.accountNumber ?? '').replace(/\D/g,'').slice(-4)
    if (mask.length !== 4 || masks.has(mask)) throw new Error('Schwab accounts cannot be uniquely identified')
    masks.add(mask)
    const balance = account.currentBalances ?? {}, margin = number(balance.marginBalance)
    return {
      accountId: `acc_${mask}`, mask, cash: number(balance.cashBalance), debt: margin == null ? null : Math.abs(margin),
      maintenanceRequirement: number(balance.maintenanceRequirement),
      maintenanceExcess: number(balance.maintenanceExcess),
      equity: number(balance.equity), equityPercentage: number(balance.equityPercentage),
      initialMarginRequirement: number(balance.initialMarginRequirement),
      sma: number(balance.sma), buyingPower: number(balance.buyingPower),
      availableFunds: number(balance.availableFunds),
      cashAvailableForWithdrawal: number(balance.cashAvailableForWithdrawal),
      liquidationValue: number(balance.liquidationValue),
      positions: (Array.isArray(account.positions) ? account.positions : []).flatMap((p: Record<string, any>) => {
        const symbol = String(p.instrument?.symbol ?? '').trim().toUpperCase()
        const long = number(p.longQuantity), short = number(p.shortQuantity)
        const shares = (long ?? 0) - (short ?? 0), marketValue = number(p.marketValue)
        if (!symbol || (long == null && short == null) || marketValue == null || !shares) return []
        const requirement = number(p.maintenanceRequirement)
        const rate = requirement != null && requirement >= 0 && marketValue > 0 ? requirement / marketValue * 100 : undefined
        return [{symbol, shares, lastPrice: marketValue / shares,
          maintenanceRequirement: requirement,
          // These optional extensions are evidence only when explicitly supplied.
          // Standard account/position responses need not expose house rules.
          marginEligible: typeof p.marginEligible === 'boolean' ? p.marginEligible : null,
          specialMaintenanceRequirement: number(p.specialMaintenanceRequirement),
          concentrationRequirement: number(p.concentrationRequirement),
          optionMarginTreatment: typeof p.optionMarginTreatment === 'string' && p.optionMarginTreatment.trim() ? p.optionMarginTreatment : null,
          leveragedEtfTreatment: typeof p.leveragedEtfTreatment === 'string' && p.leveragedEtfTreatment.trim() ? p.leveragedEtfTreatment : null,
          ...(rate != null ? { maintenancePct: rate } : {})}]
      }),
    }
  })
}

// Match inventory before combining refreshed marks and debt. Price movements
// update the local analysis; inventory changes need the normal portfolio sync.
export function reconcileProtectionHoldings(saved: import('./types').Position[], fetched: SchwabProtectionAccount['positions']) {
  const key = (s:string) => s.trim().toUpperCase().replace(/\s/g,'')
  const quantities = new Map<string,number>(), broker = new Map<string,SchwabProtectionAccount['positions'][number]>()
  for(const p of saved) if(p.shares!==0) quantities.set(key(p.symbol),(quantities.get(key(p.symbol))??0)+p.shares)
  let valid=true
  for(const p of fetched) {
    if(p.shares===0) continue
    if(broker.has(key(p.symbol)) || !Number.isFinite(p.shares) || !Number.isFinite(p.lastPrice) || p.lastPrice<0) valid=false
    broker.set(key(p.symbol),p)
  }
  const matches=valid && quantities.size===broker.size && [...quantities].every(([symbol,shares])=>Math.abs(shares-(broker.get(symbol)?.shares??Infinity))<1e-6)
  return {matches,positions:matches ? saved.map(p=>p.shares!==0 ? {...p,lastPrice:broker.get(key(p.symbol))!.lastPrice} : p) : saved}
}
