import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBuyList, computeMonthSpend, findCatalogItem, planPurchase } from "@/lib/inventory";
import type { CatalogItem } from "@/lib/types";

const item = (name: string, rowIndex: number): CatalogItem => ({
  item: name,
  category: "",
  supplier: "",
  unitConversion: "",
  threshold: "",
  rowIndex,
});

const CUPS = "1 box has 12 sleeves with 50 cups per sleeve";
const MILK = "1 box has 3 cartons";

test("findCatalogItem matches case- and whitespace-insensitively", () => {
  const catalog = [item("oat milk", 32), item("12 oz paper cup", 2)];
  assert.equal(findCatalogItem(catalog, "  Oat Milk ")?.rowIndex, 32);
  assert.equal(findCatalogItem(catalog, "oatmilk"), undefined);
});

test("computeBuyList flags items under threshold, counting purchases made since the count", () => {
  const catalog = [
    { ...item("12 oz paper cup", 2), supplier: "costco", unitConversion: CUPS, threshold: "12 sleeves" },
    { ...item("organic milk", 3), supplier: "costco", unitConversion: MILK, threshold: "8 boxes" },
    { ...item("oat milk", 4), supplier: "costco", unitConversion: MILK, threshold: "4 boxes" },
    { ...item("12 oz pet cup", 5), supplier: "costco", unitConversion: CUPS, threshold: "1 box" },
    { ...item("ice", 6), supplier: "costco", unitConversion: "1 bag", threshold: "" },
    { ...item("matcha", 7), supplier: "costco", unitConversion: "1 bag", threshold: "1 bag" },
    { ...item("12 oz pet lid", 8), supplier: "costco", unitConversion: CUPS, threshold: "1 box" },
    { ...item("napkins", 9), supplier: "costco", unitConversion: "1 pack", threshold: "1 pack" },
    { ...item("dish soap", 10), supplier: "whole foods" },
  ];
  const counts = new Map([
    ["12 oz paper cup", "10 sleeves"],
    ["organic milk", "5 boxes and 1 carton"],
    ["oat milk", "12 boxes"],
    ["12 oz pet cup", "6 sleeves"],
    ["ice", "3 bags"],
    ["matcha", ""],
    ["12 oz pet lid", "3 sleeves of cups"],
    ["napkins", "0 packs"],
  ]);
  const countDates = new Map<string, string | null>([
    ["12 oz paper cup", "2026-11-10"],
    ["organic milk", "2026-11-10"],
    ["oat milk", "2026-11-10"],
    ["12 oz pet cup", "2026-11-10"],
    ["ice", "2026-11-10"],
    ["matcha", null],
    ["12 oz pet lid", "2026-11-10"],
    ["napkins", "2026-10-15"],
  ]);
  const purchases = [
    // Same day as the count counts as bought since.
    { date: "2026-11-10", store: "costco", item: "12 oz paper cup", quantity: "1 sleeve", cost: null },
    { date: "2026-11-12", store: "costco", item: "organic milk", quantity: "2 boxes", cost: null },
    // Enough to clear the pet cups; the milk bought before the count doesn't count.
    { date: "2026-11-11", store: "costco", item: "12 oz pet cup", quantity: "1 box", cost: null },
    { date: "2026-11-09", store: "costco", item: "organic milk", quantity: "5 boxes", cost: null },
  ];
  const buyRows = [
    { item: "napkins", added: "2026-11-14", done: false, rowIndex: 2 },
    { item: "blender pitcher", added: "2026-11-15", done: false, rowIndex: 3 },
    { item: "Blender Pitcher", added: "2026-11-16", done: false, rowIndex: 4 },
    { item: "Dish Soap", added: "2026-11-16", done: false, rowIndex: 5 },
    { item: "z-folds", added: "2026-11-10", done: true, rowIndex: 6 },
  ];

  const list = computeBuyList(catalog, counts, countDates, buyRows, purchases);
  assert.deepEqual(list.low, [
    { item: "12 oz paper cup", supplier: "costco", countText: "10 sleeves", countDate: "2026-11-10", boughtSince: ["1 sleeve"] },
    { item: "organic milk", supplier: "costco", countText: "5 boxes and 1 carton", countDate: "2026-11-10", boughtSince: ["2 boxes"] },
    { item: "napkins", supplier: "costco", countText: "0 packs", countDate: "2026-10-15", boughtSince: [] },
  ]);
  assert.deepEqual(list.handAdded, [
    { item: "blender pitcher", supplier: "", added: "2026-11-15", inCatalog: false },
    { item: "dish soap", supplier: "whole foods", added: "2026-11-16", inCatalog: true },
  ]);
  assert.deepEqual(list.needsReview, [{ item: "12 oz pet lid", problem: `can't read the count "3 sleeves of cups"` }]);
});

