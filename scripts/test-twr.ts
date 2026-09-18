import { strict as assert } from 'node:assert'
import { computeTwr, flowsByDate, sliceFrom, twrForScope } from '../src/lib/twr'
import type { Transaction, TwrPoint, TwrSeries, TxnType } from '../src/lib/types'

const point = (date: string, value: number): TwrPoint => ({ date, value })
const txn = (id: string, date: string, type: TxnType, amount: number, accountId = 'a1'): Transaction =>
  ({ id, date, type, amount, accountId, description: type, units: 0, tags: [] })
const noFlows = new Map<string, number>()

// ---- gainUsd equals end − start when there are no external flows -----------
const clean = computeTwr([point('2026-01-31', 100_000), point('2026-02-28', 110_000), point('2026-03-31', 121_000)], noFlows)
assert.ok(clean.ok)
assert.equal(clean.gainUsd, 21_000)
assert.ok(Math.abs(clean.twrPct - 0.21) < 1e-9)

// ---- a mid-window contribution inflates value but not the gain -------------
// $100k grows 10%, then $50k is deposited, then the $160k grows 10% again.
const contributed = computeTwr(
  [point('2026-01-31', 100_000), point('2026-02-28', 160_000), point('2026-03-31', 176_000)],
  flowsByDate([txn('c1', '2026-02-10', 'Contribution', 50_000)]),
)
assert.ok(contributed.ok)
// End 176,000 − start 100,000 − flows 50,000 = 26,000 earned by the investments.
assert.equal(contributed.gainUsd, 26_000)
assert.ok(Math.abs(contributed.twrPct - 0.21) < 1e-9)
// The dollar figure is deliberately NOT twrPct × starting value: the $50k earned
// return too, so the gain exceeds the 21% the percentage reports on the opener.
assert.ok(contributed.gainUsd > contributed.twrPct * 100_000)

// ---- withdrawals are neutralised the same way ------------------------------
const withdrawn = computeTwr(
  [point('2026-01-31', 100_000), point('2026-02-28', 60_000), point('2026-03-31', 66_000)],
  flowsByDate([txn('w1', '2026-02-10', 'Withdrawal', -50_000)]),
)
assert.equal(withdrawn.gainUsd, 16_000)

// ---- option premium is treated as an external flow, so it never shows as gain
const optionTrade = computeTwr(
  [point('2026-01-31', 100_000), point('2026-02-28', 102_000)],
  flowsByDate([{ ...txn('o1', '2026-02-05', 'Sell', 2_000), symbol: 'SPY   260320P00500000' }]),
)
assert.equal(optionTrade.gainUsd, 0)
assert.equal(optionTrade.twrPct, 0)
// An equity sale at the same amount is internal, so it stays in the gain.
const equityTrade = computeTwr(
  [point('2026-01-31', 100_000), point('2026-02-28', 102_000)],
  flowsByDate([{ ...txn('e1', '2026-02-05', 'Sell', 2_000), symbol: 'SCHD' }]),
)
assert.equal(equityTrade.gainUsd, 2_000)

// ---- a skipped sub-period drops out of both figures ------------------------
// A gap that zeroes the series is a data artefact, not a −100% return: the step
// into it is rejected by the r ≤ −1 guard and the step out of it has a
// non-positive base, so neither figure counts those days.
const gapped = computeTwr(
  [point('2026-01-31', 100_000), point('2026-02-28', 110_000), point('2026-03-31', 0), point('2026-04-30', 90_000)],
  noFlows,
)
assert.ok(gapped.ok)
assert.equal(gapped.gainUsd, 10_000) // only the first step linked
assert.ok(Math.abs(gapped.twrPct - 0.1) < 1e-9)
assert.equal(gapped.points.length, 4) // the full series is still returned for charting

// A series that only ever has a non-positive base cannot be linked at all.
const dead = computeTwr([point('2026-01-31', 0), point('2026-02-28', 0)], noFlows)
assert.equal(dead.ok, false)
assert.equal(dead.gainUsd, 0)

// ---- not enough data -------------------------------------------------------
for (const series of [[], [point('2026-01-31', 100_000)]]) {
  const short = computeTwr(series, noFlows)
  assert.equal(short.ok, false)
  assert.equal(short.gainUsd, 0)
  assert.equal(short.twrPct, 0)
}

// ---- sliceFrom keeps the point before the cutoff as the window base --------
const series = [point('2026-01-31', 100_000), point('2026-02-28', 110_000), point('2026-03-31', 121_000)]
assert.deepEqual(sliceFrom(series, '2026-03-01').map((p) => p.date), ['2026-02-28', '2026-03-31'])
assert.deepEqual(sliceFrom(series, '').map((p) => p.date), series.map((p) => p.date))
assert.deepEqual(sliceFrom(series, '2025-01-01').map((p) => p.date), series.map((p) => p.date))
assert.deepEqual(sliceFrom(series, '2030-01-01').map((p) => p.date), ['2026-03-31'])
// Order of the input does not decide which point is treated as the base.
assert.deepEqual(sliceFrom([...series].reverse(), '2026-03-01').map((p) => p.date), ['2026-02-28', '2026-03-31'])

// ---- twrForScope: windowing and account scoping ----------------------------
const stored: TwrSeries = {
  all: series,
  byAccount: { a1: series, a2: [point('2026-01-31', 10_000), point('2026-03-31', 9_000)] },
  generatedAt: '2026-03-31T20:00:00.000Z',
}
const txns = [txn('c2', '2026-03-10', 'Contribution', 11_000), txn('c3', '2026-03-10', 'Contribution', 500, 'a2')]

const windowed = twrForScope(stored, 'all', txns, '2026-03-01')
assert.ok(windowed.ok)
// The window starts on the last point before the cutoff, not at the cutoff.
assert.equal(windowed.startDate, '2026-02-28')
// 121,000 − 110,000 − 11,500 of contributions from both accounts = −500.
assert.equal(windowed.gainUsd, -500)
assert.ok(Math.abs(windowed.twrPct - -500 / 110_000) < 1e-9)

// Without a window the earlier step is included and the contribution still only
// affects the step it landed in: +10,000 then −500.
const full = twrForScope(stored, 'all', txns)
assert.equal(full.startDate, '2026-01-31')
assert.equal(full.gainUsd, 9_500)

// Scoping to an account uses that account's series and only its transactions.
const scoped = twrForScope(stored, 'a2', txns)
assert.equal(scoped.gainUsd, -1_500) // 9,000 − 10,000 − 500
assert.equal(twrForScope(stored, 'missing', txns).ok, false)

// A window that leaves fewer than two points cannot be computed.
assert.equal(twrForScope(stored, 'all', txns, '2030-01-01').ok, false)

// ---- annualized figure still tracks the linked window ----------------------
assert.equal(clean.startDate, '2026-01-31')
assert.equal(clean.endDate, '2026-03-31')
assert.equal(clean.days, 59)
assert.ok(clean.annualizedPct > clean.twrPct) // under a year, so it scales up

console.log('twr tests passed')
