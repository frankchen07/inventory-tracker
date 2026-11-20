# Testing page markup and redirects with node --test

**Date**: 2026-11-19

## The problem
Reviewers flagged page-level acceptance criteria as untested: a sheet link being the last element, a whole-row month link, an empty-state message, an invalid month redirecting. The pages are async server components that read Google Sheets directly, so there was no obvious way to unit-test what they render.

## The solution / decision
- **Split each page.** `page.tsx` keeps only the data loading and computes a view with pure functions in `src/lib/`. A plain presentational component in a sibling file (`buy-list-body.tsx`, `month/months-body.tsx`, `month/month-detail-body.tsx`) draws it.
  - Page files can't export extra components; Next rejects invalid page exports at build time.
- **Render tests.** Test the body with `renderToStaticMarkup(createElement(Body, props))` from `react-dom/server`, inside a `.test.ts` file. The test glob is `src/**/*.test.ts`, so no JSX; use `createElement`. `next/link` renders a plain `<a href>` outside Next with no router context needed. See `src/app/pages.test.ts`.
- **Redirect tests.** `redirect()` throws. Call the page itself with `{ params: Promise.resolve({ month: "abc" }) }` and assert that it rejects with an error whose `digest` matches `/^NEXT_REDIRECT;[^;]*;\/month;/`. The redirect fires before any sheet read, so no mocking is needed. See `src/app/month/month-detail-page.test.ts`.
- **Layout.** Fixed bars, no horizontal scroll and 44px tap targets need a real browser. Use Playwright, which is installed globally on frank's machine, against `next dev` with a session cookie minted from `createSessionToken(sessionSecret())` in `src/lib/auth.ts`.

## Why it wasn't obvious
It looked like page tests would need a Next test harness or mocks of `googleapis`. Neither was needed.

Also, several reviewers hitting pages in parallel trips the Sheets API read quota (60 reads/min/user). That shows up as a transient 500 that looks like a bug but isn't.

## Pointers
- `src/app/pages.test.ts`, `src/app/month/month-detail-page.test.ts`
- `docs/specs/mobile-first-buy-list-and-months.md` (build log)
- `npm test` runs `node --import tsx --test 'src/**/*.test.ts'`
