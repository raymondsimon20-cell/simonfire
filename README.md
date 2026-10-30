# SimonFIRE

SimonFIRE is a personal portfolio, income, and allocation tracker for Schwab accounts. It combines live brokerage data, imported accounting records, saved balance history, and review tools to explain portfolio equity, income, spending, and funding.

## Pages and workflows

- **Today** — plan health, net equity, margin, income coverage, equity growth, transaction changes, account summaries, and funding review by account and month.
- **Positions** — holdings, cost basis, gains, source information, sorting, and CSV export.
- **Transactions** — account-scoped activity, category/symbol/date filters, saved views, CSV export, manual corrections, and recoverable archiving. Mark individual or selected records reviewed, undo a review, and filter by review status. Manual reviews record a timestamp and reopen when material transaction details change. Transactions older than a rolling four calendar months automatically count as reviewed, including later imports; they are labeled separately from manual reviews. Undo review explicitly returns an older transaction to the queue. Neither review method dismisses data-quality warnings.
- **Cash Flow** — income, spending, contributions, margin costs, and transaction details.
- **Dividends** — historical distributions, current-share income estimates, payment projections, and income by symbol.
- **FIRE Model** — account-scoped scenarios that invest all available salary, fund living expenses with margin, and apply cash dividends to debt. DRIP elections, inflation, price growth, distribution cuts, equity thresholds, optional borrowing constraints, and milestones are editable. Includes a cash-only comparison, income crossover, five charts, annual snapshots, a monthly audit table, and CSV export. Settings are saved per taxable account scope; no orders or brokerage elections change.
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

Allocation starts with a goal chooser for adding money, rebalancing, reviewing holdings, or managing protection. Plan explanations show how the sizing rule assigns money and why funds remain unassigned. Protective puts separates existing-position management, portfolio protection, and individual-holding scenarios; advanced portfolio assumptions are expandable.

Allocation includes individual-position protective-put scenarios and a portfolio proxy-hedge planner. The tools model contract coverage, premium cost, expiration payoff, scenario loss offsets, premium budgets, and roll timing. Available option-chain data supports contract ranking and order previews. Ranking requires a positive ask, an uncrossed bid/ask, and a future expiration. Contract identity must match the displayed strike and expiry before a portfolio plan can enter the queue. Replacement rolls preserve the existing contract quantity and account. Submitted orders become active hedges only after fill confirmation. Proxy beta and crash scenarios are planning assumptions; proxy protection does not guarantee a portfolio loss floor.

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

## AI transaction categorization

In Transactions, use **Suggest categories** for recent unresolved Other/Transfer records in the current view, or select transactions and choose **Suggest for selected**. Up to 25 records are sent per request. Review the category, explanation, and qualitative confidence, then accept, correct, or skip each suggestion. The app does not silently apply AI output or mark accepted categories reviewed.

Accepted categories use the same durable manual overrides as other corrections and survive sync. Optional saved rules match normalized descriptions and cash direction, can affect existing non-manual records across accounts, and apply on future imports. The UI shows that scope before you enable a rule. Pending suggestions and skips are saved on this browser by account scope, so navigation or refresh does not discard the batch. Changed or removed transactions invalidate pending suggestions. Manually classified records are excluded from automatic candidate selection; you can explicitly select them for a second opinion.

### Enable AI on Netlify

1. Add `OPENAI_API_KEY` as a server-side environment variable. Never put it in source, chat, browser storage, or a `VITE_` variable.
2. Optionally set `OPENAI_CATEGORIZATION_MODEL` (defaults to `gpt-4o-mini`) and `AI_CATEGORIZATION_DAILY_LIMIT` (defaults to 50 requests per UTC day, maximum 200; 0 disables requests).
3. Redeploy, then open Transactions and request suggestions. API access and billing must be enabled for the selected model.

The Netlify function calls the OpenAI Responses API with [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), validates every returned category and ID, and requests `store: false`. It sends descriptions with long numeric references redacted, symbols, amounts, units, and current categories. Structured account, balance, date, and original transaction-ID fields are omitted. Descriptions can still contain identifying text; the panel discloses the provider and data before sending.

Paid requests are bounded by batch size, output limits, a timeout, and an atomic site-wide daily request ceiling in Netlify Blobs. Failed provider calls still consume a request slot. Origin/header checks reject browser requests from other sites; they are not user authentication. Use this feature within the personal deployment’s access controls. No key, quota exhaustion, malformed output, or provider failure changes transaction categories.

