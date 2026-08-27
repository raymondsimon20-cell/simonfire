# Wiring Live Order Placement — Schwab Trader API

A reference for implementing the final "submit order" step yourself. Everything
feeding an order already exists in SimonFIRE (the SMA insights, the trim
tickets, the buy queue). This document covers the one piece that's yours to
own: the call that actually places the order at Schwab.

> **Who does what.** This app builds and reviews orders; it does not submit
> them. The code that POSTs a live order to your brokerage is yours to write,
> run, and be responsible for. Treat everything below as API reference, not as
> a drop-in that you should run unread.

---

## 1. The endpoint

```
POST https://api.schwabapi.com/trader/v1/accounts/{accountNumber}/orders
```

- `{accountNumber}` is the **encrypted account hash**, not your plain account
  number. You already resolve this in `netlify/functions/lib/schwab.ts` via
  `GET /accounts/accountNumbers` (see `hashByNumber` inside `fetchPortfolio`).
- **Auth:** `Authorization: Bearer <access_token>` — reuse the existing
  `accessToken()` helper, which refreshes automatically.
- **Body:** `Content-Type: application/json`, the order JSON (Section 3).
- **Scope:** order placement requires your Schwab app to be approved for the
  **Accounts and Trading** production API (the same app you already connected —
  read endpoints and trading share the one OAuth token).

### Response

- **`201 Created`** on success. There is **no JSON body**. The new order's ID
  comes back in the **`Location`** response header:
  `.../trader/v1/accounts/{hash}/orders/{orderId}`. Parse the last path segment
  to get `orderId`.
- Non-2xx returns an error body (`{ "errors": [...] }` / message string). A
  `201` means *accepted for routing*, **not filled** — check status separately.

### Checking status / cancelling

```
GET    /trader/v1/accounts/{accountNumber}/orders/{orderId}   → order status
DELETE /trader/v1/accounts/{accountNumber}/orders/{orderId}   → cancel (if open)
GET    /trader/v1/accounts/{accountNumber}/orders?fromEnteredTime=...&toEnteredTime=...
```

Order `status` progresses through values like `PENDING_ACTIVATED` → `WORKING`
→ `FILLED` (or `REJECTED`, `CANCELED`, `EXPIRED`). Poll the single-order GET a
few seconds after placing to confirm it wasn't rejected.

---

## 2. Preview first (strongly recommended)

Schwab exposes a **preview** endpoint that validates an order and returns
estimated cost/commission **without placing it**:

```
POST /trader/v1/accounts/{accountNumber}/previewOrder
```

Same body as a real order. Use it as your dry-run: build the payload, preview
it, show the user the estimate, and only then let them confirm the real POST.
This is the natural bridge between the app's order queue and a live submit.

---

## 3. Order payloads

### Market buy (equity/ETF)

```json
{
  "session": "NORMAL",
  "duration": "DAY",
  "orderType": "MARKET",
  "orderStrategyType": "SINGLE",
  "orderLegCollection": [
    {
      "instruction": "BUY",
      "quantity": 10,
      "instrument": { "symbol": "SCHD", "assetType": "EQUITY" }
    }
  ]
}
```

### Limit sell (equity/ETF)

```json
{
  "session": "NORMAL",
  "duration": "DAY",
  "orderType": "LIMIT",
  "price": "27.40",
  "orderStrategyType": "SINGLE",
  "orderLegCollection": [
    {
      "instruction": "SELL",
      "quantity": 50,
      "instrument": { "symbol": "SCHD", "assetType": "EQUITY" }
    }
  ]
}
```

### Field reference

| Field | Values | Notes |
|---|---|---|
| `orderType` | `MARKET`, `LIMIT`, `STOP`, `STOP_LIMIT`, `TRAILING_STOP` | |
| `price` | string, e.g. `"27.40"` | required for `LIMIT` / `STOP_LIMIT`; omit for `MARKET` |
| `session` | `NORMAL`, `AM`, `PM`, `SEAMLESS` | `NORMAL` = regular hours |
| `duration` | `DAY`, `GOOD_TILL_CANCEL`, `FILL_OR_KILL` | |
| `orderStrategyType` | `SINGLE`, `OCO`, `TRIGGER` | `SINGLE` for one-off orders |
| `instruction` | `BUY`, `SELL`, `SELL_SHORT`, `BUY_TO_COVER` | equities |
| `instrument.assetType` | `EQUITY`, `OPTION`, `MUTUAL_FUND` | |
| `quantity` | number | whole shares for equities |

