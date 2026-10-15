# SimonFIRE

SimonFIRE is a personal portfolio, income, and allocation tracker for Schwab accounts. It combines live brokerage data, imported accounting records, saved balance history, and review tools to explain portfolio equity, income, spending, and funding.

## Pages and workflows

- **Today** — plan health, net equity, margin, income coverage, equity growth, transaction changes, account summaries, and funding review by account and month.
- **Positions** — holdings, cost basis, gains, source information, sorting, and CSV export.
- **Transactions** — account-scoped activity, category/symbol/date filters, saved views, CSV export, manual corrections, and recoverable archiving. Mark individual or selected records reviewed, undo a review, and filter by review status. Reviews record a timestamp and reopen when material transaction details change; they do not dismiss data-quality warnings.
- **Cash Flow** — income, spending, contributions, margin costs, and transaction details.
- **Dividends** — historical distributions, current-share income estimates, payment projections, and income by symbol.
- **Allocation** — bucket targets, contribution sizing, holdings review, protective-put planning, and order review. Targets use Growth, CEFs, High Yield, and Leveraged buckets. Contribution plans support gap filling, equal allocation, trend tilting, and trend priority, with account capacity and expense-reserve checks.
- **Month Close** — recorded monthly equity, debt, cash flows, coverage gaps, and a reconciliation bridge.
- **Historical Value** — recorded equity and margin history, daily estimates, time-weighted returns, and source/coverage indicators. Return displays include the investment gain in dollars for the measured window.
- **Ledger** — monthly transaction groups, running summaries, tags, and progressive loading.
- **Account Detail** — account balances, holdings, activity, and return breakdowns.
- **Reports** — portfolio and income summaries, including protective-put information.
- **Data Quality** — missing information, potential duplicates, import history, and backup/restore tools.
- **Connections** — Schwab authorization, synchronization, CSV/PDF imports, and connection status.
- **Preferences** — freshness thresholds, privacy, density, notification state, and backup status.

Global controls include account scope, date range, sync, and balance privacy. Date-range behavior is page-specific; some pages have their own range controls.

## Protective puts and orders

Allocation includes individual-position protective-put scenarios and a portfolio proxy-hedge planner. The tools model contract coverage, premium cost, expiration payoff, scenario loss offsets, premium budgets, and roll timing. Available option-chain data supports contract ranking and order previews. Proxy beta and crash scenarios are planning assumptions; proxy protection does not guarantee a portfolio loss floor.

Equity and option order requests go through Netlify Functions. Live placement is disabled unless `SCHWAB_ORDER_PLACEMENT_ENABLED` is exactly `true`. Planning a trade or copying a ticket does not submit it. Review account, contract, quantity, price, and broker preview before explicitly submitting an order.

## Data and persistence

The React store caches app data in browser `localStorage`. Sample data is available without a backend. A production deployment also uses Netlify Blobs for Schwab tokens, shared preferences and transaction overrides, balance history, and rotating backups.

Shared records include transaction classifications and reviews, funding decisions, allocation settings, imported accounting authorities, and other preferences. Device display settings and some temporary planning inputs remain local. The app is a personal deployment; it does not currently provide a multi-user sign-in and per-user storage model.

CSV/PDF parsing occurs in the browser. Imported records and preferences can subsequently be saved to the configured backend or included in backups; imports should not be treated as browser-only storage.

### Accounting and source coverage

- Imported statement balances take precedence over automatic snapshots for the same account/month.
- Recorded equity growth includes contributions and recorded spending. Funding-adjusted diagnostics separately estimate investment results.
- Missing coverage and unresolved funding differences remain visible rather than being treated as zero.
- Income projections use available distribution information and current holdings; they are estimates.
- TWR neutralizes classified external cash flows. Its accompanying dollar gain uses the same accepted sub-periods, and is not simply the return percentage multiplied by the starting balance. Option-trade cash is neutralized where historical option values are unavailable.

### Funding review

