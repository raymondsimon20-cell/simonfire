// TEMPORARY debug endpoint: reports which balance fields Schwab returns for each
// account, so we can confirm the correct "available to withdraw" source. Remove
// after verifying. Behind the same OAuth token; returns only the caller's data.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { accessToken, json, API_BASE } from './lib/schwab'

export default async () => {
  try {
    const token = await accessToken()
    const res = await fetch(`${API_BASE}/accounts`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    const raw: any[] = await res.json()
    const out = raw.map((entry) => {
      const sa = entry.securitiesAccount ?? entry
      const bal = sa.currentBalances ?? {}
      const pick = (k: string) => (k in bal ? bal[k] : null)
      return {
        account: String(sa.accountNumber ?? '').slice(-4),
        type: sa.type,
        balanceKeys: Object.keys(bal),
        cashAvailableForWithdrawal: pick('cashAvailableForWithdrawal'),
        availableFunds: pick('availableFunds'),
        availableFundsNonMarginableTrade: pick('availableFundsNonMarginableTrade'),
        buyingPower: pick('buyingPower'),
        cashBalance: pick('cashBalance'),
        cashAvailableForTrading: pick('cashAvailableForTrading'),
        equity: pick('equity'),
        liquidationValue: pick('liquidationValue'),
        marginBalance: pick('marginBalance'),
        longMarketValue: pick('longMarketValue'),
      }
    })
    return json({ ok: true, accounts: out })
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500)
  }
}