Run `npm run test:ai` for request validation, redaction, stale suggestions, provider failures, and concurrent daily-limit checks. Local tests mock OpenAI and do not send financial data or make billable requests. Use `netlify dev` for local UI-to-function testing; Vite alone does not run the AI endpoint.

## AI allocation and portfolio protection

Allocation’s **Review with AI** analyzes the selected account scope for a **12-month total-return objective**, with **3- and 6-month monitoring checklists**. It reviews current holdings rather than discovering new securities or conducting live external research. The evidence table distinguishes historical price returns from estimated distribution yields; it does not claim a validated probability of profit or a distribution-adjusted total-return forecast.

A Schwab sync now saves 3/6/12-month price-return evidence, annualized daily price volatility, historical drawdowns, and price-return beta/correlation to QQQ and SPY. It reuses the history fetched during sync, with an extra history margin for calendar boundaries. Existing cached insights need a new sync to populate these fields. Short or stale histories, incomplete moving averages, and daily price moves over 40% prevent shortlist eligibility; large moves require a corporate-action/price-adjustment check. Proxy beta is withheld when fewer than 80% of long holdings have sufficiently covered history. Estimates are historical and can fail under stress.

AI ranks only eligible supplied holdings and explains both the evidence and a downside for each. **Use shortlist in contribution plan** filters the deterministic engine’s original buys; it preserves share quantities, target gaps, expense reserves, and spending checks. Money excluded by the filter stays unassigned. Changing plan inputs, account scope, holdings, aggregate balances, or reviewed hedge evidence invalidates the filter. Quote-based filters expire with their five-minute quote window; other reviews expire after 24 hours. Allocation reviews, applied shortlists, and relevant plan inputs are saved immediately on this browser by data source and account scope. They survive navigation and refresh; expired reviews stay readable but cannot be applied, and restored shortlists retain their original expiry. Browser storage errors are shown instead of silently claiming a save. These AI review caches are device-local and are not shared to another browser. Targets and live orders never change automatically.

For protection, the review includes aggregate equity/debt, existing long puts, historical proxy estimates, and the portfolio planner’s user-assumed beta/scenario. Select a live QQQ or SPY quote in Protective Puts to include the selected contract and up to three ranked alternatives. Their sizing, premium costs, and residual losses are calculated by code. Quote-based reviews expire after five minutes. Delayed quotes and manually edited underlying prices cannot be treated as current executable evidence; edited inputs invalidate the review. These are intrinsic-payoff scenarios, not an interim loss guarantee or whole-portfolio insurance.

Additional-put sizing credits the modeled change in **existing same-proxy puts that remain active through the proposed expiration**. The credit is scenario intrinsic payoff less current market value, not original premium. Puts expiring earlier are not credited. Other proxies, credit risk, shorts, changing beta, and timing mismatches can leave substantial gaps. Replacement rolls remain a separate workflow with linked close/open quantities.

The feature uses the existing server-side `OPENAI_API_KEY`; `OPENAI_ALLOCATION_MODEL` optionally overrides the categorization model. Categorization and allocation share `AI_CATEGORIZATION_DAILY_LIMIT`. Only bounded ticker-level evidence, targets/budget, aggregate equity/debt, and option scenarios are sent. Account identifiers, transaction history, names, and credentials are excluded. OpenAI responses are validated; unknown/ineligible ticker picks are rejected. `store: false` is requested. No private portfolio data is sent until the user requests a review.

Run `npm run test:ai-allocation` for evidence, freshness, input/output validation, privacy, shortlist quantity preservation, existing-put sizing, and expiration coverage checks. Provider calls are mocked in local tests.

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

### AI help for Today funding review

On Today, expand **Review funding by account and month** and choose **Review funding with AI**. The assistant explains possible causes of differences and suggests what to check or import. It reviews up to six account/months at a time, using monthly totals and up to 12 redacted transaction descriptions per group. Account names and identifiers are omitted from the request; transaction amounts, categories and month are included. Guidance is advisory and never changes funding decisions, statement totals or review markers. Confirm transfers and category corrections using the existing controls.

Reviews save on the current browser/device and survive navigation and refresh. When records or the selected range change, refresh the AI review before relying on it. This uses the existing `OPENAI_API_KEY`, `OPENAI_CATEGORIZATION_MODEL` and shared daily AI request limit; no additional key is needed.

### Updating an existing account from CSV

In Connections → Import, choose **Update existing account**, select the destination account, and upload its Positions and/or Transactions CSV. Use one account per import. Review cost-basis updates, matched records, new transactions and held rows before applying. This preserves live balances, quantities and prices, other accounts, manual decisions and reviews. Matching holdings receive known numeric cost basis only when quantities agree; missing basis, unmatched holdings and quantity differences are held. The same file can be imported again without adding matched records again.

