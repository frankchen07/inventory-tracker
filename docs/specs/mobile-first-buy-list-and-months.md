# Spec: Mobile-first buy list and months

Status: built, clean after 3 rounds; revised 2026-11-22 (see Revisions)
Date: 2026-11-18

## Goal
frank and staff check what to buy, and what supplies cost, on their phones. Today both pages are desktop-shaped, and `/month` gets around with a row of month buttons that nobody finds intuitive.

Rebuild `/` and `/month` mobile-first. Months become a list with totals that you tap into.

## Context
- **`src/app/page.tsx` (`/`):** today's buy list. Running-low items and hand-added items, grouped by supplier, from `loadBuyList()` in `src/lib/inventory.ts`.
- **`src/app/month/page.tsx` (`/month?month=YYYY-MM`):** one month's receipts from `computeMonthSpend()`, with prev/"This month"/"Buy list" buttons.
- **Data:** Google Sheets tabs `inventory`, `purchases` and `a la buy list`. Nothing about the sheet changes.
- **Approved mockup (phone):** https://claude.ai/artifact/MwZR2oVfjYmWVno5HJVuqJ. It has three artboards: Buy list, Months, November.
  - The mockup title-cases store names ("Espresso Parts"). The build uses the AC rule instead: first letter uppercased.
  - The mockup omits the non-stale "last count" line (AC-4) and the needs-review section (AC-12). The ACs win.
- **Dummy data:** the live sheet holds rows tagged DUMMY: purchases Sep–Nov 2026 and 3 hand-added buy-list rows. Use them to check the layout. Cleanup is separate.

## Definitions
- **Low item:** an entry in `BuyList.low`.
- **Bought item:** a low item whose `boughtSince` is non-empty.
- **To-buy item:** a low item with empty `boughtSince`, or any `BuyList.handAdded` entry.
- **Latest count date:** `latestDate` from `loadBuyList()`.
- **Stale:** the latest count date is `STALE_AFTER_DAYS` (7) or more days before today, by `daysBetween`.
- **Short date:** `shortDate()` in `src/lib/dates.ts`, e.g. "Nov 4".
- **Month label:** e.g. "November 2026". **Short month:** e.g. "Oct".
- **Dollars:** `$` plus `Math.round(n)` with en-US thousands separators, e.g. "$1,240".
- **Display name:** the sheet text with its first letter uppercased and the rest unchanged.
- **Current month:** the `YYYY-MM` of `todayISO()`.
- **Run:** a distinct (date, case-insensitive store) pair, as in `computeMonthSpend`.
- **Mobile:** viewport width under 1024px. **Desktop:** 1024px and wider.

## Behavior
1. `/` opens on the buy list:
   - a header saying how much there is to buy;
   - a stale-count banner when counts are old;
   - store groups: to-buy items first, bought items sunk to the bottom;
   - a needs-review section;
   - a small Google Sheet link.
2. The **Months** tab opens `/month`: every month from the first logged purchase up to now, newest first, each with total, runs and change from the month before.
3. Tapping a month opens `/month/YYYY-MM`: total, by store, what was bought, and a back link to Months.
4. On a phone, a bottom tab bar (Buy list · Months · Production) is always reachable. On a laptop it becomes a top bar, and content spreads into columns.

## Acceptance criteria

### Buy list `/`
- **AC-1:** Given 9 to-buy low items, 3 hand-added items and 2 bought items, when `/` loads, then the line under the "Buy list" heading reads `12 items to buy · 2 items already bought`. A count of 1 says `item`, any other count says `items`.
- **AC-2:** Given 0 bought items, when `/` loads, then that line reads `<N> items to buy` (or `1 item to buy`) with no "already bought" part.
  - Given no low and no hand-added items, it reads `0 items to buy`, and the page shows `Nothing to buy right now.` with no store groups.
