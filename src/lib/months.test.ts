import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMonthDetail, buildMonthList, isMonth } from "@/lib/months";
import type { CatalogItem, PurchaseRow } from "@/lib/types";

const item = (name: string, rowIndex: number): CatalogItem => ({
  item: name,
  location: "",
  category: "",
  supplier: "",
  unitConversion: "",
  threshold: "",
  rowIndex,
});
const catalog = [item("oat milk", 2), item("organic milk", 3), item("nitrile gloves medium", 4)];
const p = (date: string, store: string, name: string, quantity: string, cost: number | null): PurchaseRow => ({
  date,
  store,
  item: name,
  quantity,
  cost,
});
const purchases = [
  p("2026-09-05", "costco", "oat milk", "6 boxes", 581.13),
  p("2026-09-19", "espresso parts", "backflush cleaner", "1 bottle", null),
  p("2026-10-03", "costco", "oat milk", "8 boxes", 881.72),
  p("2026-11-04", "costco", "organic milk", "9 boxes", 600),
  p("2026-11-12", "costco", "nitrile gloves medium", "2 boxes", null),
  p("2026-11-14", "espresso parts", "Oat Milk", "1 box", 80.79),
];

test("AC-14: months list newest first from Sep to the current month", () => {
  const { rows } = buildMonthList(catalog, purchases, "2026-11-18");
  assert.deepEqual(
    rows.map((r) => r.label),
    ["November 2026", "October 2026", "September 2026"],
  );
  assert.deepEqual(
    rows.map((r) => r.href),
    ["/month/2026-11", "/month/2026-10", "/month/2026-09"],
  );
});

test("AC-15: the range fills gaps and runs to the later of today's month and the latest purchase", () => {
  const gap = [p("2026-07-02", "costco", "oat milk", "1 box", 10), p("2026-09-02", "costco", "oat milk", "1 box", 10)];
  assert.deepEqual(
    buildMonthList(catalog, gap, "2026-11-18").rows.map((r) => r.month),
    ["2026-11", "2026-10", "2026-09", "2026-08", "2026-07"],
  );
  const future = [p("2027-01-05", "costco", "oat milk", "1 box", 10)];
  assert.deepEqual(
    buildMonthList(catalog, future, "2026-11-18").rows.map((r) => r.month),
    ["2027-01", "2026-12", "2026-11"],
  );
});

test("AC-16: the current month is marked so far and listed even with nothing logged", () => {
  const { rows } = buildMonthList(catalog, [], "2026-11-18");
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { label: rows[0].label, soFar: rows[0].soFar, total: rows[0].total, runsLine: rows[0].runsLine },
    { label: "November 2026", soFar: true, total: "$0", runsLine: "Nothing logged yet" },
  );
  const withData = buildMonthList(catalog, purchases, "2026-11-18").rows;
  assert.deepEqual(
    withData.map((r) => r.soFar),
    [true, false, false],
  );
});

test("AC-17: each month shows its priced total and runs, with unpriced lines and empty past months called out", () => {
  const rows = buildMonthList(catalog, purchases, "2026-11-18").rows;
  assert.deepEqual(
    rows.map((r) => [r.total, r.runsLine]),
    [
      ["$681", "3 runs · 1 with no price"],
      ["$882", "1 run"],
      ["$581", "2 runs · 1 with no price"],
    ],
  );
  const gap = [p("2026-08-02", "costco", "oat milk", "1 box", 1240), p("2026-10-02", "costco", "oat milk", "1 box", 10)];
  const sep = buildMonthList(catalog, gap, "2026-11-18").rows.find((r) => r.month === "2026-09");
  assert.deepEqual([sep?.total, sep?.runsLine], ["$0", "No runs"]);
  assert.equal(buildMonthList(catalog, gap, "2026-11-18").rows.find((r) => r.month === "2026-08")?.total, "$1,240");
});

test("AC-18: each month with purchases compares its rounded total with the month before", () => {
  const rows = buildMonthList(catalog, purchases, "2026-11-18").rows;
  assert.deepEqual(
    rows.map((r) => r.comparison),
    ["$201 less than Oct", "$301 more than Sep", "First month logged"],
  );
  const same = [p("2026-10-02", "costco", "oat milk", "1 box", 99.6), p("2026-11-02", "costco", "oat milk", "1 box", 100.4)];
  assert.equal(buildMonthList(catalog, same, "2026-11-18").rows[0].comparison, "Same as Oct");
  const quiet = buildMonthList(catalog, [p("2026-09-02", "costco", "oat milk", "1 box", 10)], "2026-11-18").rows;
  assert.deepEqual(
    quiet.map((r) => r.comparison),
    [null, null, "First month logged"],
  );
});

test("AC-19: the unpriced footnote flag is set only when some listed month has unpriced lines", () => {
  assert.equal(buildMonthList(catalog, purchases, "2026-11-18").anyUnpriced, true);
  assert.equal(buildMonthList(catalog, [p("2026-11-02", "costco", "oat milk", "1 box", 10)], "2026-11-18").anyUnpriced, false);
});

