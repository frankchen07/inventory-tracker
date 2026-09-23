# Inventory Tracker

A small Next.js app for tracking coffee-shop inventory and weekly production, backed entirely
by a Google Sheet (no database) via a service account.

## Setup

Copy `.env.local` (not committed) with:

- `GOOGLE_SHEETS_SPREADSHEET_ID` — the sheet this app reads/writes.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` — a Google service
  account with edit access to that sheet.
- `APP_PASSPHRASE` — single shared passphrase gating the whole app (see `/login`).
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob, used to store uploaded scan photos.
- `OPENROUTER_API_KEY` — used to OCR a photographed count sheet on upload.
- `MCP_ACCESS_TOKEN` — bearer token gating `/api/mcp` (see below).

Then:

```bash
npm run dev
```

## The sheet

Six tabs, each a flat table with a header row (no numeric IDs — everything is keyed by name):

- **inventory** — the purchased-goods catalog (item, category, supplier, unit conversion,
  threshold), plus one date column per physical count, oldest to newest.
- **scan photos** — links a count date back to the photo it was OCR'd from.
- **recipes** — batch processes (brewing, roasting, etc.) and their oz yield per batch.
- **products** — the countable units you actually order/reserve (a bottle, a keg, a bag size),
  each pointing at the one recipe it's filled from.
- **standing orders** / **a la carte orders** — recurring demand and one-off dated demand.
- **reserve stock** — target on-hand levels for whichever products or recipes you keep a
  buffer of, shaped like `inventory` (fixed columns + one date column per physical count).

## Using it

- **`/`** — inventory dashboard: what's low stock, what needs review (a count that couldn't be
  parsed), link to the raw sheet.
- **`/scans/upload`** — photograph a filled-in inventory count sheet; OCR drafts the numbers,
  you review and confirm before anything is written back to `inventory`.
- **`/production`** — this week's plan: what's needed for the Wed–Sat popup/deliveries, current
  reserve levels, and what to brew/roast/make Mon/Tue to cover it. Always computed off *this*
  calendar week — reopening it later in the week doesn't change what window it's planning for.

Editing `recipes`/`products`/`standing orders`/`reserve stock` directly in the sheet is expected
day-to-day — the app never needs a code change for a new product or a renamed recipe, only
self-consistent data across the tabs.

## Claude.ai connector (MCP)

`/api/mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server (built with
[`mcp-handler`](https://www.npmjs.com/package/mcp-handler)) that lets a Claude.ai conversation —
including voice dictation — write inventory counts straight to the `inventory` sheet, without
going through Anthropic's separate Autosheet feature or its credit limits.

It exposes one tool, `record_inventory_count(date?, counts: {item, count}[])`, which matches each
`item` against the live catalog (case-insensitive) and calls the same `writeCountColumn` used by
the photo-scan-confirm flow — so counted items land in a dated column and everything else carries
forward, same semantics either way. Unrecognized item names are reported back instead of guessed.

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
