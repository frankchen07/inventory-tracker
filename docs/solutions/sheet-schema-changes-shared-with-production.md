# Sheet schema changes are live for production immediately

**Date**: 2026-11-16

## The problem
There is one Google Sheet. The deployed `main` (which the Claude.ai voice connector hits) and any
branch under development both read and write it. Inventory v2 needed `tier` and `unitCost` per item,
and the obvious place was two new columns on `inventory`. But `main` reads that tab by position:
- `CATALOG_HEADERS` is 5 columns.
- Every named header from column F onward is a count date (`listDateColumns`, `mergeDateColumns`).

So inserting columns would have broken production the moment the sheet changed, long before the
branch shipped:
- **Named headers:** "tier" and "unitCost" sort after the ISO dates, so `latestDate` becomes
  "unitCost" and A items read "A" as their count.
- **Blank headers:** reads survive, but `getOrCreateDateColumn` computes the next column as
  `fixedColumnCount + cols.length`. That is now 2 short, so the next voice count overwrites an
  existing date header.

## The solution / decision
Make sheet schema changes additive: new tabs (`purchases`, `buy list`), which `main` never reads.
An `a items` tab (`item | unitCost`) was used the same way, then dropped on 2026-11-17 when frank
chose to work off `inventory` alone; `threshold` stays the running-low line, so no column moved. Snapshot `getInventorySnapshot()` to JSON
before and after any live sheet write, and `cmp` the two.

Related convention, decided in the same work: the buy list goes by the latest count alone.
Purchases dated on or after an item's count day only label it "bought" until the next count. An
earlier version added those purchases to the count, which double-counted anything bought earlier
on a count day and counted that evening; the next count resets things anyway, so the add was
dropped. A version that valued monthly usage between counts (start + bought − end) needed a same-day tie rule
and was dropped on 2026-11-17 for receipts only (`computeMonthSpend`). Frank's reasoning: the
CEO looks at dollars and what's running out, not quantities used, and waste is too small to
measure.

## Why it wasn't obvious
- Code changes reach production only through merge and deploy. Sheet changes reach it instantly.
  A branch's "schema migration" is really a production change.
- The blank-header variant looks safe because reads still work. The breakage only shows on the next
  write, which happens by voice, and nobody sees the result.

## Pointers
- `src/lib/sheets.ts` (`CATALOG_HEADERS`, `listDateColumns`, `getOrCreateDateColumn`, the money-tab constants)
- `src/lib/inventory.ts` (`computeBuyList`, `computeMonthSpend`, `planPurchase`)
- `docs/solutions/verifying-refactors-against-live-sheet.md` covers the snapshot/diff method.
