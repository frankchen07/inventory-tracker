# Verifying behavior-preserving refactors against the live sheet

**Date**: 2026-10-02

## The problem
There's no database or seed data — every page computes off the real Google Sheet, and the
production plan depends on today's date. Unit tests cover the pure math, but not the Sheets
read/merge layer (e.g. carry-forward across date columns), which is exactly what a refactor
tends to touch.

## The solution / decision
Capture a golden before and after, same day, and diff:
1. **Data**: a throwaway script (outside the repo, or deleted after) that dumps
   `computeProductionPlan()`, `getInventorySnapshot()` + `computeRestockList()` to JSON. Run with
   `node --env-file=.env.local --import tsx ./script.mts out.json`.
2. **HTML**: `next dev`, then curl `/`, `/production`, `/scans/upload` with cookie
   `inventory_auth=$APP_PASSPHRASE` (read from `.env.local`, never echoed), strip `<script>`,
   `<link>`, `<style>`, and diff.
Expected noise: React `<!-- -->` text-node markers shift when JSX text splits change.

Write paths (`writeCountColumn` via scan confirm / MCP) hit the real sheet — don't exercise them
without Frank's OK.

## Why it wasn't obvious
- tsx treats `.ts` as CJS here (no `"type": "module"`), so top-level `await` fails — use `.mts`.
- Any rows-by-position code (`readLatestValues`, `writeColumnValues`) assumes the catalog has no
  blank spacer rows; `readRows` drops blank rows, so one spacer silently misaligns counts.
- A server component that calls `new Date()` with no dynamic API is prerendered at build time
  (`/scans/upload` shows ○ Static in `next build`) — its "today" is the deploy date.

## Pointers
- `src/lib/sheets.ts` (`readLatestValues`), `src/lib/production.ts` (`buildProductionPlan`)
- `npm test` — pure-function tests in `src/lib/*.test.ts`