- **AC-3:** Given the latest count date is stale, when `/` loads, then a banner shows `Last count <short date>, <N> days ago` and `Time to count.`
- **AC-4:** Given the latest count date is not stale, when `/` loads, then there is no banner. A muted line shows `Last count <short date> (<today | 1 day ago | N days ago | dated in the future>)`.
- **AC-5:** Given no counts recorded at all, when `/` loads, then the banner shows `No counts recorded yet.`
- **AC-6:** Given items from several suppliers, when `/` loads, then items are grouped by supplier, matched case-insensitively.
  - Each group heading shows the supplier's display name.
  - On the right, in bold, it shows `<N> items to buy` (`1 item to buy`), or `all bought` when every item in the group is bought.
  - Items with a blank supplier go in a group headed `No supplier yet`.
- **AC-7:** Given a mix of groups, when `/` loads, then groups appear in this order:
  1. Groups with at least one to-buy item: named suppliers alphabetically, case-insensitive, then `No supplier yet`.
  2. Groups where everything is bought, alphabetically.
- **AC-8:** Given a group, when `/` loads, then its rows appear in this order:
  1. To-buy low items, in sheet order.
  2. Hand-added items, in the order added.
  3. Bought items, in sheet order.
- **AC-9:** Given a to-buy low item counted on the latest count date, when `/` loads, then its row shows the display name on the left, the count text on the right (e.g. `7 sleeves`) and no second line.
  - If its count date differs from the latest count date, a second line reads `Counted <short date>`.
  - No threshold is shown.
- **AC-10:** Given a bought item, when `/` loads, then its row shows a check icon (aria-hidden), the name in muted text and the count text on the right.
  - A second line reads `Bought <short date> · <quantity>`.
  - Several purchases are joined with `, `, in date order.
- **AC-11:** Given a hand-added item, when `/` loads, then its row shows `a la carte` on the right.
  - A second line reads `Added <short date>`, followed by ` · not in inventory` when it isn't in the catalog. A blank date drops the `Added` part (leaving `Not in inventory` or no line); a date that isn't a real YYYY-MM-DD day is shown as typed.
- **AC-12:** Given `needsReview` has entries, when `/` loads, then a section headed `Needs review (<N>)` with the text `Fix these in the sheet.` lists each item with its problem text. It sits after all store groups.
- **AC-13:** Given any state, when `/` loads, then the last content element is an `Open Google Sheet` link.
  - It points at the spreadsheet's `/edit` URL with `target="_blank"` and `rel="noopener noreferrer"`.

### Months list `/month`
- **AC-14:** Given purchases dated in Sep, Oct and Nov 2026 and today is 2026-11-18, when `/month` loads, then it lists `November 2026`, `October 2026` and `September 2026`, in that order.
  - The `/month` page has no prev/next or month buttons.
- **AC-15:** Given the months listed, then they run from the earliest purchase month to the later of the current month and the latest purchase month.
  - Months in between with no purchases are listed.
  - Months before the earliest purchase are not.
- **AC-16:** Given the current month, then its label is followed by ` · so far`.
  - It is listed even with zero purchases. It then shows `$0` and the runs line `Nothing logged yet`.
- **AC-17:** Given a listed month with purchases, then its row shows the total in dollars (priced lines only).
  - The runs line reads `<N> run`/`<N> runs`, plus ` · <U> with no price` when U > 0.
  - A past month with zero purchases shows `$0` and `No runs`.
- **AC-18:** Given a listed month with purchases and an earlier listed month, then a line compares their rounded totals: `$<diff> less than <short month>`, `$<diff> more than <short month>` or `Same as <short month>`.
  - The earliest listed month shows `First month logged`.
  - A month with zero purchases shows no comparison.
- **AC-19:** Given any listed month has unpriced purchases, then a note `Totals leave out purchases with no price.` appears below the list. Otherwise it doesn't.
- **AC-20:** Given a listed month, then the whole row is one link to `/month/YYYY-MM`.

### Month detail `/month/YYYY-MM`
- **AC-21:** Given `/month/2026-11`, when it loads, then a `Months` back link to `/month` sits above the heading `November 2026`.
- **AC-22:** Given a month with purchases, then the total shows in dollars, followed by `on <N> run(s)`. For the current month, `, so far` is added.
- **AC-23:** Given U unpriced purchases in the month, then the page shows `1 purchase has no price, so it isn't in that total.` or `<U> purchases have no price, so they aren't in that total.` When U = 0, no note shows.
- **AC-24:** Given a month with purchases, then a `By store` section lists each store, sorted by spend, highest first.
  - Each row shows the display name, a line `<N> run(s)` with ` · <U> with no price` when U > 0, and the amount.
  - A store with only unpriced lines shows `no price`.
