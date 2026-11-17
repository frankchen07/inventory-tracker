import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRestockList, computeStaleCounts, findCatalogItem } from "@/lib/inventory";
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

test("computeRestockList converts thresholds like counts, legacy 'or' cells by their first amount", () => {
  const cups = "1 box has 12 sleeves with 50 cups per sleeve";
  const catalog = [
    { ...item("8 oz cup", 3), unitConversion: cups, threshold: "500 cups" },
    { ...item("4 oz cup", 4), unitConversion: cups, threshold: "1 box or 12 sleeves or 600 cups" },
    { ...item("napkins", 17), unitConversion: "1 pack has 1120 napkins, 4 packs per box", threshold: "3 packs" },
    { ...item("lids", 8), unitConversion: cups, threshold: "1 box" },
  ];
  const counts = new Map([
    ["8 oz cup", "9 sleeves"],
    ["4 oz cup", "12 sleeves"],
    ["napkins", "2 packs"],
    ["lids", "3 sleeves of cups"],
  ]);
  const { lowStock, needsReview } = computeRestockList(catalog, counts);
  assert.deepEqual(lowStock.map((r) => r.item), ["8 oz cup", "napkins"]);
  assert.deepEqual(needsReview.map((r) => r.item), ["lids"]);
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
