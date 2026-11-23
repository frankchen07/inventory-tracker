import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BuyListBody } from "@/app/buy-list-body";
import { MonthDetailBody } from "@/app/month/month-detail-body";
import { MonthsBody } from "@/app/month/months-body";
import { Nav } from "@/app/nav";
import { buildBuyListView } from "@/lib/buy-list-view";
import type { MonthDetail, MonthRow } from "@/lib/months";
import type { BuyList } from "@/lib/types";

const SHEET = "https://docs.google.com/spreadsheets/d/abc/edit";
const list: BuyList = {
  low: [{ item: "8 oz paper cup", supplier: "costco", countText: "7 sleeves", countDate: "2026-11-10", boughtSince: [] }],
  handAdded: [],
  needsReview: [{ item: "oat milk", problem: `can't read the count "lots"` }],
};
const buyListHtml = (l: BuyList) =>
  renderToStaticMarkup(createElement(BuyListBody, { view: buildBuyListView(l, "2026-11-10", "2026-11-12"), sheetUrl: SHEET }));

test("AC-12: the needs-review section lists each problem after all store groups", () => {
  const html = buyListHtml(list);
  const review = html.indexOf("Needs review (1)");
  assert.ok(review > html.lastIndexOf("8 oz paper cup"), "needs review comes after the store groups");
  assert.ok(html.includes("Fix these in the sheet."));
  assert.ok(html.indexOf("Oat milk") > review);
  assert.ok(html.includes("can&#x27;t read the count &quot;lots&quot;"));
  assert.ok(!buyListHtml({ ...list, needsReview: [] }).includes("Needs review"));
});

test("AC-13: the last content element is the Open Google Sheet link, opening in a new tab", () => {
  for (const l of [list, { low: [], handAdded: [], needsReview: [] }]) {
    const html = buyListHtml(l);
    const link = html.match(/<a [^>]*>Open Google Sheet.*?<\/a>/);
    assert.ok(link, "sheet link present");
    assert.ok(link[0].includes(`href="${SHEET}"`));
    assert.ok(link[0].includes('target="_blank"'));
    assert.ok(link[0].includes('rel="noopener noreferrer"'));
    assert.ok(html.endsWith(`${link[0]}</main>`), "nothing follows the sheet link");
  }
});

test("AC-20: each month row is one link to its detail page holding the whole row", () => {
  const rows: MonthRow[] = [
    { month: "2026-11", label: "November 2026", soFar: true, total: "$681", runsLine: "5 runs", comparison: "$201 less than Oct", href: "/month/2026-11" },
    { month: "2026-10", label: "October 2026", soFar: false, total: "$882", runsLine: "5 runs", comparison: "First month logged", href: "/month/2026-10" },
  ];
  const html = renderToStaticMarkup(createElement(MonthsBody, { rows, anyUnpriced: false }));
  for (const r of rows) {
    const link = html.match(new RegExp(`<a [^>]*href="${r.href}"[^>]*>(.*?)</a>`));
    assert.ok(link, `link to ${r.href}`);
    for (const text of [r.label, r.runsLine, r.total, r.comparison!]) assert.ok(link[1].includes(text), `${text} inside the link`);
  }
});

test("AC-21: a Months back link to /month sits above the month heading", () => {
  const m: MonthDetail = { label: "November 2026", total: "$681", runsText: "on 5 runs, so far", unpricedNote: null, empty: true, stores: [], items: [] };
  const html = renderToStaticMarkup(createElement(MonthDetailBody, { m }));
  const back = html.search(/<a [^>]*href="\/month"[^>]*>.*?Months<\/a>/);
  assert.ok(back !== -1, "back link present");
  assert.ok(back < html.indexOf("<h1"), "back link is above the heading");
  assert.ok(html.includes(">November 2026</h1>"));
});

test("AC-2: an empty buy list says nothing to buy, with no store groups", () => {
  const html = buyListHtml({ low: [], handAdded: [], needsReview: [] });
  assert.ok(html.includes(">0 items to buy<"));
  assert.ok(html.includes("Nothing to buy right now."));
  assert.ok(!html.includes("<section"), "no store groups");
});

