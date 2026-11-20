import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBuyListView } from "@/lib/buy-list-view";
import type { BuyList, LowItem } from "@/lib/types";

const low = (item: string, supplier: string, countText = "1 box", countDate = "2026-11-10", bought: LowItem["boughtSince"] = []): LowItem => ({
  item,
  supplier,
  countText,
  countDate,
  boughtSince: bought,
});
const hand = (item: string, supplier = "", inCatalog = true, added = "2026-11-18") => ({ item, supplier, added, inCatalog });
const empty: BuyList = { low: [], handAdded: [], needsReview: [] };

test("AC-1: headline counts to-buy items and bought items", () => {
  const list: BuyList = {
    low: [
      ...Array.from({ length: 9 }, (_, i) => low(`item ${i}`, "costco")),
      low("a", "costco", "1 box", "2026-11-10", [{ date: "2026-11-12", quantity: "2 boxes" }]),
      low("b", "amazon", "1 box", "2026-11-10", [{ date: "2026-11-12", quantity: "1 box" }]),
    ],
    handAdded: [hand("trash bags"), hand("paper towels"), hand("q-tip pads", "target")],
    needsReview: [],
  };
  assert.equal(buildBuyListView(list, "2026-11-10", "2026-11-12").headline, "12 to buy · 2 already bought");
});

test("AC-2: headline drops the bought part when nothing is bought, and an empty list has no groups", () => {
  const list: BuyList = { ...empty, low: [low("ice", "costco")] };
  assert.equal(buildBuyListView(list, "2026-11-10", "2026-11-12").headline, "1 to buy");
  const view = buildBuyListView(empty, "2026-11-10", "2026-11-12");
  assert.equal(view.headline, "0 to buy");
  assert.deepEqual(view.groups, []);
});

test("AC-3: a stale latest count shows a banner with the days since", () => {
  const view = buildBuyListView(empty, "2026-10-15", "2026-11-18");
  assert.deepEqual(view.banner, { title: "Last count Oct 15, 34 days ago", detail: "Time to count." });
  assert.equal(view.lastCount, null);
  assert.deepEqual(buildBuyListView(empty, "2026-11-11", "2026-11-18").banner?.title, "Last count Nov 11, 7 days ago");
});

test("AC-4: a fresh latest count shows a muted last-count line and no banner", () => {
  assert.equal(buildBuyListView(empty, "2026-11-17", "2026-11-18").lastCount, "Last count Nov 17 (1 day ago)");
  assert.equal(buildBuyListView(empty, "2026-11-18", "2026-11-18").lastCount, "Last count Nov 18 (today)");
  const view = buildBuyListView(empty, "2026-11-12", "2026-11-18");
  assert.equal(view.lastCount, "Last count Nov 12 (6 days ago)");
  assert.equal(view.banner, null);
});

test("AC-5: no counts at all shows the no-counts banner", () => {
  const view = buildBuyListView(empty, null, "2026-11-18");
  assert.deepEqual(view.banner, { title: "No counts recorded yet.", detail: null });
  assert.equal(view.lastCount, null);
});

test("AC-6: items group by supplier case-insensitively, with status and a no-supplier group", () => {
  const list: BuyList = {
    low: [
      low("8 oz paper cup", "costco"),
      low("12 oz paper cup", "Costco", "10 sleeves", "2026-11-10", [{ date: "2026-11-12", quantity: "2 boxes" }]),
      low("4 oz paper cup", "amazon", "1 sleeve", "2026-11-10", [{ date: "2026-11-12", quantity: "1 box" }]),
    ],
    handAdded: [hand("trash bags", "", false)],
    needsReview: [],
  };
  const groups = buildBuyListView(list, "2026-11-10", "2026-11-12").groups;
  assert.deepEqual(
    groups.map((g) => [g.title, g.status, g.rows.length]),
    [
      ["Costco", "1 to buy", 2],
      ["No supplier yet", "1 to buy", 1],
      ["Amazon", "all bought", 1],
    ],
  );
});