- **AC-25:** Given a month with purchases, then a `What was bought` section lists each item, matched to the catalog spelling, sorted by spend, highest first. Items with only unpriced lines go last.
  - Each row shows the display name and its quantities in date order, joined with ` + ` (e.g. `6 boxes + 8 boxes`).
  - The amount shows in dollars, as `<dollars> + <U> with no price` when the item mixes priced and unpriced lines, or as `no price` when all its lines are unpriced.
- **AC-26:** Given a valid month with no purchases, then the page shows the total `$0` and `Nothing logged this month.`, with no By store or What was bought sections.
- **AC-27:** Given `/month/2026-13`, `/month/abc` or `/month/2026-1`, when requested, then it redirects to `/month`.

### Navigation and layout
- **AC-28:** Given a mobile viewport on `/`, `/month`, `/month/<m>` or `/production`, then a tab bar is fixed to the bottom of the viewport.
  - Its links are `Buy list` (`/`), `Months` (`/month`) and `Production` (`/production`).
  - The current section's link has `aria-current="page"`. Months counts as current on month detail; Production is current on `/production`.
  - Scrolled to the bottom, the last content element is fully visible above the bar.
- **AC-29:** Given a desktop viewport on those pages, then the same three links appear in a bar at the top, and no bottom bar shows.
- **AC-30:** Given a 360px-wide viewport and the seeded data, then none of the three pages scrolls horizontally: `document.documentElement.scrollWidth` ≤ 360.
- **AC-31:** Given a mobile viewport, then every link on the three pages has a hit area at least 44×44 CSS px. This covers the tab bar links, month rows, the back link and the sheet link.
- **AC-32:** Given a desktop viewport, then:
  - The buy list's store groups lay out in 2 columns.
  - On month detail, `By store` and `What was bought` sit side by side.
  - The months list stays a single column no wider than 720px.
- **AC-33:** Given the build is done, then `src/app/login/` has no changes, and `src/app/production/` changes only to add the tab bar, pad its content clear of it, and drop its old "Inventory dashboard" button.

## Out of scope
- Restyling `/production` (beyond adding the tab bar) or `/login`.
- MCP tools, the sheet schema and any sheet writes.
- Showing thresholds on the buy list.
- Checking items off or editing anything from the app.
- Prev/next navigation inside a month detail.
- Charts or graphs.
- Dark mode.
- Keeping old `/month?month=YYYY-MM` links working.
- Cleaning up the DUMMY rows.

## Constraints
- **Test command:** `npm test`. `npm run lint` and `npm run build` must also pass.
- **Next.js 16.3 App Router** (dynamic route params are a Promise). Read the relevant guide in `node_modules/next/dist/docs/` before writing Next code (AGENTS.md).
- **Styling:** Tailwind 4, matching the existing pages. No new dependencies.
- **Data:** all data comes from the existing reads (`loadBuyList`, `getCatalog`, `getPurchases`). The live sheet is shared with production, so the build makes no sheet writes.
- **TDD:** red/green for the pure logic: buy-list grouping and ordering, header counts, the month range, comparisons, and per-store and per-item rows. These are functions in `src/lib/`, tested with `node --test`.
- **Visual check:** the test-ui agent on the dev server at 390×844 and 1280×800, with the seeded data.
- **Sign-off:** frank checks on his phone against production after merge.

## Open questions
None.

## Revisions
- 2026-11-22 (frank, after using the preview):
  - The tab bar now shows on `/production` too, so it's easy to get back (AC-28, AC-33). Its old "Inventory dashboard" button is gone, since the bar replaces it.
  - Counts say `items`: `12 items to buy · 2 items already bought`, `9 items to buy`, `1 item to buy` (AC-1, AC-2, AC-6).
  - The per-store count is bold (AC-6).
  - Hand-added rows say `a la carte` instead of `by hand` (AC-11).
