import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBuyList, computeMonthSpend, computeStaleCounts, findCatalogItem, planPurchase, toPacks } from "@/lib/inventory";
import type { CatalogItem } from "@/lib/types";

const item = (name: string, rowIndex: number): CatalogItem => ({
  item: name,
  category: "",
  supplier: "",
  unitConversion: "",
  threshold: "",
  rowIndex,
});

test("findCatalogItem matches case- and whitespace-insensitively", () => {
  const catalog = [item("oat milk", 32), item("12 oz paper cup", 2)];
  assert.equal(findCatalogItem(catalog, "  Oat Milk ")?.rowIndex, 32);
  assert.equal(findCatalogItem(catalog, "oatmilk"), undefined);
});

test("computeStaleCounts lists items last counted 7+ days ago, oldest first, skipping never-counted", () => {
  const catalog = [item("oat milk", 2), item("lids", 3), item("napkins", 4), item("straws", 5), item("new thing", 6)];
  const countDates = new Map<string, string | null>([
    ["oat milk", "2026-11-12"],
    ["lids", "2026-11-06"],
    ["napkins", "2026-10-20"],
    ["straws", "2026-11-07"],
    ["new thing", null],
  ]);
  const stale = computeStaleCounts(catalog, countDates, "2026-11-13");
  assert.deepEqual(
    stale.map((s) => [s.item, s.lastCounted, s.daysAgo]),
    [
      ["napkins", "2026-10-20", 24],
      ["lids", "2026-11-06", 7],
    ],
  );
});

const CUPS = "1 box has 12 sleeves with 50 cups per sleeve";
const MILK = "1 box has 3 cartons";

test("toPacks converts any count to top-level packs", () => {
  assert.equal(toPacks("6 sleeves", CUPS), 0.5);
  assert.equal(toPacks("1 box and 6 sleeves", CUPS), 1.5);
  assert.equal(toPacks("2 cartons", MILK), 2 / 3);
  assert.equal(toPacks("6", CUPS), null);
  assert.equal(toPacks("1 box", ""), null);
});

test("computeBuyList fills A items back up to par in whole packs, counting purchases made since the count", () => {
  const catalog = [
    { ...item("12 oz paper cup", 2), supplier: "costco", unitConversion: CUPS, threshold: "2 boxes" },
    { ...item("organic milk", 3), supplier: "costco", unitConversion: MILK, threshold: "8 boxes" },
    { ...item("oat milk", 4), supplier: "costco", unitConversion: MILK, threshold: "4 boxes" },
    { ...item("12 oz pet cup", 5), supplier: "costco", unitConversion: CUPS, threshold: "1 box" },
    { ...item("matcha", 6), supplier: "costco", unitConversion: "1 bag", threshold: "1 bag" },
    { ...item("ice", 7), supplier: "costco", unitConversion: "1 bag", threshold: "" },
    { ...item("napkins", 8), supplier: "costco", unitConversion: "1 pack", threshold: "1 pack" },
  ];
  const counts = new Map([
    ["12 oz paper cup", "10 sleeves"],
    ["organic milk", "5 boxes and 1 carton"],
    ["oat milk", "12 boxes"],
    ["12 oz pet cup", "6 sleeves"],
    ["matcha", ""],
    ["ice", "3 bags"],
    ["napkins", "0 packs"],
  ]);
  const countDates = new Map<string, string | null>([
    ["12 oz paper cup", "2026-11-10"],
    ["organic milk", "2026-11-10"],
    ["oat milk", "2026-11-10"],
    ["12 oz pet cup", "2026-11-10"],
    ["matcha", null],
    ["ice", "2026-11-10"],
    ["napkins", "2026-11-10"],
  ]);
  const aItems = new Map([["12 oz paper cup", 50], ["organic milk", 12], ["oat milk", 20], ["12 oz pet cup", 50], ["matcha", null], ["ice", 3]]);
  const buyRows = [
    { item: "napkins", added: "2026-11-14", done: false, rowIndex: 2 },
    { item: "Napkins", added: "2026-11-15", done: false, rowIndex: 3 },
    { item: "organic milk", added: "2026-11-15", done: false, rowIndex: 4 },
    { item: "dish soap", added: "2026-11-10", done: true, rowIndex: 5 },
  ];
  const purchases = [
    // Same day as the count still counts: logging a purchase takes it off the list.
    { date: "2026-11-10", store: "costco", item: "12 oz paper cup", quantity: "1 box", cost: null },
    { date: "2026-11-12", store: "costco", item: "organic milk", quantity: "2 boxes", cost: null },
    { date: "2026-11-11", store: "costco", item: "12 oz pet cup", quantity: "1 box", cost: null },
  ];
  const list = computeBuyList(catalog, counts, countDates, aItems, buyRows, purchases);
  assert.deepEqual(
    list.toBuy.map((b) => [b.item, b.onHand, b.boughtSince, b.buy, b.unit]),
    [
      ["12 oz paper cup", "10 sleeves", 1, 1, "box"],
      ["organic milk", "5 boxes and 1 carton", 2, 1, "box"],
    ],
  );
  assert.deepEqual(list.handAdded, [{ item: "napkins", supplier: "costco" }]);
  assert.deepEqual(list.notCounted, ["matcha"]);
  assert.deepEqual(list.needsReview, [{ item: "ice", problem: "no par set (threshold column)" }]);
});