test("AC-10: a bought row shows a hidden check icon, a muted name and the bought line", () => {
  const html = buyListHtml({
    low: [{ item: "12 oz paper cup", supplier: "costco", countText: "10 sleeves", countDate: "2026-11-10", boughtSince: [{ date: "2026-11-12", quantity: "2 boxes" }] }],
    handAdded: [],
    needsReview: [],
  });
  const row = html.match(/<li[^>]*>.*?<\/li>/)![0];
  assert.match(row, /<svg[^>]*aria-hidden="true"/);
  assert.match(row, /class="[^"]*text-zinc-600[^"]*"><svg/, "name is muted");
  assert.ok(row.includes("12 oz paper cup"));
  assert.ok(row.includes("Bought Nov 12 · 2 boxes"));
  assert.ok(row.includes("10 sleeves"));
});

const monthRow = (month: string, label: string, soFar: boolean): MonthRow => ({
  month,
  label,
  soFar,
  total: "$0",
  runsLine: "Nothing logged yet",
  comparison: null,
  href: `/month/${month}`,
});

test("AC-14: the months list has no buttons, only one link per month", () => {
  const html = renderToStaticMarkup(
    createElement(MonthsBody, { rows: [monthRow("2026-11", "November 2026", true), monthRow("2026-10", "October 2026", false)], anyUnpriced: false }),
  );
  assert.ok(!html.includes("<button"));
  assert.equal(html.match(/<a /g)?.length, 2);
  assert.ok(html.indexOf("November 2026") < html.indexOf("October 2026"));
});

test("AC-16: the current month's label is followed by · so far, and only that month's", () => {
  const html = renderToStaticMarkup(
    createElement(MonthsBody, { rows: [monthRow("2026-11", "November 2026", true), monthRow("2026-10", "October 2026", false)], anyUnpriced: false }),
  );
  const text = html.replace(/<[^>]+>/g, "");
  assert.ok(text.includes("November 2026 · so far"));
  assert.ok(!text.includes("October 2026 · so far"));
  assert.ok(text.includes("Nothing logged yet"));
});

test("AC-19: the no-price footnote shows only when a month has unpriced lines", () => {
  const rows = [monthRow("2026-11", "November 2026", true)];
  const note = "Totals leave out purchases with no price.";
  assert.ok(renderToStaticMarkup(createElement(MonthsBody, { rows, anyUnpriced: true })).includes(note));
  assert.ok(!renderToStaticMarkup(createElement(MonthsBody, { rows, anyUnpriced: false })).includes(note));
});

test("AC-26: an empty month shows $0 and nothing logged, with no sections", () => {
  const m: MonthDetail = { label: "August 2026", total: "$0", runsText: null, unpricedNote: null, empty: true, stores: [], items: [] };
  const html = renderToStaticMarkup(createElement(MonthDetailBody, { m }));
  assert.ok(html.includes(">$0<"));
  assert.ok(html.includes("Nothing logged this month."));
  assert.ok(!html.includes("By store"));
  assert.ok(!html.includes("What was bought"));
});

test("AC-6: a store group's count of items to buy is bold, with a plural for more than one", () => {
  const two: BuyList = { ...list, low: [...list.low, { ...list.low[0], item: "12 oz hot lid" }] };
  assert.match(buyListHtml(list), /<span class="[^"]*font-bold[^"]*">1 item to buy<\/span>/);
  assert.match(buyListHtml(two), /<span class="[^"]*font-bold[^"]*">2 items to buy<\/span>/);
});

test("AC-28: the tab bar marks Production as the current page on /production", () => {
  const html = renderToStaticMarkup(createElement(Nav, { current: "production" }));
  const link = html.match(/<a [^>]*href="\/production"[^>]*>/);
  assert.ok(link?.[0].includes('aria-current="page"'));
  assert.equal(html.match(/aria-current/g)?.length, 1);
});
