export interface FireMilestone {
  id: string
  month: number
  annualSalary?: number
  monthlyExpenses?: number
  contribution?: number
}
export interface FireSettings {
  mode: 'margin' | 'cash'
  annualSalary: number
  monthlyExpenses: number
  startingDebt?: number
  inflationPct: number
  interestPct: number
  growthPct: number
  months: number
  cutPct: number
  minEquityPct: number
  enforceEquityLimit?: boolean
  pauseInvestmentsOverLimit?: boolean
  dripKeys: string[]
  dripYieldPct?: number
  cashYieldPct?: number
  newMoneyDripPct?: number
  milestones: FireMilestone[]
}
export interface FireStart {
  dripValue: number; cashValue: number; cash: number; otherValue?: number; debt: number
  dripYieldPct: number; cashYieldPct: number
}
export interface FireMonth {
  month: number; gross: number; net: number; debt: number; equityPct: number
  salaryInvested: number; salaryToMargin: number; lumpSumToMargin: number; dividendsRedirected: number; investmentPaused: boolean
  salary: number; lumpSum: number; expenses: number; interest: number
  dripDividend: number; cashDividend: number; appreciation: number
  borrowed: number; debtPaid: number; surplusInvested: number; assetSales: number; unfunded: number
  cumulativeSalary: number; cumulativeDrip: number; cumulativeCash: number
}
const bound = (value: unknown, min: number, max: number, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
export function cleanFireSettings(raw: unknown): FireSettings {
  const r = raw && typeof raw === 'object' ? raw as Partial<FireSettings> : {}
  const optional = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? bound(v, min, max) : undefined
  return {
    mode: r.mode === 'cash' ? 'cash' : 'margin',
    annualSalary: bound(r.annualSalary, 0, 10_000_000), monthlyExpenses: bound(r.monthlyExpenses, 0, 1_000_000),
    startingDebt: optional(r.startingDebt, 0, 100_000_000),
    inflationPct: bound(r.inflationPct, 0, 30, 3), interestPct: bound(r.interestPct, 0, 50, 8),
    growthPct: bound(r.growthPct, -95, 50, 0), months: Math.round(bound(r.months, 1, 360, 60)),
    cutPct: bound(r.cutPct, 0, 100, 0), minEquityPct: bound(r.minEquityPct, 1, 100, 50),
    enforceEquityLimit: r.enforceEquityLimit === true,
    pauseInvestmentsOverLimit: r.pauseInvestmentsOverLimit !== false,
    dripKeys: Array.isArray(r.dripKeys) ? [...new Set(r.dripKeys.filter((k): k is string => typeof k === 'string' && k.length <= 200))].slice(0, 2000) : [],
    dripYieldPct: optional(r.dripYieldPct, 0, 100), cashYieldPct: optional(r.cashYieldPct, 0, 100),
    newMoneyDripPct: optional(r.newMoneyDripPct, 0, 100),
    milestones: Array.isArray(r.milestones) ? r.milestones.filter((m) => m && typeof m === 'object').slice(0, 50).map((m, i) => ({
      id: typeof m.id === 'string' ? m.id.slice(0, 100) : `milestone-${i}`,
      month: Math.round(bound(m.month, 1, 360, 1)), annualSalary: optional(m.annualSalary, 0, 10_000_000),
      monthlyExpenses: optional(m.monthlyExpenses, 0, 1_000_000), contribution: optional(m.contribution, 0, 100_000_000),
    })).sort((a, b) => a.month - b.month) : [],
  }
}
export function cleanFireModels(raw: unknown): Record<string, FireSettings> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw).filter(([key]) => key.length <= 100).slice(0, 50).map(([key, value]) => [key, cleanFireSettings(value)])) : {}
}

// No delete operation exists for a scope: resetting writes fresh settings.
// Merge so older tabs that omit this new field cannot erase saved scenarios.
export function mergeFireModels(existing: unknown, incoming: unknown) {
  return cleanFireModels({ ...cleanFireModels(existing), ...cleanFireModels(incoming) })
}

