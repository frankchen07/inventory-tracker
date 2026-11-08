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

// A real week: most reserves cover their orders, a few fall short, and two
// items have no reserve at all. Tuesday 2026-11-03.
const weekInputs = {
  recipes: [
    { recipe: "guatemala roast", category: "beans", recipeOzYieldQty: 80 },
    { recipe: "mexico chiapas roast", category: "beans", recipeOzYieldQty: 80 },
    { recipe: "espresso ccx", category: "concentrate", recipeOzYieldQty: 180 },
    { recipe: "chocolate syrup", category: "ingredient", recipeOzYieldQty: 32 },
    { recipe: "vanilla syrup", category: "ingredient", recipeOzYieldQty: 51 },
    { recipe: "marin kombucha", category: "purchase", recipeOzYieldQty: 640 },
  ],
  products: [
    { product: "espresso ccx pouch", recipeSource: "espresso ccx", ozRecipeSourceNeeded: 128, unitOz: 128 },
    { product: "nitro keg", recipeSource: "espresso ccx", ozRecipeSourceNeeded: 128, unitOz: 640 },
    { product: "kombucha keg", recipeSource: "marin kombucha", ozRecipeSourceNeeded: 640, unitOz: 640 },
    { product: "guatemala roast 10oz", recipeSource: "guatemala roast", ozRecipeSourceNeeded: 10, unitOz: 10 },
    { product: "guatemala roast 5lb", recipeSource: "guatemala roast", ozRecipeSourceNeeded: 80, unitOz: 80 },
    { product: "mexico chiapas roast 5lb", recipeSource: "mexico chiapas roast", ozRecipeSourceNeeded: 80, unitOz: 80 },
    { product: "vanilla syrup bottle", recipeSource: "vanilla syrup", ozRecipeSourceNeeded: 25.4, unitOz: 25.4 },
    { product: "chocolate squeeze bottle", recipeSource: "chocolate syrup", ozRecipeSourceNeeded: 16, unitOz: 16 },
  ],
  stockEntities: [
    { entity: "nitro keg", entityType: "product" as const, amt: 5, amtUnit: "kegs", rowIndex: 2 },
    { entity: "espresso ccx", entityType: "recipe" as const, amt: 6, amtUnit: "gallons", rowIndex: 3 },
    { entity: "guatemala roast", entityType: "recipe" as const, amt: 100, amtUnit: "lbs", rowIndex: 4 },
    { entity: "vanilla syrup bottle", entityType: "product" as const, amt: 2, amtUnit: "bottles", rowIndex: 5 },
    { entity: "chocolate squeeze bottle", entityType: "product" as const, amt: 1, amtUnit: "squeeze bottles", rowIndex: 6 },
  ],
  latestStock: new Map([
    ["nitro keg", 4],
    ["espresso ccx", 7],
    ["guatemala roast", 25],
    ["vanilla syrup bottle", 0.3],
    ["chocolate squeeze bottle", 1],
  ]),
  standing: [
    standing({ customer: "midwife", item: "vanilla syrup bottle", quantity: 2, channel: "popup" }),
    standing({ customer: "midwife", item: "chocolate squeeze bottle", quantity: 2, channel: "popup" }),
    standing({ customer: "midwife", item: "guatemala roast", quantity: 10, quantityUnit: "lbs", channel: "popup" }),
    standing({ customer: "midwife", item: "nitro keg", quantity: 0.7, channel: "popup" }),
    standing({ customer: "thermo fisher", item: "mexico chiapas roast", quantity: 20, quantityUnit: "lbs", dayOfWeek: "Thursday" }),
    standing({ customer: "pour decisions", item: "espresso ccx pouch", quantity: 6, dayOfWeek: "Friday" }),
    standing({ customer: "slb", item: "nitro keg", quantity: 1, dayOfWeek: "Friday" }),
    standing({ customer: "slb", item: "kombucha keg", quantity: 1, dayOfWeek: "Friday" }),
  ],
  oneOff: [],
};

const week = buildProductionPlan(weekInputs, "2026-11-03");
const roundTenths = (n: number) => Math.round(n * 10) / 10;

test("batches split into what orders need and what's optional refill", () => {
  assert.deepEqual(
    week.batches.map((b) => [b.recipe, b.batchesForOrders, b.batchesForRefill]),
    [
      ["guatemala roast", 0, 17],
      ["mexico chiapas roast", 4, 0],
      ["espresso ccx", 0, 6],
      ["chocolate syrup", 1, 0],
      ["vanilla syrup", 1, 1],
      ["marin kombucha", 1, 0],
    ],
  );
  for (const plan of [week, buildProductionPlan(inputs, TODAY)]) {
    for (const b of plan.batches) assert.equal(b.batchesForOrders + b.batchesForRefill, b.batchesNeeded, b.recipe);
  }
});

