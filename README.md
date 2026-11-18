# Inventory Tracker

A small Next.js app for tracking coffee-shop inventory and weekly production, backed entirely
by a Google Sheet (no database) via a service account.

## Setup

Copy `.env.example` to `.env.local` (not committed) and fill in:

- `GOOGLE_SHEETS_SPREADSHEET_ID` — the sheet this app reads/writes.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` — a Google service
  account with edit access to that sheet.
- `APP_PASSPHRASE` — single shared passphrase gating the whole app (see `/login`).
- `MCP_ACCESS_TOKEN` — bearer token gating `/api/mcp` (see below).

Then:

```bash
npm run dev
npm test   # unit tests for unit parsing and production math
```

## The sheet

Six core tabs, each a flat table with a header row (no numeric IDs — everything is keyed by name):

- **inventory** — the purchased-goods catalog (item, category, supplier, unit conversion,
  threshold), plus one date column per physical count, oldest to newest.
- **recipes** — batch processes (brewing, roasting, etc.) and their oz yield per batch.
- **products** — the countable units you actually order/reserve (a bottle, a keg, a bag size),
  each pointing at the one recipe it's filled from.
- **standing orders** / **a la carte orders** — recurring demand and one-off dated demand.
- **reserve stock** — target on-hand levels for whichever products or recipes you keep a
  buffer of, shaped like `inventory` (fixed columns + one date column per physical count).

Three more tabs track the money side of `inventory`. They're separate tabs because every column after
`threshold` on `inventory` is read as a count date:

- **a items** — `item | unitCost`. The items counted weekly; everything else is eyeballed. For these,
  `threshold` is the par (the level to buy back up to) and `unitCost` is dollars per top-level pack.
- **purchases** — `date | store | item | quantity | cost | notes`, one row per item bought.
- **buy list** — `item | added | done`, eyeballed items flagged by hand.

## Using it

- **`/`** — buy list: A items below par with how many whole packs to buy, plus hand-added items,
  grouped by supplier; then A items never counted, not counted in 7+ days, or needing a fix.
- **`/month`** — the calendar month's receipts: total spent and number of runs, by store and by
  item (receipt cost if entered, else packs × `unitCost`), plus A items' shelf value at the last
  count. Deliberately no "used" or waste math. `?month=YYYY-MM` for other months.
- **`/production`** — this week's plan as four steps: what's due from Wednesday through the
  following Tuesday (popup, deliveries, catering), what that takes from reserves, what orders still
  need made Mon/Tue, and how far reserves could be refilled (optional, your call). Counts are taken
  after service, so an order dated on or before an item's latest count is treated as already
  reflected in it. Next window's one-offs and non-weekly orders show as a heads-up.

Editing `recipes`/`products`/`standing orders`/`reserve stock` directly in the sheet is expected
day-to-day — the app never needs a code change for a new product or a renamed recipe, only
self-consistent data across the tabs.

## Claude.ai connector (MCP)

`/api/mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server (built with
[`mcp-handler`](https://www.npmjs.com/package/mcp-handler)) that lets a Claude.ai conversation —
including voice dictation — write inventory counts straight to the `inventory` sheet, without
going through Anthropic's separate Autosheet feature or its credit limits.

Its main tool, `record_inventory_count(date?, counts: {item, count}[])`, matches each `item`
against the live catalog (case-insensitive) and calls `writeCountColumn`, so counted items land in
a dated column and everything else carries forward. Unrecognized item names are reported back
instead of guessed, and a count 3x or more off the previous one comes back in `checkThese` for
Claude to read back. The others: `list_inventory_items` (flags `aItem` for the weekly
count), `update_item_threshold`, `add_inventory_item`, `add_order` (a dated one-off order into
`a la carte orders`, with the item matched to an exact product or recipe name), `record_purchase`
(also closes matching buy-list entries), `add_to_buy_list`, and `get_buy_list`.

The route enforces its own auth (a bearer token checked against `MCP_ACCESS_TOKEN`) rather than
the app's cookie-based passphrase gate, since an MCP client can't hold a browser cookie —
`src/proxy.ts`'s middleware matcher excludes `api/mcp` for this reason, same as it already does
for `api/login`.

**Connecting it in Claude.ai** (Settings → Connectors → Add custom connector):

- **MCP server URL**: the deployed app's `/api/mcp` endpoint.
- **Authentication**: **No sign-in** — this server isn't an OAuth provider, just a static token.
  (If you pick "Sign in now"/"Sign in when needed" instead, Claude reserves the `Authorization`
  header for its own OAuth flow and won't let you set it manually.)
- **Request headers**: add header `Authorization`, value `Bearer <MCP_ACCESS_TOKEN>`.

Request-header auth is currently in beta and gated per Claude.ai organization — if the **Request
headers** section doesn't show up in the dialog, it isn't enabled for your account yet.