test("AC-7: groups with to-buy items come first alphabetically, then no supplier, then all-bought groups", () => {
  const bought = [{ date: "2026-11-12", quantity: "1 box" }];
  const list: BuyList = {
    low: [
      low("x", "zeta"),
      low("y", "Espresso parts", "1 box", "2026-11-10", bought),
      low("z", "amazon", "1 box", "2026-11-10", bought),
      low("w", "costco"),
    ],
    handAdded: [hand("trash bags"), hand("q-tip pads", "target")],
    needsReview: [],
  };
  assert.deepEqual(
    buildBuyListView(list, "2026-11-10", "2026-11-12").groups.map((g) => g.title),
    ["Costco", "Target", "Zeta", "No supplier yet", "Amazon", "Espresso parts"],
  );
});

test("AC-8: within a group, to-buy low items, then hand-added, then bought", () => {
  const list: BuyList = {
    low: [
      low("12 oz paper cup", "costco", "10 sleeves", "2026-11-10", [{ date: "2026-11-12", quantity: "2 boxes" }]),
      low("8 oz paper cup", "costco"),
      low("toilet paper", "costco"),
    ],
    handAdded: [hand("dish soap", "costco"), hand("napkins", "costco")],
    needsReview: [],
  };
  assert.deepEqual(
    buildBuyListView(list, "2026-11-10", "2026-11-12").groups[0].rows.map((r) => r.item),
    ["8 oz paper cup", "Toilet paper", "Dish soap", "Napkins", "12 oz paper cup"],
  );
});

test("AC-9: a to-buy low row shows its count, and a date line only when counted on another day", () => {
  const list: BuyList = { ...empty, low: [low("8 oz paper cup", "costco", "7 sleeves", "2026-11-10"), low("ice", "costco", "0 bags", "2026-11-03")] };
  const rows = buildBuyListView(list, "2026-11-10", "2026-11-12").groups[0].rows;
  assert.deepEqual(rows[0], { item: "8 oz paper cup", right: "7 sleeves", note: null, kind: "low" });
  assert.deepEqual(rows[1], { item: "Ice", right: "0 bags", note: "Counted Nov 3", kind: "low" });
});

test("AC-10: a bought row lists its purchases in date order", () => {
  const list: BuyList = {
    ...empty,
    low: [
      low("12 oz paper cup", "costco", "10 sleeves", "2026-11-01", [
        { date: "2026-11-10", quantity: "1 box" },
        { date: "2026-11-04", quantity: "2 boxes" },
      ]),
    ],
  };
  assert.deepEqual(buildBuyListView(list, "2026-11-01", "2026-11-12").groups[0].rows[0], {
    item: "12 oz paper cup",
    right: "10 sleeves",
    note: "Bought Nov 4 · 2 boxes, Nov 10 · 1 box",
    kind: "bought",
  });
});

test("AC-11: a hand-added row says by hand, when added, and whether it's in inventory", () => {
  const list: BuyList = { ...empty, handAdded: [hand("trash bags", "", false), hand("q-tip pads", "target", true)] };
  const groups = buildBuyListView(list, "2026-11-10", "2026-11-18").groups;
  assert.deepEqual(groups[0].rows[0], { item: "Q-tip pads", right: "by hand", note: "Added Nov 18", kind: "hand" });
  assert.deepEqual(groups[1].rows[0], { item: "Trash bags", right: "by hand", note: "Added Nov 18 · not in inventory", kind: "hand" });
});

test("AC-7: all-bought groups sort alphabetically by title, including a no-supplier one", () => {
  const bought = [{ date: "2026-11-12", quantity: "1 box" }];
  const list: BuyList = {
    ...empty,
    low: [low("x", "", "1 box", "2026-11-10", bought), low("y", "amazon", "1 box", "2026-11-10", bought), low("z", "target", "1 box", "2026-11-10", bought)],
  };
  assert.deepEqual(
    buildBuyListView(list, "2026-11-10", "2026-11-12").groups.map((g) => g.title),
    ["Amazon", "No supplier yet", "Target"],
  );
});

test("AC-12: needs-review entries carry the display name and problem text", () => {
  const list: BuyList = { ...empty, needsReview: [{ item: "oat milk", problem: `can't read the count "lots"` }] };
  assert.deepEqual(buildBuyListView(list, "2026-11-10", "2026-11-12").needsReview, [
    { item: "Oat milk", problem: `can't read the count "lots"` },
  ]);
  assert.deepEqual(buildBuyListView(empty, "2026-11-10", "2026-11-12").needsReview, []);
});