Uncertain date differences, possible split fills, repeated input rows and archived-record matches are held instead of added. Held rows are visible in the preview and are not saved; compare them with broker records before reimporting. A sync or edit after preview requires a fresh preview. **Add alongside** remains an append operation and can duplicate overlapping data.

PDF statements remain the foundation for monthly balances and verified transaction history. The importer now reads dated holdings, cost basis, unrealized gains, options, estimated annual income/yield, cash/debt summaries, realized-gain summaries, reported margin rate and interest, and pending-activity totals from supported Schwab statement layouts. It does not reconstruct full tax lots. Verified statement cost basis can update matching current securities and quantities while preserving live prices and inventory; a later CSV cost-basis import takes precedence. The import preview offers a checkbox to keep snapshots without applying their basis. Snapshots retain filename/page evidence, save across devices, and can be inspected in Connections → Imported statements. Pending activity remains separate from received income and is never imported twice as a cash transaction. Unsupported or unreconciled tables are held for review.

Positions now shows a scoped, expandable source summary instead of a recurring age-only CSV banner; quantity changes against an active CSV cost-basis snapshot still raise a warning.

Statement imports support older mutual-fund tables and joined gain/yield headings, and include non-sweep money-market investments separately from transaction cash and securities cost basis. Cash-only months are verified only when zero securities basis and unrealized gain, ending cash, and account equity reconcile. Months with no transaction-detail table are marked as verified inactivity only when all six cash-activity totals and other activity are explicitly zero and opening/ending cash agree. Held transaction overlaps now include an explanation; uncertain matches are still not added again.

Cost-basis health is based on the sources actually used by current holdings. Data Quality reports PDF/CSV/API/manual counts, and the app-wide banner warns about active CSV quantity mismatches rather than the age of a retained CSV. Old position, transaction and realized-P/L import dates remain reference information; age alone does not lower confidence or invalidate historical accounting records.

### Funding review without reviewing every routine transaction

Today keeps the cash-contribution adjustment optional and collapsed. Funding review starts collapsed too; account/month sections show only exceptions first, with all cash records available in a paged detail view. Verified statement funding rows take precedence over extra API activity only when recorded deposits and withdrawals independently reconcile and every statement funding row has exactly one saved matching identity. Manual category corrections and explicit funding decisions are preserved and can still block reconciliation. Original transactions are not deleted or archived by this calculation.

Known cash sweeps and SMA bookkeeping are excluded from cash funding. Explicit Schwab Bank boundary movements are never automatically paired across brokerage accounts just because their amounts agree. When generic Transfer records explicitly identify that bank boundary, **Confirm bank transfers as outside funding** previews and saves them together, supports Undo, survives sync/reload, and rejects changed records. Missing rows, ambiguous counterparts, manual conflicts and unexplained journals remain exceptions. AI help is optional inside the review.

## FIRE projection accounting

Open **FIRE Model** and select the taxable account scope. Retirement accounts are excluded. Actual selected taxable holdings, cash and margin debt supply the opening values, with broker equity authoritative where available. Options and short holdings retain their current marked values with no modeled growth, dividend income, expiry payoff or sale proceeds. Positive cash is included as a non-yielding asset; any broker balance reconciliation remains fixed and is not treated as spendable cash. Cross-account transfers within an all-taxable scenario are assumed; the model does not check transfer or borrowing eligibility.

Salary is the full amount available after payroll deductions. By default, investing pauses when opening equity or the ordinary projected month-end equity would breach the limit: salary, one-time contributions and would-be DRIP distributions service margin instead. The model tests again each month and resumes investing once the opening and projected balances meet the limit. Expenses and interest continue, so a pause may not restore equity. Opening holdings earn estimated dividends and price appreciation; DRIP dividends compound while investing is active; salary and one-time contributions are applied at month end. During a pause, would-be DRIP distributions become cash for debt repayment and contributions reduce the remaining balance. Any surplus after debt reaches zero can be invested. In margin mode, living expenses increase debt, interest is calculated on opening debt plus those expenses, and cash dividends then repay debt. Any dividend surplus after debt reaches zero is invested. New investments follow the selected DRIP mix. Taxes, insurance premiums, and other costs must be included in expenses or reflected in lower yield assumptions.