test("AC-22: month detail shows the total and runs, with so far for the current month", () => {
  const nov = buildMonthDetail(catalog, purchases, "2026-11", "2026-11-18");
  assert.deepEqual([nov.label, nov.total, nov.runsText], ["November 2026", "$681", "on 3 runs, so far"]);
  const oct = buildMonthDetail(catalog, purchases, "2026-10", "2026-11-18");
  assert.deepEqual([oct.total, oct.runsText], ["$882", "on 1 run"]);
});

test("AC-23: the unpriced note is singular, plural, or absent", () => {
  assert.equal(buildMonthDetail(catalog, purchases, "2026-11", "2026-11-18").unpricedNote, "1 purchase has no price, so it isn't in that total.");
  const two = [p("2026-11-02", "costco", "oat milk", "1 box", null), p("2026-11-03", "costco", "oat milk", "1 box", null)];
  assert.equal(buildMonthDetail(catalog, two, "2026-11", "2026-11-18").unpricedNote, "2 purchases have no price, so they aren't in that total.");
  assert.equal(buildMonthDetail(catalog, purchases, "2026-10", "2026-11-18").unpricedNote, null);
});

test("AC-24: by store, highest spend first, with runs, unpriced counts and no-price stores", () => {
  const nov = buildMonthDetail(catalog, purchases, "2026-11", "2026-11-18");
  assert.deepEqual(nov.stores, [
    { name: "Costco", sub: "2 runs · 1 with no price", amount: "$600" },
    { name: "Espresso parts", sub: "1 run", amount: "$81" },
  ]);
  const sep = buildMonthDetail(catalog, purchases, "2026-09", "2026-11-18");
  assert.deepEqual(sep.stores[1], { name: "Espresso parts", sub: "1 run · 1 with no price", amount: "no price" });
});

test("AC-25: what was bought, catalog spelling, quantities in date order, unpriced-only last", () => {
  const lines = [
    p("2026-11-20", "costco", "oat milk", "8 boxes", 100),
    p("2026-11-04", "costco", "Oat Milk", "6 boxes", null),
    p("2026-11-05", "costco", "nitrile gloves medium", "2 boxes", null),
    p("2026-11-06", "costco", "organic milk", "9 boxes", 50),
    p("2026-11-07", "costco", "blender pitcher", "1 pitcher", 129),
  ];
  assert.deepEqual(buildMonthDetail(catalog, lines, "2026-11", "2026-11-18").items, [
    { name: "Blender pitcher", sub: "1 pitcher", amount: "$129" },
    { name: "Oat milk", sub: "6 boxes + 8 boxes", amount: "$100 + 1 with no price" },
    { name: "Organic milk", sub: "9 boxes", amount: "$50" },
    { name: "Nitrile gloves medium", sub: "2 boxes", amount: "no price" },
  ]);
});

test("AC-26: a valid month with no purchases is empty with a $0 total", () => {
  const aug = buildMonthDetail(catalog, purchases, "2026-08", "2026-11-18");
  assert.deepEqual(
    { total: aug.total, empty: aug.empty, stores: aug.stores, items: aug.items, unpricedNote: aug.unpricedNote },
    { total: "$0", empty: true, stores: [], items: [], unpricedNote: null },
  );
});

test("AC-27: isMonth accepts only YYYY-MM with a real month", () => {
  assert.equal(isMonth("2026-11"), true);
  assert.equal(isMonth("2026-13"), false);
  assert.equal(isMonth("abc"), false);
  assert.equal(isMonth("2026-1"), false);
  assert.equal(isMonth("2026-00"), false);
});

test("AC-24/AC-25: a line priced at $0 is priced, not 'no price'", () => {
  const lines = [p("2026-11-02", "free store", "samples", "1 box", 0), p("2026-11-03", "costco", "oat milk", "1 box", 10)];
  const nov = buildMonthDetail(catalog, lines, "2026-11", "2026-11-18");
  assert.deepEqual(nov.stores.at(-1), { name: "Free store", sub: "1 run", amount: "$0" });
  assert.deepEqual(nov.items.at(-1), { name: "Samples", sub: "1 box", amount: "$0" });
  assert.equal(nov.unpricedNote, null);
});

test("AC-25: an item with only unpriced lines sorts after a $0-priced item", () => {
  const lines = [p("2026-11-02", "costco", "nitrile gloves medium", "2 boxes", null), p("2026-11-03", "costco", "samples", "1 box", 0)];
  assert.deepEqual(
    buildMonthDetail(catalog, lines, "2026-11", "2026-11-18").items.map((i) => [i.name, i.amount]),
    [
      ["Samples", "$0"],
      ["Nitrile gloves medium", "no price"],
    ],
  );
});