test("planPurchase skips exact repeats but still closes their buy-list rows, so a retry finishes the job", () => {
  const catalog = [item("napkins", 2), item("oat milk", 3)];
  const existing = [{ date: "2026-11-16", store: "Costco", item: "napkins", quantity: "1 pack", cost: null }];
  const buyRows = [
    { item: "Napkins", added: "2026-11-14", done: false, rowIndex: 2 },
    { item: "oat milk", added: "2026-11-14", done: true, rowIndex: 3 },
    { item: "Blender Pitcher ", added: "2026-11-15", done: false, rowIndex: 4 },
  ];
  const lines = [
    { item: "napkins", quantity: "1 pack" },
    { item: "oat milk", quantity: "6 boxes", cost: 90 },
    { item: "blender pitcher", quantity: "1", cost: 25 },
  ];
  const plan = planPurchase(catalog, existing, buyRows, lines, "2026-11-16", "costco", false);
  assert.deepEqual(plan.rows, [
    { date: "2026-11-16", store: "costco", item: "oat milk", quantity: "6 boxes", cost: "90", notes: "" },
    { date: "2026-11-16", store: "costco", item: "blender pitcher", quantity: "1", cost: "25", notes: "" },
  ]);
  assert.deepEqual(plan.skippedAsRepeat, ["napkins"]);
  assert.deepEqual(plan.close.map((r) => r.rowIndex), [2, 4]);

  const again = planPurchase(catalog, existing, buyRows, lines, "2026-11-16", "costco", true);
  assert.deepEqual(again.rows.map((r) => r.item), ["napkins", "oat milk", "blender pitcher"]);
  assert.deepEqual(again.skippedAsRepeat, []);
});

test("computeMonthSpend totals the calendar month's receipt costs by store and item", () => {
  const catalog = [item("oat milk", 2), item("napkins", 3), item("matcha", 4)];
  const purchases = [
    { date: "2026-11-05", store: "costco", item: "Oat Milk", quantity: "6 boxes", cost: 90 },
    { date: "2026-11-05", store: "Costco", item: "napkins", quantity: "1 pack", cost: 18 },
    { date: "2026-11-12", store: "costco", item: "matcha", quantity: "1 bag", cost: null },
    { date: "2026-11-27", store: "costco", item: "oat milk", quantity: "2 boxes", cost: 30 },
    { date: "2026-11-28", store: "amazon", item: "blender pitcher", quantity: "1", cost: 25 },
    { date: "2026-10-30", store: "costco", item: "oat milk", quantity: "1 box", cost: 15 },
    { date: "2026-12-01", store: "costco", item: "oat milk", quantity: "1 box", cost: 15 },
  ];

  const m = computeMonthSpend(catalog, purchases, "2026-11");
  assert.equal(m.spend, 163);
  assert.equal(m.unpricedPurchases, 1);
  // costco 11-05 (either case), costco 11-12, costco 11-27, amazon 11-28.
  assert.equal(m.runs, 4);
  assert.deepEqual(m.byStore, [
    { store: "costco", spend: 138, unpriced: 1 },
    { store: "amazon", spend: 25, unpriced: 0 },
  ]);
  assert.deepEqual(m.byItem, [
    { item: "oat milk", spend: 120, unpriced: 0 },
    { item: "blender pitcher", spend: 25, unpriced: 0 },
    { item: "napkins", spend: 18, unpriced: 0 },
    { item: "matcha", spend: 0, unpriced: 1 },
  ]);
});

test("computeMonthSpend with no purchases in the month", () => {
  const m = computeMonthSpend([], [], "2026-09");
  assert.deepEqual(m, { spend: 0, runs: 0, unpricedPurchases: 0, byStore: [], byItem: [] });
});
