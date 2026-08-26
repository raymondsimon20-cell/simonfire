# SimonFIRE

A personal clone of **Paycheck to Portfolio** (app.paycheck2portfolio.com) — a dark-themed
portfolio & income tracker for dividend/options-income investors. Rebuilt from scratch as a
Netlify-ready single-page app.

## Features (all 8 pages, fully working)

- **Dashboard** — gross/net value, margin used, equity %, day change, total gain/return, account cards.
- **Positions** — sortable holdings table (day change, total gain, total return, value, weight), KPIs, CSV export, symbol search.
- **Transactions** — all activity with Type/Symbol/Date filters, "Totals by Type", **Add Contribution** modal, CSV export, delete.
- **Cash Flow** — income/expense/margin/contribution KPIs, daily net-operating bar chart, transaction detail table, date-range + category filters.
- **Dividends** — trailing 12M income, monthly average, projections (annual/monthly, yield on cost, forward yield), 12-month projected-payments chart, income-by-symbol table.
- **Month Close** — monthly equity reconciliation, balance sheet, and an **Equity Change Bridge** waterfall (Opening → Contrib → Net Oper → Realized P/L → Accounts Added → Mkt & Other → Closing).
- **Ledger** — complete transaction ledger grouped by month with running summaries, cash-impact coloring, and an inline **tag editor**.
- **Connections** — brokerage connections, sync status, account expanders, a **Connect a Brokerage** flow (SnapTrade-style broker list), and a connection event log.

Global: account-scope selector, Sync All (re-prices holdings), and a reset-to-sample-data button.

## Tech stack

- **Vite + React + TypeScript + Tailwind CSS v4**
- **react-router-dom** for routing, **recharts** for charts, **lucide-react** for icons.
- **Data layer**: everything runs against a swappable store in `src/lib/store.tsx`, persisted to
  the browser's `localStorage`. Ships with a realistic, deterministic sample dataset
  (`src/lib/seed.ts`) — ~160 holdings across 3 Schwab accounts and ~13 months of transactions.
  All derived metrics live in `src/lib/calc.ts`.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
npm run preview  # preview the build
```

## Deploy to Netlify

This repo is Netlify-ready. Either:

1. **Drag-and-drop**: run `npm run build` and drop the `dist/` folder onto app.netlify.com.
2. **Git integration**: connect the repo; Netlify reads `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - SPA redirect (`/* → /index.html`) is configured for client-side routing.

## Loading your real data (CSV import)

The app ships with sample data, but you can load your actual portfolio with no backend:

1. In **Schwab**, export your data as CSV:
   - **Positions**: Accounts → Positions → **Export** (top-right).
   - **Transactions**: Accounts → History → Transactions → **Export**.
2. In the app, go to **Connections → Import CSV** (or Connect New Broker → pick your broker).
3. Upload the positions and/or transactions CSV, preview the parsed counts, and click **Replace with imported data** (or add alongside the sample data).

Everything is parsed in your browser and stored in `localStorage` — nothing is uploaded anywhere.
The importer (`src/lib/import.ts`) tolerates Schwab's title rows, per-account sections,
`$`-formatted numbers, and maps Schwab actions (dividends, buys/sells, transfers, margin interest)
to the app's transaction types. Multi-account exports are split automatically.

Live auto-sync via **SnapTrade** (what the original app uses) is the planned phase 2 — see below.

## Upgrade path: real cloud data (Supabase)

The store is intentionally isolated. To move from `localStorage` to real accounts + cloud sync:

1. Create a Supabase project; add tables mirroring `src/lib/types.ts` (accounts, positions, transactions, connections).
2. Replace the `load`/`save`/mutation functions in `src/lib/store.tsx` with Supabase queries (`@supabase/supabase-js`), keeping the same `StoreCtx` interface — no page changes needed.
3. Add Supabase Auth for sign-in; put keys in Netlify env vars.
4. For live brokerage sync, integrate **SnapTrade** (what the original uses) behind the Connections page.

## Notes

All figures are illustrative sample data generated locally — nothing here is real financial data or
advice.
