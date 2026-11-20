import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogColumns, computeBuyList, computeMonthSpend, findCatalogItem, parseInventoryGrid, planPurchase } from "@/lib/inventory";
import type { CatalogItem } from "@/lib/types";

const item = (name: string, rowIndex: number): CatalogItem => ({
  item: name,
  location: "",
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

test("computeBuyList flags items under threshold by count alone, noting purchases made since", () => {
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
    // A purchase doesn't change the count, so the pet cups stay low, marked bought.
    { date: "2026-11-11", store: "Costco", item: "12 OZ PET CUP", quantity: "1 box", cost: null },
    // Before the count, so already in it.
    { date: "2026-11-09", store: "costco", item: "organic milk", quantity: "5 boxes", cost: null },
    // Purchase quantities aren't parsed, so loose wording is fine.
    { date: "2026-11-01", store: "costco", item: "napkins", quantity: "a few packs", cost: null },
  ];
  const buyRows = [
    { item: "napkins", store: "", added: "2026-11-14", done: false, rowIndex: 2 },
    { item: "blender pitcher", store: "", added: "2026-11-15", done: false, rowIndex: 3 },
    { item: "Blender Pitcher", store: "", added: "2026-11-16", done: false, rowIndex: 4 },
    { item: "Dish Soap", store: "", added: "2026-11-16", done: false, rowIndex: 5 },
    { item: "z-folds", store: "", added: "2026-11-10", done: true, rowIndex: 6 },
  ];

  const list = computeBuyList(catalog, counts, countDates, buyRows, purchases);
  const bought = (date: string, quantity: string) => ({ date, quantity });
  assert.deepEqual(list.low, [
    { item: "12 oz paper cup", supplier: "costco", countText: "10 sleeves", countDate: "2026-11-10", boughtSince: [bought("2026-11-10", "1 sleeve")] },
    { item: "organic milk", supplier: "costco", countText: "5 boxes and 1 carton", countDate: "2026-11-10", boughtSince: [bought("2026-11-12", "2 boxes")] },
    { item: "12 oz pet cup", supplier: "costco", countText: "6 sleeves", countDate: "2026-11-10", boughtSince: [bought("2026-11-11", "1 box")] },
    { item: "napkins", supplier: "costco", countText: "0 packs", countDate: "2026-10-15", boughtSince: [bought("2026-11-01", "a few packs")] },
  ]);
  assert.deepEqual(list.handAdded, [
    { item: "blender pitcher", supplier: "", added: "2026-11-15", inCatalog: false },
    { item: "dish soap", supplier: "whole foods", added: "2026-11-16", inCatalog: true },
  ]);
  assert.deepEqual(list.needsReview, [{ item: "12 oz pet lid", problem: `can't read the count "3 sleeves of cups"` }]);
});

test("computeBuyList uses the store typed on the buy list, falling back to the inventory supplier", () => {
  const catalog = [{ ...item("q-tip pads", 2), supplier: "target" }, { ...item("napkins", 3), supplier: "costco" }];
  const buyRows = [
    { item: "trash bags", store: " Costco ", added: "2026-11-18", done: false, rowIndex: 2 },
    { item: "paper towels", store: "", added: "2026-11-18", done: false, rowIndex: 3 },
    { item: "Q-Tip Pads", store: "cvs", added: "2026-11-18", done: false, rowIndex: 4 },
    { item: "napkins", store: "", added: "2026-11-18", done: false, rowIndex: 5 },
  ];
  const list = computeBuyList(catalog, new Map(), new Map(), buyRows, []);
  assert.deepEqual(list.handAdded, [
    { item: "trash bags", supplier: "Costco", added: "2026-11-18", inCatalog: false },
    { item: "paper towels", supplier: "", added: "2026-11-18", inCatalog: false },
    { item: "q-tip pads", supplier: "cvs", added: "2026-11-18", inCatalog: true },
    { item: "napkins", supplier: "costco", added: "2026-11-18", inCatalog: true },
  ]);
});

test("planPurchase skips exact repeats but still closes their buy-list rows, so a retry finishes the job", () => {
  const catalog = [item("napkins", 2), item("oat milk", 3)];
  const existing = [{ date: "2026-11-16", store: "Costco", item: "napkins", quantity: "1 pack", cost: null }];
  const buyRows = [
    { item: "Napkins", store: "", added: "2026-11-14", done: false, rowIndex: 2 },
    { item: "oat milk", store: "", added: "2026-11-14", done: true, rowIndex: 3 },
    { item: "Blender Pitcher ", store: "", added: "2026-11-15", done: false, rowIndex: 4 },
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
    { store: "costco", spend: 138, unpriced: 1, lines: 4, runs: 3 },
    { store: "amazon", spend: 25, unpriced: 0, lines: 1, runs: 1 },
  ]);
  assert.deepEqual(m.byItem, [
    { item: "oat milk", spend: 120, unpriced: 0, quantities: ["6 boxes", "2 boxes"] },
    { item: "blender pitcher", spend: 25, unpriced: 0, quantities: ["1"] },
    { item: "napkins", spend: 18, unpriced: 0, quantities: ["1 pack"] },
    { item: "matcha", spend: 0, unpriced: 1, quantities: ["1 bag"] },
  ]);
});

