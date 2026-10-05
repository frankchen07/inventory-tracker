import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProductionPlan } from "@/lib/production";
import type { OneOffOrder, StandingOrder } from "@/lib/types";

function standing(o: Partial<StandingOrder>): StandingOrder {
  return {
    customer: "",
    item: "",
    quantity: 0,
    quantityUnit: "",
    dayOfWeek: "Wednesday",
    active: true,
    channel: "client",
    intervalWeeks: 1,
    anchorDate: "",
    ...o,
  };
}

function oneOff(o: Partial<OneOffOrder>): OneOffOrder {
  return { date: "", customer: "", item: "", quantity: 0, quantityUnit: "", notes: "", channel: "client", active: true, ...o };
}

// Monday 2026-10-05: popup week is Wed 10-07..Sat 10-10, capture window ends 10-13.
const TODAY = "2026-10-05";

const inputs = {
  recipes: [
    { recipe: "cold brew", category: "concentrate", recipeOzYieldQty: 1000 },
    { recipe: "guatemala roast", category: "beans", recipeOzYieldQty: 320 },
    { recipe: "vanilla syrup", category: "ingredient", recipeOzYieldQty: 500 },
  ],
  products: [
    { product: "nitro keg", recipeSource: "cold brew", ozRecipeSourceNeeded: 128, unitOz: 640 },
    { product: "cold brew bottle", recipeSource: "cold brew", ozRecipeSourceNeeded: 16, unitOz: 16 },
    { product: "vanilla syrup bottle", recipeSource: "vanilla syrup", ozRecipeSourceNeeded: 25, unitOz: 25 },
  ],
  stockEntities: [
    { entity: "nitro keg", entityType: "product" as const, amt: 4, amtUnit: "kegs", rowIndex: 2 },
    { entity: "cold brew", entityType: "recipe" as const, amt: 2, amtUnit: "gallons", rowIndex: 3 },
    { entity: "vanilla syrup bottle", entityType: "product" as const, amt: 2, amtUnit: "bottles", rowIndex: 4 },
  ],
  latestStock: new Map([
    ["nitro keg", 3],
    ["cold brew", 1],
    ["vanilla syrup bottle", 5],
  ]),
  standing: [
    standing({ customer: "Midwife", item: "nitro keg", quantity: 2, quantityUnit: "kegs", dayOfWeek: "Friday", channel: "popup" }),
    standing({ customer: "Cafe A", item: "cold brew bottle", quantity: 10, dayOfWeek: "Thursday" }),
    standing({ customer: "Midwife", item: "guatemala roast", quantity: 5, quantityUnit: "lbs", dayOfWeek: "Saturday", channel: "popup" }),
    standing({ customer: "Tri Now", item: "nitro keg", quantity: 1, intervalWeeks: 3, anchorDate: "2026-09-16" }),
    standing({ customer: "Tri Next", item: "nitro keg", quantity: 1, dayOfWeek: "Thursday", intervalWeeks: 3, anchorDate: "2026-09-23" }),
    standing({ customer: "Blank Anchor", item: "vanilla syrup", quantity: 50, quantityUnit: "oz", intervalWeeks: 4 }),
    standing({ customer: "Inactive", item: "nitro keg", quantity: 9, active: false }),
    standing({ customer: "Sunday", item: "nitro keg", quantity: 9, dayOfWeek: "Sunday" }),
  ],
  oneOff: [
    oneOff({ date: "2026-10-12", customer: "Event X", item: "cold brew bottle", quantity: 6 }),
    oneOff({ date: "2026-10-20", customer: "Too Late", item: "cold brew bottle", quantity: 6 }),
    oneOff({ date: "2026-10-08", customer: "Voided", item: "cold brew bottle", quantity: 6, active: false }),
  ],
};

const plan = buildProductionPlan(inputs, TODAY);

test("window is today through today+8", () => {
  assert.equal(plan.windowStart, "2026-10-05");
  assert.equal(plan.windowEnd, "2026-10-13");
});

test("demand: active, in-phase, in-window lines, sorted by date then customer", () => {
  assert.deepEqual(
    plan.demand.map((l) => [l.forDate, l.customer, l.item, l.quantity, l.quantityUnit, l.oz, l.displayQty, l.displayUnit, l.recipeCategory]),
    [
      ["2026-10-07", "Blank Anchor", "vanilla syrup", 50, "oz", 50, 2, "bottles", "ingredient"],
      ["2026-10-07", "Tri Now", "nitro keg", 1, "count", 640, 1, "kegs", null],
      ["2026-10-08", "Cafe A", "cold brew bottle", 10, "count", 160, 10, null, null],
      ["2026-10-09", "Midwife", "nitro keg", 2, "count", 1280, 2, "kegs", null],
      ["2026-10-10", "Midwife", "guatemala roast", 80, "oz", 80, null, null, "beans"],
      ["2026-10-12", "Event X", "cold brew bottle", 6, "count", 96, 6, null, null],
    ],
  );
  assert.deepEqual(
    plan.demand.map((l) => l.channel),
    ["client", "client", "client", "popup", "popup", "client"],
  );
});

test("upcoming: only non-weekly orders due next week and not this week", () => {
  assert.deepEqual(
    plan.upcomingDemand.map((l) => [l.forDate, l.customer, l.item, l.quantity, l.oz, l.displayQty, l.displayUnit]),
    [["2026-10-15", "Tri Next", "nitro keg", 1, 640, 1, "kegs"]],
  );
});

test("reserve levels: every entity, converted to oz", () => {
  assert.deepEqual(
    plan.reserveLevels.map((r) => [r.entity, r.entityType, r.amt, r.amtUnit, r.onHand, r.topUpQty, r.amtOz, r.onHandOz]),
    [
      ["nitro keg", "product", 4, "kegs", 3, 1, 2560, 1920],
      ["cold brew", "recipe", 2, "gallons", 1, 1, 256, 128],
      ["vanilla syrup bottle", "product", 2, "bottles", 5, 0, 50, 125],
    ],
  );
});

test("product requirements net demand against on-hand and target", () => {
  assert.deepEqual(
    plan.productRequirements.map((p) => [p.product, p.totalQty, p.totalOz, p.recipeSource]),
    [["nitro keg", 4, 512, "cold brew"]],
  );
});

test("batches net recipe demand against recipe reserve, sorted by category", () => {
  assert.deepEqual(
    plan.batches.map((b) => [b.recipe, b.category, b.totalNeededQty, b.recipeOzYieldQty, b.batchesNeeded, b.surplusQty]),
    [
      ["guatemala roast", "beans", 80, 320, 1, 240],
      ["cold brew", "concentrate", 896, 1000, 1, 104],
      ["vanilla syrup", "ingredient", 50, 500, 1, 450],
    ],
  );
});