test("reserve draws list what orders take, covered first, then short", () => {
  assert.deepEqual(
    week.reserveDraws.map((d) => [d.item, d.unit, roundTenths(d.have), roundTenths(d.need), roundTenths(d.left), roundTenths(d.short)]),
    [
      ["nitro keg", "", 4, 1.7, 2.3, 0],
      ["espresso ccx", "gallons", 7, 6, 1, 0],
      ["guatemala roast", "lbs", 25, 10, 15, 0],
      ["vanilla syrup bottle", "", 0.3, 2, 0, 1.7],
      ["chocolate squeeze bottle", "", 1, 2, 0, 1],
      ["mexico chiapas roast", "lbs", 0, 20, 0, 20],
      ["kombucha keg", "", 0, 1, 0, 1],
    ],
  );
});

test("a reserve no order touches isn't listed as a draw", () => {
  const plan = buildProductionPlan({ ...weekInputs, standing: [], oneOff: [] }, "2026-11-03");
  assert.deepEqual(plan.reserveDraws, []);
});

test("a tiny floating-point excess doesn't read as a shortage", () => {
  const plan = buildProductionPlan(
    {
      ...weekInputs,
      latestStock: new Map([...weekInputs.latestStock, ["chocolate squeeze bottle", 0.3]]),
      standing: [
        standing({ item: "chocolate squeeze bottle", quantity: 0.1 }),
        standing({ item: "chocolate squeeze bottle", quantity: 0.2, dayOfWeek: "Thursday" }),
      ],
    },
    "2026-11-03",
  );
  const draw = plan.reserveDraws.find((d) => d.item === "chocolate squeeze bottle")!;
  assert.equal(draw.short, 0);
  assert.equal(plan.batches.find((b) => b.recipe === "chocolate syrup")!.batchesForOrders, 0);
});

test("a tracked product's shortfall counts toward its recipe's orders need", () => {
  const plan = buildProductionPlan(
    {
      ...weekInputs,
      latestStock: new Map([...weekInputs.latestStock, ["nitro keg", 0], ["espresso ccx", 1]]),
      standing: [standing({ item: "nitro keg", quantity: 3 })],
    },
    "2026-11-03",
  );
  const espresso = plan.reserveDraws.find((d) => d.item === "espresso ccx")!;
  assert.deepEqual([espresso.have, espresso.need, espresso.short], [1, 3, 2]);
  // 2 gallons short is 256oz, which takes 2 batches of 180oz.
  assert.equal(plan.batches.find((b) => b.recipe === "espresso ccx")!.batchesForOrders, 2);
});

test("an unknown recipe category still gets order batches", () => {
  const plan = buildProductionPlan(
    {
      ...weekInputs,
      recipes: [...weekInputs.recipes, { recipe: "mystery", category: "ordr", recipeOzYieldQty: 10 }],
      standing: [standing({ item: "mystery", quantity: 25, quantityUnit: "oz" })],
    },
    "2026-11-03",
  );
  const mystery = plan.batches.find((b) => b.recipe === "mystery")!;
  assert.deepEqual([mystery.category, mystery.batchesForOrders], ["ordr", 3]);
});

test("batch output names the one product a recipe fills, when there's a clear one", () => {
  assert.deepEqual(
    week.batches.map((b) => [b.recipe, b.output?.product ?? null, b.output?.unit ?? null, b.output?.ozEach ?? null]),
    [
      ["guatemala roast", null, null, null],
      ["mexico chiapas roast", "mexico chiapas roast 5lb", null, 80],
      ["espresso ccx", null, null, null],
      ["chocolate syrup", "chocolate squeeze bottle", "squeeze bottles", 16],
      ["vanilla syrup", "vanilla syrup bottle", "bottles", 25.4],
      ["marin kombucha", "kombucha keg", null, 640],
    ],
  );
});

test("refill levels show each reserve after orders, lowest first", () => {
  assert.deepEqual(
    week.refillLevels.map((r) => [r.entity, roundTenths(r.level), r.amt, r.amtUnit, r.batch?.recipe ?? null, r.units, r.recipeSource]),
    [
      ["guatemala roast", 15, 100, "lbs", "guatemala roast", 0, ""],
      ["vanilla syrup bottle", 0.3, 2, "bottles", "vanilla syrup", 0, "vanilla syrup"],
      ["espresso ccx", 1, 6, "gallons", "espresso ccx", 0, ""],
      ["nitro keg", 2.3, 5, "kegs", null, 3, "espresso ccx"],
      ["chocolate squeeze bottle", 1, 1, "squeeze bottles", "chocolate syrup", 0, "chocolate syrup"],
    ],
  );
});

