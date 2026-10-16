import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRestockList, findCatalogItem } from "@/lib/inventory";
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