### Option leg (for reference)

Options use the OSI symbol and option instructions
(`BUY_TO_OPEN`, `SELL_TO_OPEN`, `BUY_TO_CLOSE`, `SELL_TO_CLOSE`). `quantity` is
in **contracts**, and price is per-share (×100 multiplier applies at fill):

```json
{
  "instruction": "SELL_TO_OPEN",
  "quantity": 1,
  "instrument": { "symbol": "O     260918P00062500", "assetType": "OPTION" }
}
```

---

## 4. Where it slots into SimonFIRE

You already have the plumbing. A live-order feature is one new function plus a
UI confirm:

```
netlify/functions/
  lib/schwab.ts        ← reuse: accessToken(), the account-hash map, API_BASE
  schwab-order.ts      ← NEW (you write): the handler that previews/places
```

`schwab.ts` already gives you two of the three things the POST needs:

- `accessToken()` → a fresh bearer token.
- the `hashByNumber` logic in `fetchPortfolio` → resolve a plain account number
  (or your app's `acc_XXXX` id → mask → number) to the encrypted hash. Pull
  that into a small exported `accountHash(number)` helper you can reuse.

The third thing — the order JSON — you build from an order-queue row
(`symbol`, `shares`, side, optional limit price).

### Skeleton (the submit line is yours to write)

```ts
// netlify/functions/schwab-order.ts
import { accessToken, json, API_BASE } from './lib/schwab'

export default async (req: Request) => {
  // ⚠️ Gate this hard: verify it's your own request, require an explicit
  // `confirm: true` from a human click, and consider a preview step first.
  const body = await req.json()
  const { accountHash, order, dryRun } = body   // order = the JSON from Section 3

  const token = await accessToken()
  const path = dryRun
    ? `/accounts/${accountHash}/previewOrder`
    : `/accounts/${accountHash}/orders`

  // ── YOU IMPLEMENT THIS CALL ────────────────────────────────────────────────
  // POST `${API_BASE}${path}` with:
  //   method:  'POST'
  //   headers: { Authorization: `Bearer ${token}`,
  //              'Content-Type': 'application/json' }
  //   body:    JSON.stringify(order)
  // On a real order, read the `Location` response header to get the order id.
  // On preview, read the JSON body for the cost/commission estimate.
  // Return the result (or the error) to the caller.
  // ───────────────────────────────────────────────────────────────────────────

  return json({ ok: false, error: 'not_implemented' }, 501)
}
```

`API_BASE` is already exported from `schwab.ts` and points at
`https://api.schwabapi.com/trader/v1`, so `${API_BASE}${path}` is the full URL.

The client side is a thin call from the Order Queue / trim tickets: on a
confirm click, POST the built `order` to `/.netlify/functions/schwab-order`.
Everything the payload needs (symbol, quantity, side, price) is already in the
queue rows.

---

## 5. Guardrails — do these before trusting it with real money

- **Human confirm on every order.** Never let a rule, a page load, or a batch
  loop place orders unattended. One click = one reviewed order.
- **Preview first.** Wire `previewOrder` and show the estimate before the real
  POST. Cheap insurance against a fat-fingered quantity or a bad symbol.
- **Test tiny.** First live order: 1 share, or a `LIMIT` set far from the
  market so it rests and you can cancel it. Confirm the round-trip (place →
  status → cancel) before ever sending a market order.
- **Validate the payload.** Reject zero/negative/huge quantities, unknown
  symbols, and missing `price` on limit orders in your handler.
- **Idempotency.** A network retry shouldn't double-submit. Track a client-side
  request id and refuse duplicates.
- **Read the status.** A `201` is "accepted," not "filled." Poll the order and
  surface `REJECTED`/`FILLED` back to yourself.
- **Kill switch.** Keep a single flag (env var) that disables placement
  instantly if something misbehaves.

---

## Sources

- [Schwab Trader API order model — order-builder reference (schwab-py)](https://schwab-py.readthedocs.io/en/latest/order-builder.html)
- [The (Unofficial) Guide to Charles Schwab's Trader APIs](https://medium.com/@carstensavage/the-unofficial-guide-to-charles-schwabs-trader-apis-14c1f5bc1d57)
- [sudowealth/schwab-api — TypeScript client (trading endpoints)](https://github.com/sudowealth/schwab-api)

*This is API reference material to help you implement order placement yourself.
It is not financial advice, and placing live orders is at your own risk. Test
with your own brokerage's paper/small-order safeguards before relying on it.*