test("a short product filled from a recipe's bulk reserve is required, not refill", () => {
  const plan = buildProductionPlan(
    {
      ...weekInputs,
      latestStock: new Map([...weekInputs.latestStock, ["nitro keg", 1]]),
      standing: [standing({ item: "nitro keg", quantity: 3 })],
    },
    "2026-11-03",
  );
  assert.deepEqual(plan.orderFills, [{ product: "nitro keg", units: 2, recipeSource: "espresso ccx" }]);
  assert.equal(plan.batches.find((b) => b.recipe === "espresso ccx")!.batchesForOrders, 0);
  const nitro = plan.refillLevels.find((r) => r.entity === "nitro keg")!;
  assert.deepEqual([nitro.level, nitro.units], [0, 5]);
  // Required plus optional still adds up to the plan's total.
  assert.equal(plan.productRequirements.find((p) => p.product === "nitro keg")!.totalQty, 7);
});

test("a short product whose own batches already say what to make isn't listed again", () => {
  assert.deepEqual(week.orderFills, []);
});

test("orders the plan can't turn into batches are reported, not dropped", () => {
  const plan = buildProductionPlan(
    {
      ...weekInputs,
      recipes: [...weekInputs.recipes, { recipe: "no yield", category: "ingredient", recipeOzYieldQty: 0 }],
      products: [
        ...weekInputs.products,
        { product: "typo source bottle", recipeSource: "no such recipe", ozRecipeSourceNeeded: 10, unitOz: 10 },
        { product: "no oz bottle", recipeSource: "vanilla syrup", ozRecipeSourceNeeded: 0, unitOz: 0 },
      ],
      standing: [
        standing({ item: "no yield", quantity: 5, quantityUnit: "oz" }),
        standing({ item: "typo source bottle", quantity: 1 }),
        standing({ item: "no oz bottle", quantity: 1 }),
        standing({ item: "ghost bottle", quantity: 1 }),
      ],
    },
    "2026-11-03",
  );
  assert.deepEqual(plan.sheetProblems, [
    { item: "no oz bottle", problem: "has no recipe oz in the products tab" },
    { item: "ghost bottle", problem: "isn't in the products tab" },
    { item: "no yield", problem: "has no batch yield in the recipes tab" },
    { item: "no such recipe", problem: "has no batch yield in the recipes tab" },
  ]);
});

test("a healthy week reports no sheet problems", () => {
  assert.deepEqual(week.sheetProblems, []);
});

test("a tracked product with zero recipe oz never produces NaN or Infinity", () => {
  const plan = buildProductionPlan(
    {
      ...weekInputs,
      products: weekInputs.products.map((p) =>
        p.product === "chocolate squeeze bottle" ? { ...p, ozRecipeSourceNeeded: 0 } : p,
      ),
    },
    "2026-11-03",
  );
  for (const r of plan.refillLevels) assert.ok(Number.isFinite(r.level), r.entity);
  assert.equal(plan.batches.find((b) => b.recipe === "chocolate syrup")?.output ?? null, null);
});

test("a reserve with a zero target has no refill row", () => {
  const plan = buildProductionPlan(
    {
      ...weekInputs,
      stockEntities: weekInputs.stockEntities.map((e) => (e.entity === "guatemala roast" ? { ...e, amt: 0 } : e)),
    },
    "2026-11-03",
  );
  assert.equal(plan.refillLevels.some((r) => r.entity === "guatemala roast"), false);
});

test("two tracked products sharing an unreserved recipe refill in units", () => {
  const plan = buildProductionPlan(
    {
      ...weekInputs,
      products: [
        ...weekInputs.products,
        { product: "vanilla syrup jug", recipeSource: "vanilla syrup", ozRecipeSourceNeeded: 100, unitOz: 100 },
      ],
      stockEntities: [
        ...weekInputs.stockEntities,
        { entity: "vanilla syrup jug", entityType: "product" as const, amt: 1, amtUnit: "jugs", rowIndex: 7 },
      ],
    },
    "2026-11-03",
  );
  const bottle = plan.refillLevels.find((r) => r.entity === "vanilla syrup bottle")!;
  const jug = plan.refillLevels.find((r) => r.entity === "vanilla syrup jug")!;
  assert.deepEqual([bottle.batch, bottle.units], [null, 2]);
  assert.deepEqual([jug.batch, jug.units], [null, 1]);
  assert.deepEqual(plan.orderFills, [{ product: "vanilla syrup bottle", units: 2, recipeSource: "vanilla syrup" }]);
});