Cash-only mode retains starting debt but creates no new borrowing. It uses cash dividends, positive cash, then asset sales for expenses and interest. The default full-timeline view flags the first modeled equity breach and continues the hypothetical projection; it does not claim the broker will allow further borrowing or collateral sales. Enable **Stop at equity limit** to end either mode at the breach. Cash-only always stops if spendable assets cannot fund expenses. These are simplified monthly constraints, not broker buying power. Opening breaches remain flagged. Automatic paydown can attempt recovery; with strict stopping enabled, the model gets one recovery month before enforcing the closing threshold.

The monthly table and export distinguish salary available, salary invested, salary routed to margin, redirected DRIP, and investment pause status. The salary-invested chart excludes salary used for debt repayment.

The income crossover is the first month when cash dividends cover expenses plus interest for all remaining projected months. Salary is excluded from that coverage test, but continues to be invested according to the scenario; the crossover is not a separate simulation of quitting work. Yields are estimated from current-share fundamentals and historical fallbacks, are held constant against projected market value, and are not total-return forecasts. Zero price growth is the default. DRIP choices are manual scenario assumptions, not inferred or changed brokerage elections. Model debt, yield, and allocation overrides can be reset to current portfolio values.

The FIRE page shows source and last-sync time, actual share/contract counts and marks, and a reconciliation of holdings, cash, debt and reported equity. **Use current portfolio** clears starting-debt, yield and new-money allocation overrides while retaining salary, expenses, DRIP choices and milestones. Portfolio values automatically follow later syncs and imports; a sample dataset is explicitly labeled as sample data.

## Portfolio protection review (advisory only)

In **Allocation → Protective Puts → Protect the portfolio**, the portfolio protection review uses a fixed **50% equity target**. It compares HOLD with ADD or ROLL for **5%, 10%, 20% and 30% QQQ-proxy declines**, using each holding’s observed or explicitly supplied QQQ beta. Fund leverage is recorded separately and never multiplied into an observed beta a second time. The read-only price-history calculation uses at least 60 aligned daily price-return observations; distributions are excluded, so it is not a total-return regression or a validated crash correlation.

A Positions CSV may be loaded as an isolated risk-review snapshot. It does not import or duplicate portfolio records. Select one brokerage account and confirm the snapshot’s cash and margin debt; aggregate multi-account views are provisional because cross-account collateral offsets are not assumed. Quantities and values are validated against the CSV, including per-contract option marks. Broker maintenance evidence and beta/correlation source evidence are required before a final candidate is shown; unavailable evidence keeps the review provisional. Missing fields stay unknown rather than inheriting generic margin requirements. **Load Schwab risk data** fetches cash/debt, explicit position-level maintenance requirements and aligned price-history beta/correlation. An account-level requirement is never distributed across holdings; unavailable per-holding rates remain unknown. Accounts match only by exact ID or an exact four-digit mask. Snapshot maintenance is used only for matching shares and prices; snapshot cash/debt are never replaced by this button. A failed refresh clears prior auto-loaded requirements while preserving manual evidence. Leverage is optional explanatory context and is never multiplied into observed beta. The existing AI allocation review receives only aggregate deterministic HOLD/candidate comparisons for all four stress scenarios and their evidence status, without account identifiers; it explains advisory results and cannot authorize trades. Schwab can impose account-specific house requirements; see [Schwab’s margin requirements](https://www.schwab.com/margin/margin-rates-and-requirements).

The engine tests supported 100-share QQQ puts across available strikes, expirations and integer quantities. The expiration must cover the stress horizon; a replacement must expire later than the held put. It sizes against projected portfolio equity and maintenance shortfalls, checks the immediate post-transaction balance using the new put’s bid, then checks all four declines. The purchase budget includes gross premium and both legs’ fees. Feasible within-budget sizes take priority over cheaper near-misses. HOLD remains the result when it already meets the modeled targets; otherwise no candidate is recommended if evidence or feasibility is insufficient.

Purchases use ask and closes use bid. Net debit includes open premium, closing proceeds and per-leg fees; debt financing includes existing borrowing plus the net debit for the chosen horizon. Existing puts contribute intrinsic value less their current marked value, not less their historical purchase cost. A rolled-out put is removed exactly once. Intrinsic-only protection is a conservative horizon floor, not an estimate of pre-expiry time value or a guaranteed executable sale price. No broker offset for puts is assumed in maintenance calculations. Unsupported options, expired-at-horizon protection and missing data are disclosed.

Option placement is blocked server-side even if an old client calls the previous placement endpoint. Queue records and timing checks are informational, live placement controls and manual roll-status approvals are disabled, and recommendations cannot submit orders. Equity-order workflows are separate. Risk inputs save locally in this browser; CSV snapshots remain review-only. A quote refresh is required after five minutes, and delayed quotes cannot produce a final recommendation.