test("computeMonthSpend with no purchases in the month", () => {
  const m = computeMonthSpend([], [], "2026-09");
  assert.deepEqual(m, { spend: 0, runs: 0, unpricedPurchases: 0, byStore: [], byItem: [] });
});

test("parseInventoryGrid finds columns by header name, so a location column can sit anywhere", () => {
  const today = [
    ["item", "category", "supplier", "unit conversion", "threshold", "2026-10-15", "2026-11-24"],
    ["oat milk", "milk", "costco", "1 box has 6 cartons", "4 boxes", "12 boxes", ""],
    [],
    ["lids", "cups", "costco", "1 box", "1 box", "", "2 boxes"],
  ];
  const withLocation = [
    ["item", "location", "category", "supplier", "unit conversion", "threshold", "notes", "", "2026-10-15", "2026-11-24"],
    ["oat milk", "walk-in", "milk", "costco", "1 box has 6 cartons", "4 boxes", "ask Dana", "", "12 boxes", ""],
    [],
    ["lids", "front shelf", "cups", "costco", "1 box", "1 box", "", "", "", "2 boxes"],
  ];
  const a = parseInventoryGrid(today);
  const b = parseInventoryGrid(withLocation);

  assert.deepEqual(a.catalog[0], {
    item: "oat milk",
    location: "",
    category: "milk",
    supplier: "costco",
    unitConversion: "1 box has 6 cartons",
    threshold: "4 boxes",
    rowIndex: 2,
  });
  assert.deepEqual(b.catalog[0], { ...a.catalog[0], location: "walk-in" });
  assert.deepEqual(b.catalog[1], { ...a.catalog[1], location: "front shelf" });
  for (const { catalog, latest } of [a, b]) {
    assert.deepEqual(catalog.map((c) => [c.item, c.rowIndex]), [["oat milk", 2], ["lids", 4]]);
    assert.equal(latest.valueAtRow(2), "12 boxes");
    assert.equal(latest.dateAtRow(2), "2026-10-15");
    assert.equal(latest.valueAtRow(4), "2 boxes");
    assert.equal(latest.latestDate, "2026-11-24");
  }
});

test("parseInventoryGrid needs an item column", () => {
  assert.throws(() => parseInventoryGrid([["name", "threshold"], ["oat milk", "1 box"]]), /"item" header/);
});

test("catalogColumns maps header names to positions", () => {
  assert.deepEqual(catalogColumns(["item", "location", "category", "supplier", "Unit Conversion", "threshold", "2026-10-15"]), {
    item: 0,
    location: 1,
    category: 2,
    supplier: 3,
    unitConversion: 4,
    threshold: 5,
  });
});