export function projectFire(start: FireStart, raw: FireSettings) {
  const s = cleanFireSettings(raw)
  let dripValue = Math.max(0, start.dripValue)
  let cashValue = Math.max(0, start.cashValue)
  let cash = Math.max(0, start.cash)
  let debt = s.startingDebt ?? Math.max(0, start.debt)
  const otherValue = start.otherValue ?? 0
  const startingGross = dripValue + cashValue + cash + otherValue
  const startingDebt = debt
  const dripRatio = s.newMoneyDripPct != null ? s.newMoneyDripPct / 100 : (dripValue + cashValue > 0 ? dripValue / (dripValue + cashValue) : 0)
  const dripYield = (s.dripYieldPct ?? start.dripYieldPct) / 100 / 12 * (1 - s.cutPct / 100)
  const cashYield = (s.cashYieldPct ?? start.cashYieldPct) / 100 / 12 * (1 - s.cutPct / 100)
  const growth = Math.pow(1 + s.growthPct / 100, 1 / 12) - 1
  const inflation = Math.pow(1 + s.inflationPct / 100, 1 / 12)
  let annualSalary = s.annualSalary
  let expenses = s.monthlyExpenses
  let cumulativeSalary = 0, cumulativeDrip = 0, cumulativeCash = 0
  const rows: FireMonth[] = []
  let equityBreachMonth: number | null = debt > startingGross * (1 - s.minEquityPct / 100) + 0.005 ? 0 : null
  let stoppedMonth: number | null = s.enforceEquityLimit && !(s.mode === 'margin' && s.pauseInvestmentsOverLimit) ? equityBreachMonth : null
  let stopReason: 'equity' | 'funding' | null = stoppedMonth === 0 ? 'equity' : null
  if (stoppedMonth === 0) rows.push({ month: 0, gross: startingGross, net: startingGross - debt, debt, equityPct: startingGross > 0 ? (startingGross - debt) / startingGross * 100 : 0, salary: 0, salaryInvested: 0, salaryToMargin: 0, lumpSumToMargin: 0, dividendsRedirected: 0, investmentPaused: false, lumpSum: 0, expenses: 0, interest: 0, dripDividend: 0, cashDividend: 0, appreciation: 0, borrowed: 0, debtPaid: 0, surplusInvested: 0, assetSales: 0, unfunded: 0, cumulativeSalary: 0, cumulativeDrip: 0, cumulativeCash: 0 })
  const invest = (amount: number) => { dripValue += amount * dripRatio; cashValue += amount * (1 - dripRatio) }
  for (let month = 1; month <= s.months && stoppedMonth == null; month++) {
    if (month > 1) expenses *= inflation
    let lumpSum = 0
    for (const milestone of s.milestones.filter((m) => m.month === month)) {
      if (milestone.annualSalary != null) annualSalary = milestone.annualSalary
      if (milestone.monthlyExpenses != null) expenses = milestone.monthlyExpenses
      lumpSum += milestone.contribution ?? 0
    }
    // Opening holdings earn dividends and price growth. Salary and lump sums
    // are invested at month end, so they do not earn a full month's income early.
    const expectedDrip = dripValue * dripYield
    const expectedCash = cashValue * cashYield
    const appreciation = (dripValue + cashValue) * growth
    const openingGross = dripValue + cashValue + cash + otherValue
    const openingDebt = debt
    const salary = annualSalary / 12
    // Test the ordinary month before allocating new money. If investing would
    // cross the threshold, route this month's contributions and all dividends
    // toward debt instead. A recovered month can resume normal investment.
    const interest = (debt + (s.mode === 'margin' ? expenses : 0)) * s.interestPct / 100 / 12
    const normalGross = openingGross + appreciation + expectedDrip + salary + lumpSum
    const normalDebt = Math.max(0, debt + expenses + interest - expectedCash)
    const investmentPaused = s.mode === 'margin' && s.pauseInvestmentsOverLimit === true
      && (openingDebt > openingGross * (1 - s.minEquityPct / 100) + 0.005
        || normalDebt > normalGross * (1 - s.minEquityPct / 100) + 0.005)
    const dividendsRedirected = investmentPaused ? expectedDrip : 0
    const dripDividend = investmentPaused ? 0 : expectedDrip
    const cashDividend = expectedCash + dividendsRedirected
    dripValue *= 1 + growth
    cashValue *= 1 + growth
    dripValue += dripDividend
    let assetSales = 0, unfunded = 0, surplusInvested = 0, salaryToMargin = 0, lumpSumToMargin = 0
    let salaryInvested = salary
    if (s.mode === 'margin') {
      // Dividends service expenses, interest and opening debt first; paused
      // contributions repay the rest. Excess after zero debt can be invested.
      let desiredDebt = debt + expenses + interest - cashDividend
      if (investmentPaused) {
        salaryToMargin = Math.min(salary, Math.max(0, desiredDebt))
        desiredDebt -= salaryToMargin
        lumpSumToMargin = Math.min(lumpSum, Math.max(0, desiredDebt))
        desiredDebt -= lumpSumToMargin
        salaryInvested = salary - salaryToMargin
      }
      invest(salaryInvested + lumpSum - lumpSumToMargin)
      if (desiredDebt < 0) { surplusInvested = -desiredDebt; debt = 0; invest(surplusInvested) }
      else debt = desiredDebt
      const capacity = (dripValue + cashValue + cash + otherValue) * (1 - s.minEquityPct / 100)
      if (debt > capacity + 0.005) {
        equityBreachMonth ??= month
      }
      if (s.enforceEquityLimit && debt > capacity + 0.005) {
        // An opening debt breach cannot be cured by pretending some old debt
        // disappeared. Leave liabilities intact and stop the scenario.
        unfunded = Math.max(0, debt - Math.max(capacity, openingDebt))
        debt -= unfunded
        stoppedMonth = month; stopReason = 'equity'
      }
    } else {
      invest(salary + lumpSum)
      const balance = cashDividend - expenses - interest
      if (balance >= 0) {
        const repayment = Math.min(debt, balance)
        debt -= repayment
        surplusInvested = balance - repayment
        invest(surplusInvested)
      } else {
        let needed = -balance
        const cashUsed = Math.min(cash, needed)
        cash -= cashUsed; needed -= cashUsed
        assetSales = Math.min(dripValue + cashValue, needed)
        const assetTotal = dripValue + cashValue
        const soldRatio = assetTotal > 0 ? assetSales / assetTotal : 0
        dripValue *= 1 - soldRatio; cashValue *= 1 - soldRatio
        unfunded = needed - assetSales
        if (unfunded > 0.005) { stoppedMonth = month; stopReason = 'funding' }
      }
    }
    if (debt > (dripValue + cashValue + cash + otherValue) * (1 - s.minEquityPct / 100) + 0.005) {
      equityBreachMonth ??= month
      if (s.enforceEquityLimit && stoppedMonth == null) { stoppedMonth = month; stopReason = 'equity' }
    }
    cumulativeSalary += salaryInvested
    cumulativeDrip += dripDividend; cumulativeCash += cashDividend
    const gross = dripValue + cashValue + cash + otherValue
    rows.push({ month, gross, net: gross - debt, debt, equityPct: gross > 0 ? (gross - debt) / gross * 100 : 0,
      salary, salaryInvested, salaryToMargin, lumpSumToMargin, dividendsRedirected, investmentPaused, lumpSum, expenses, interest, dripDividend, cashDividend, appreciation,
      borrowed: Math.max(0, debt - openingDebt), debtPaid: Math.max(0, openingDebt - debt),
      surplusInvested, assetSales, unfunded, cumulativeSalary, cumulativeDrip, cumulativeCash })
    if (stoppedMonth != null) break
  }
  // A crossover must hold for every remaining modeled month. A single lucky
  // month or a scenario that later cannot fund expenses is not a FIRE date.
  let crossoverMonth: number | null = null
  if (stoppedMonth == null && rows.some((r) => r.expenses > 0)) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].expenses <= 0 || rows[i].cashDividend + 0.005 < rows[i].expenses + rows[i].interest) break
      crossoverMonth = rows[i].month
    }
  }
  const peak = rows.reduce((best, r) => r.debt > best.debt ? r : best, { month: 0, debt: startingDebt })
  return { rows, startingGross, startingDebt, startingNet: startingGross - startingDebt,
    final: rows.at(-1)!, crossoverMonth, stoppedMonth, stopReason, equityBreachMonth, peakDebt: peak.debt, peakDebtMonth: peak.month }
}