- 2026-11-24 (frank: "fix anything else"):
  - A count dated after today reads `Last count <short date> (dated in the future)` (AC-4).
  - A hand-added row with a blank date drops the `Added` part; a date that isn't YYYY-MM-DD is shown as typed (AC-11).

## Build log
<!-- looper-build-review appends rounds here -->

### Round 1 (2026-11-19)
- Verdict: NOT CLEAN
- Critical/High: 7.
  - AC-7: an all-bought "No supplier yet" group sorted ahead of other all-bought groups instead of alphabetically.
  - AC-24: a store with only $0-priced lines showed "no price".
  - AC-25: same bug for items.
  - AC-12, AC-13, AC-20, AC-21: no automated test.
- Fixed:
  - AC-7 now sorts all-bought groups by heading.
  - A line counts as unpriced only when it has no cost, so $0 shows as "$0". Stores now track a line count.
  - Needs-review rows moved into the view model.
  - Page markup moved into components that take the computed data (`buy-list-body`, `months-body`, `month-detail-body`). Render tests in `src/app/pages.test.ts` cover AC-12, AC-13, AC-20 and AC-21.
- Disputed: none. The reviewers disagreed on AC-7 severity (High vs Medium "ambiguous"). The literal "alphabetically" reading was applied, which satisfies both.
- Browser check (test-ui and Playwright at 360, 390 and 1280): AC-28 to AC-32 pass.
- Medium/Low (not looped on):
  - A blank hand-added date renders "Added Invalid Date".
  - A count dated after today renders "-N days ago".
  - Mixed-case supplier spellings keep the first-seen heading.
  - Unrequested extras: a subtitle on Months, nav and row icons.
  - Needs-review list keys can collide on duplicate item names.
  - If every purchase is dated after today, the list starts at the current month (AC-15 vs AC-16).

### Round 2 (2026-11-19)
- Verdict: NOT CLEAN
- Critical/High: 8.
  - AC-25: an unpriced-only item could sort above a $0-priced item, because sorting used spend alone.
  - AC-2, AC-10, AC-14, AC-16, AC-19, AC-26, AC-27: rendered text and the redirect had no test. Only the underlying view values were asserted.
- Fixed:
  - Items now tie-break with unpriced-only items last, with a red/green test.
  - Render tests added in `src/app/pages.test.ts` for the empty buy list, the bought row, no month buttons, "· so far", the footnote and the empty month.
  - Redirect test in `src/app/month/month-detail-page.test.ts`: the page rejects with `NEXT_REDIRECT` to `/month` for `2026-13`, `abc` and `2026-1`.
- Disputed: none.
- Browser check (both reviewers, Playwright at 360, 390 and 1280): AC-28 to AC-32 pass. AC-33 holds.
- Medium/Low (not looped on):
  - AC-15 vs AC-16 when every purchase is after today (spec gap).
  - AC-8 relies on sheet row order being the order added.
  - Duplicate-name React keys.
  - "Added Invalid Date".
  - "-N days ago".
  - Unrequested subtitle and icons.
  - First-seen supplier casing.

### Round 3 (2026-11-19)
- Verdict: CLEAN, from both reviewers.
- Critical/High: 0.
- Fixed: nothing needed.
- Disputed: none.
- Checks: 95/95 tests pass (run by the builder), lint is clean, and the build passes. Browser checks at 360, 390 and 1280 pass AC-28 to AC-32. AC-33 holds.
- Medium/Low (not looped on):
  - Spec gaps:
    - AC-15 vs AC-16 when every purchase is after today.
    - Behavior 4 says the tab bar is "always reachable", but `/production` has no tab bar, and AC-33 forbids touching it.
  - "Added Invalid Date" for a blank date.
  - "-N days ago" for a future count.
  - The sheet link has no guard when the env var is missing.
  - Name-based React keys.
  - Unrequested subtitle and icons.
  - A one-off 500 during review: the dev log shows the Sheets API read quota (60/min/user) was exceeded while reviewers loaded pages repeatedly. Same behavior on main, not caused by this change.

Critical/High per round: 7 → 8 → 0