test("planPurchase skips exact repeats but still closes their buy-list rows, so a retry finishes the job", () => {
  const catalog = [item("napkins", 2), item("oat milk", 3)];
  const existing = [{ date: "2026-11-16", store: "Costco", item: "napkins", quantity: "1 pack", cost: null }];
  const buyRows = [
    { item: "Napkins", added: "2026-11-14", done: false, rowIndex: 2 },
    { item: "oat milk", added: "2026-11-14", done: true, rowIndex: 3 },
  ];
  const lines = [
    { item: "napkins", quantity: "1 pack" },
    { item: "oat milk", quantity: "6 boxes", cost: 90 },
  ];
  const plan = planPurchase(catalog, existing, buyRows, lines, "2026-11-16", "costco", false);
  assert.deepEqual(plan.rows, [
    { date: "2026-11-16", store: "costco", item: "oat milk", quantity: "6 boxes", cost: "90", notes: "" },
  ]);
  assert.deepEqual(plan.skippedAsRepeat, ["napkins"]);
  assert.deepEqual(plan.close.map((r) => r.rowIndex), [2]);

  const again = planPurchase(catalog, existing, buyRows, lines, "2026-11-16", "costco", true);
  assert.deepEqual(again.rows.map((r) => r.item), ["napkins", "oat milk"]);
  assert.deepEqual(again.skippedAsRepeat, []);
});

test("computeBuyList never lists a zero-pack buy from float dust", () => {
  const catalog = [{ ...item("oat milk", 2), unitConversion: "1 box has 3 cartons", threshold: "0.8 boxes" }];
  const list = computeBuyList(
    catalog,
    new Map([["oat milk", "0.5 boxes and 0.9 cartons"]]),
    new Map([["oat milk", "2026-11-10"]]),
    new Map([["oat milk", 20]]),
    [],
    [],
  );
  assert.deepEqual(list.toBuy, []);
});

test("computeMonthSpend totals the calendar month's receipts, falling back to unit cost", () => {
  const catalog = [
    { ...item("oat milk", 2), unitConversion: MILK },
    { ...item("napkins", 3), unitConversion: "1 pack" },
    { ...item("matcha", 4), unitConversion: "1 bag" },
    { ...item("dish soap", 5), unitConversion: "1 bottle" },
  ];
  const aItems = new Map([["oat milk", 20], ["matcha", null]]);
  const purchases = [
    { date: "2026-11-05", store: "costco", item: "oat milk", quantity: "6 boxes", cost: null },
    { date: "2026-11-05", store: "Costco", item: "napkins", quantity: "1 pack", cost: 18 },
    { date: "2026-11-12", store: "costco", item: "matcha", quantity: "1 bag", cost: 30 },
    { date: "2026-11-27", store: "costco", item: "oat milk", quantity: "2 boxes", cost: null },
    { date: "2026-11-28", store: "amazon", item: "dish soap", quantity: "1 bottle", cost: null },
    { date: "2026-10-30", store: "costco", item: "oat milk", quantity: "1 box", cost: null },
    { date: "2026-12-01", store: "costco", item: "oat milk", quantity: "1 box", cost: null },
  ];
  const history = new Map([
    ["oat milk", [
      { date: "2026-10-28", value: "4 boxes" },
      { date: "2026-11-24", value: "2 boxes" },
      { date: "2026-12-03", value: "5 boxes" },
    ]],
    ["matcha", [{ date: "2026-11-24", value: "2 bags" }]],
  ]);

  const m = computeMonthSpend(catalog, aItems, purchases, history, "2026-11");
  // 6 + 2 boxes of oat milk at $20, napkins $18 and matcha $30 off receipts; dish soap has no price.
  assert.equal(m.spend, 208);
  assert.equal(m.unpricedPurchases, 1);
  // costco 11-05 (either case), costco 11-12, costco 11-27, amazon 11-28.
  assert.equal(m.runs, 4);
  assert.deepEqual(m.byStore, [
    { store: "costco", spend: 208, unpriced: 0 },
    { store: "amazon", spend: 0, unpriced: 1 },
  ]);
  assert.deepEqual(m.byItem, [
    { item: "oat milk", spend: 160, unpriced: 0 },
    { item: "matcha", spend: 30, unpriced: 0 },
    { item: "napkins", spend: 18, unpriced: 0 },
    { item: "dish soap", spend: 0, unpriced: 1 },
  ]);
  // Shelf value at each A item's last count in or before November.
  assert.deepEqual(m.shelf, { date: "2026-11-24", value: 40, unpricedItems: ["matcha"] });
});

test("computeMonthSpend with no purchases or counts in the month", () => {
  const catalog = [{ ...item("oat milk", 2), unitConversion: MILK }];
  const history = new Map([["oat milk", [{ date: "2026-11-24", value: "2 boxes" }]]]);
  const m = computeMonthSpend(catalog, new Map([["oat milk", 20]]), [], history, "2026-09");
  assert.equal(m.spend, 0);
  assert.equal(m.runs, 0);
  assert.deepEqual(m.byStore, []);
  assert.deepEqual(m.shelf, { date: null, value: 0, unpricedItems: [] });
});