On Today, expand **Review funding by account and month** to compare recorded deposits/withdrawals with transaction totals. Import missing records or open a transaction to correct its category. **Review funding** can classify outside funding or confirm an internal transfer by selecting an equal, opposite cash movement in another account.

Decisions persist through sync. Clearing a funding decision restores automatic transfer matching while keeping category edits. Missing or changed transfer legs and unreconciled statement totals remain flagged. Include both accounts and dates when reviewing transfers.

### Automatic balance history

Every successful Schwab sync captures reported equity, margin debt, cash, and month-to-date cash flows. The scheduled `capture-month-close` function runs at **23:50 UTC** on production Netlify deployments, including weekends. It does not run automatically in Vite or preview deployments.

The balance archive retains first/latest observations per account/month, with conditional writes for concurrent captures. Month boundaries use `America/New_York`. A capture after 4 p.m. on the calendar month's final day is a recorded month-end checkpoint, not an official statement. Missed closes are not filled using a later month's balance. Imported statements can verify closes and fill older gaps.

An expired brokerage connection pauses captures. Saved history remains available, with stale/reconnect status. Reconnect through Connections.

### Backups

Data Quality supports local backup/restore and server checkpoints. The client attempts a daily server backup after live data is available; the server retains seven rotating restore points. This backup attempt depends on the client running and is separate from scheduled balance capture. Preferences shows the last recorded automatic-backup status.

## Development

Built with Vite, React, TypeScript, Tailwind CSS, React Router, Recharts, and Netlify Functions/Blobs.

```bash
npm install
npm run dev      # UI development server
npm run build    # TypeScript checks and production build in dist/
npm run preview  # Preview the built UI
npm run lint
```

Use `netlify dev` with a separately installed Netlify CLI to run the UI and functions together. Vite alone does not run brokerage, preference, backup, or scheduled functions.

Key implementation areas:

- `src/lib/store.tsx` — app state, persistence, imports, and shared preferences.
- `src/lib/calc.ts` and other modules in `src/lib/` — accounting and planning calculations.
- `src/lib/allocation-engine.ts` — contribution sizing and projections.
- `src/lib/hedge.ts` — put scenarios, ranking, sizing, and roll helpers.
- `src/lib/transaction-review.ts` and `transaction-overrides.ts` — review status and durable transaction edits.
- `netlify/functions/` — brokerage access, orders, preferences, snapshots, and backups.

### Tests

Tests are grouped by module. Run the suites relevant to a change, for example:

```bash
npm run test:review
npm run test:transactions
npm run test:income-performance
npm run test:allocation
npm run test:hedge
npm run test:twr
npm run test:balance-snapshots
```

Additional suites cover dividends, account sync, margin, realized P/L, spending, historical balances, equity reconciliation, and other workflows. See `package.json` for the complete command list. A production build does not run these test suites automatically.

## Production setup

Connect the repository to Netlify. `netlify.toml` configures the build, `dist/` publishing, functions, SPA routing, and asset caching. Uploading only `dist/` provides a static UI without the backend functions.

Configure the variables listed in `.env.example`:

- `SCHWAB_APP_KEY` and `SCHWAB_APP_SECRET` — Schwab application credentials, used server-side.
- `SCHWAB_CALLBACK_URL` — must exactly match the callback registered with Schwab, normally `https://YOUR-SITE.netlify.app/.netlify/functions/schwab-callback`.
- `APP_URL` — the exact public origin used for order-request checks.
- `SCHWAB_ORDER_PLACEMENT_ENABLED` — keep `false` until live order placement is intentionally enabled.
- `NODE_VERSION` — the example uses `22`.

After deployment, use Connections to authorize Schwab and sync. Expired authorization requires reconnection. Keep credentials and exported personal financial records out of Git.

## Limitations

Historical prices, incomplete transaction history, missing cost basis, option valuation, and proxy assumptions can affect estimates. Source labels and coverage warnings explain these gaps. Review broker records before relying on a calculation or submitting a trade.
