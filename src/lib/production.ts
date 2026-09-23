import {
  RECIPES_SHEET,
  RECIPES_HEADERS,
  PRODUCTS_SHEET,
  PRODUCTS_HEADERS,
  STANDING_ORDERS_SHEET,
  STANDING_ORDERS_HEADERS,
  ORDERS_SHEET,
  ORDERS_HEADERS,
  RESERVE_STOCK_SHEET,
  RESERVE_STOCK_HEADERS,
  readRows,
  listDateColumns,
  readColumnValues,
} from "@/lib/sheets";
import type {
  Recipe,
  Product,
  StandingOrder,
  OneOffOrder,
  DemandLine,
  BatchRequirement,
  ProductionStockEntity,
  ReserveLevel,
  ProductRequirement,
  ProductionPlan,
} from "@/lib/types";
import { normalizeUnit } from "@/lib/unit-conversion";

// Universal physical-unit conversions for reserve-stock entities of type
// "recipe" (bulk goods with no single packaged product to size-convert
// through, e.g. "6 gallons" of concentrate or "100 lbs" of roast) — unlike
// "kegs"/"bottles", these units mean the same oz regardless of which recipe
// they're attached to, so a fixed table (not a per-product lookup) is
// correct here. Frank writes the colloquial amount directly into the
// "reserve stock" sheet's amt/amtUnit columns; this is what makes that
// number trustworthy for real production math instead of just a display
// label. An amtUnit not found here (including "oz" itself) is assumed to
// already be oz — same fail-open convention used elsewhere in this file.
const RECIPE_UNIT_OZ: Record<string, number> = {
  oz: 1,
  ounce: 1,
  lb: 16,
  pound: 16,
  gallon: 128,
  gal: 128,
};

// Resolves a standing/one-off order row's raw sheet quantity+quantityUnit
// (e.g. "2"/"lbs") into a real DemandLine quantity+quantityUnit, once `item`
// is known to name either a product or a recipe directly. "oz" always means
// raw oz already. Otherwise, only a *recipe*-direct item (no packaged
// product in between) can sensibly use a universal unit like "lbs"/
// "gallons" — a product-direct item (kegs, bottles) is already unambiguous
// as a plain count of that product's own known size, so any other word
// written there (including "kegs"/"gallons") is just a readable label and
// falls through to "count" untouched, same as blank always has. Mirrors
// reserveUnitOz()'s exact shape for the same reason: oz passthrough →
// universal table lookup for recipe-direct items → warn instead of silently
// mis-resolving, since a dropped order is a worse failure than a loud one.
function resolveQuantity(
  item: string,
  rawQuantity: number,
  rawUnit: string,
  recipeNames: Set<string>,
): { quantity: number; quantityUnit: "count" | "oz" } {
  const unit = normalizeUnit(rawUnit.trim().toLowerCase());
  if (unit === "oz" || unit === "ounce") return { quantity: rawQuantity, quantityUnit: "oz" };
  if (recipeNames.has(item.trim())) {
    const factor = RECIPE_UNIT_OZ[unit];
    if (factor !== undefined) return { quantity: rawQuantity * factor, quantityUnit: "oz" };
    if (unit !== "" && unit !== "count") {
      console.warn(
        `Unrecognized quantityUnit "${rawUnit}" for recipe-direct item "${item}" — treating as count (will likely fail to match any product)`,
      );
    }
  }
  return { quantity: rawQuantity, quantityUnit: "count" };
}

// Brewing/roasting happens Monday/Tuesday; usage, keg delivery, and
// espresso-concentrate delivery all happen Wednesday-Saturday of that same
// week. So "what to make" is never about a single day — it's the whole
// week's Wed-Sat window, computed off today's date regardless of which of
// those days it's actually opened on.
const WINDOW_DAYS = ["Wednesday", "Thursday", "Friday", "Saturday"];

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Parses a "YYYY-MM-DD" date string as local calendar date, not UTC, so it
// matches the wall calendar regardless of server timezone.
function parseDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function todayISO(): string {
  return isoDate(new Date());
}

// Monday of the calendar week containing `date` (JS getDay(): Sun=0..Sat=6).
export function mondayOfWeek(date: string): string {
  const daysSinceMonday = (parseDate(date).getDay() + 6) % 7;
  return addDays(date, -daysSinceMonday);
}

export async function getRecipes(): Promise<Recipe[]> {
  const rows = await readRows(RECIPES_SHEET, RECIPES_HEADERS);
  return rows.map((r) => ({
    recipe: r.recipe,
    category: r.category,
    recipeOzYieldQty: Number(r.recipeOzYieldQty) || 0,
  }));
}

export async function getProducts(): Promise<Product[]> {
  const rows = await readRows(PRODUCTS_SHEET, PRODUCTS_HEADERS);
  return rows.map((r) => {
    const ozRecipeSourceNeeded = Number(r.ozRecipeSourceNeeded) || 0;
    return {
      product: r.product,
      recipeSource: r.recipeSource,
      ozRecipeSourceNeeded,
      unitOz: r.unitOz.trim() === "" ? ozRecipeSourceNeeded : Number(r.unitOz) || ozRecipeSourceNeeded,
    };
  });
}

export async function getStandingOrders(): Promise<StandingOrder[]> {
  const rows = await readRows(STANDING_ORDERS_SHEET, STANDING_ORDERS_HEADERS);
  return rows.map((r) => ({
    customer: r.customer,
    item: r.item,
    quantity: Number(r.quantity) || 0,
    quantityUnit: r.quantityUnit.trim(),
    dayOfWeek: r.dayOfWeek,
    active: r.active.trim().toUpperCase() === "TRUE",
    channel: r.channel.trim().toLowerCase() === "popup" ? "popup" : "client",
    intervalWeeks: Number(r.intervalWeeks) || 1,
    anchorDate: r.anchorDate.trim(),
  }));
}

// Whether a standing order's cadence puts it "in phase" for the calendar
// week containing popupWeekStart. intervalWeeks <= 1 (weekly, or a
// blank/garbage value), a blank anchorDate, and an anchorDate that doesn't
// parse to a real date (typo, wrong format) all short-circuit to always due
// — see StandingOrder in types.ts for why a missing/unusable anchor fails
// open instead of silently dropping the order.
function isDueThisWeek(order: StandingOrder, popupWeekStart: string): boolean {
  if (order.intervalWeeks <= 1 || !order.anchorDate) return true;
  const anchorMonday = mondayOfWeek(order.anchorDate);
  const thisMonday = mondayOfWeek(popupWeekStart);
  const weeksSince = Math.round(
    (parseDate(thisMonday).getTime() - parseDate(anchorMonday).getTime()) / (7 * 86400000),
  );
  if (Number.isNaN(weeksSince)) return true;
  return ((weeksSince % order.intervalWeeks) + order.intervalWeeks) % order.intervalWeeks === 0;
}

// Builds one standing order's demand line against a specific week's
// Wednesday (weekStart) — used both for this week's real demand and for
// next week's look-ahead notice, so the two never drift apart in shape.
// Returns null if dayOfWeek doesn't match anything in the Wed-Sat window.
function standingOrderDemandLine(order: StandingOrder, weekStart: string, recipeNames: Set<string>): DemandLine | null {
  const dayIndex = WINDOW_DAYS.findIndex((d) => d.toLowerCase() === order.dayOfWeek.trim().toLowerCase());
  if (dayIndex === -1) return null;
  const { quantity, quantityUnit } = resolveQuantity(order.item, order.quantity, order.quantityUnit, recipeNames);
  return {
    customer: order.customer,
    item: order.item,
    quantity,
    quantityUnit,
    forDate: addDays(weekStart, dayIndex),
    channel: order.channel,
    oz: 0, // filled in by fillOz() once product sizes are known
    displayQty: null, // filled in by fillOz()
    displayUnit: null, // filled in by fillOz()
    recipeCategory: null, // filled in by fillOz()
  };
}

export async function getOneOffOrders(): Promise<OneOffOrder[]> {
  const rows = await readRows(ORDERS_SHEET, ORDERS_HEADERS);
  return rows.map((r) => ({
    date: r.date,
    customer: r.customer,
    item: r.item,
    quantity: Number(r.quantity) || 0,
    quantityUnit: r.quantityUnit.trim(),
    notes: r.notes,
    channel: r.channel.trim().toLowerCase() === "popup" ? "popup" : "client",
    active: r.active.trim().toUpperCase() === "TRUE",
  }));
}

export async function getProductionStockEntities(): Promise<ProductionStockEntity[]> {
  const rows = await readRows(RESERVE_STOCK_SHEET, RESERVE_STOCK_HEADERS);
  return rows.map((r) => ({
    entity: r.entity,
    entityType: r.entityType.trim().toLowerCase() === "product" ? "product" : "recipe",
    amt: Number(r.amt) || 0,
    amtUnit: r.amtUnit,
  }));
}

// Mirrors getLatestCounts() in inventory.ts: merges every date column
// left-to-right so a blank cell always resolves to the nearest earlier
// non-blank value for that entity — a physical count is ground truth as of
// the date it was taken, carried forward until the next one.
export async function getLatestProductionStock(): Promise<Map<string, number>> {
  const entities = await getProductionStockEntities();
  const cols = await listDateColumns(RESERVE_STOCK_SHEET, RESERVE_STOCK_HEADERS.length);
  const sorted = [...cols].sort((a, b) => a.date.localeCompare(b.date));

  const result = new Map<string, number>(entities.map((e) => [e.entity, 0]));
  for (const col of sorted) {
    const values = await readColumnValues(col.colIndex, entities.length, RESERVE_STOCK_SHEET);
    entities.forEach((e, i) => {
      const v = values[i];
      if (v !== "") result.set(e.entity, Number(v) || 0);
    });
  }
  return result;
}

// Standing orders that are active, in-phase for this week (isDueThisWeek —
// always true for weekly orders), and whose dayOfWeek falls in the Wed-Sat
// window (mapped to a concrete date via its offset from popupWeekStart,
// always this calendar week's Wednesday — standing demand only ever happens
// Wed-Sat, so this anchor stays fixed regardless of how wide the capture
// window itself is), plus one-off orders whose date falls anywhere within
// [windowStart, windowEnd]. Every line carries forDate so the UI can group
// deliveries by day. `standing`/`oneOff` are passed in (rather than fetched
// here) so computeProductionPlan() can fetch every sheet exactly once, in
// parallel, and share the standing-orders list with
// getUpcomingStandingDemand() instead of reading that tab twice.
export function getDemandForWindow(
  standing: StandingOrder[],
  oneOff: OneOffOrder[],
  popupWeekStart: string,
  windowStart: string,
  windowEnd: string,
  recipeNames: Set<string>,
): DemandLine[] {
  const demand: DemandLine[] = [];
  for (const order of standing) {
    if (!order.active) continue;
    if (!isDueThisWeek(order, popupWeekStart)) continue;
    const line = standingOrderDemandLine(order, popupWeekStart, recipeNames);
    if (line) demand.push(line);
  }
  for (const order of oneOff) {
    if (!order.active) continue;
    if (order.date >= windowStart && order.date <= windowEnd) {
      const { quantity, quantityUnit } = resolveQuantity(order.item, order.quantity, order.quantityUnit, recipeNames);
      demand.push({
        customer: order.customer,
        item: order.item,
        quantity,
        quantityUnit,
        forDate: order.date,
        channel: order.channel,
        oz: 0,
        displayQty: null,
        displayUnit: null,
        recipeCategory: null,
      });
    }
  }
  demand.sort((a, b) => a.forDate.localeCompare(b.forDate) || a.customer.localeCompare(b.customer));
  return demand;
}

// Non-weekly (intervalWeeks > 1) standing orders due *next* calendar week —
// purely informational, e.g. so a triweekly keg customer's delivery shows up
// a week ahead of time to leave lead time for ordering extra supplies.
// Deliberately excludes weekly orders (business as usual, no notice needed)
// and never feeds computeProductionPlan()'s batch totals — widening what
// actually gets *produced* this week to cover next week's periodic demand
// would double-count that order's oz (once as an early "preview" this week,
// then again for real next week).
export function getUpcomingStandingDemand(
  standing: StandingOrder[],
  popupWeekStart: string,
  recipeNames: Set<string>,
): DemandLine[] {
  const nextWeekStart = addDays(popupWeekStart, 7);

  const upcoming: DemandLine[] = [];
  for (const order of standing) {
    if (!order.active || order.intervalWeeks <= 1) continue;
    if (isDueThisWeek(order, popupWeekStart)) continue; // already showing in this week's demand
    if (!isDueThisWeek(order, nextWeekStart)) continue;
    const line = standingOrderDemandLine(order, nextWeekStart, recipeNames);
    if (line) upcoming.push(line);
  }
  upcoming.sort((a, b) => a.forDate.localeCompare(b.forDate) || a.customer.localeCompare(b.customer));
  return upcoming;
}

// Resolves each demand line to its recipe via `products.recipeSource`, then nets
// demand against on-hand reserve stock at *both* levels before converting to
// whole batches — a product's demand nets against that product's own
// on-hand/target first (e.g. surplus nitro kegs already on hand reduce how
// many more are needed), and the resulting oz-equivalent folds into its
// source recipe's raw need, which then nets against the recipe's own
// on-hand/target too (e.g. concentrate already in reserve reduces how much
// more needs brewing) — see computeProductionPlan() below for the two-stage
// `max(0, target + demand - onHand)` formula. Demand lines for a product
// with no matching `products` row are left out of the batch totals but
// still show up in `demand`.
//
// windowStart/windowEnd are a rolling ~9-day capture window starting today
// (not tied to the calendar week) — wide enough that an order due early next
// week is already visible today, with enough lead time to brew/roast for it
// during this week's Mon/Tue production slot. Standing orders still map onto
// this calendar week's actual Wed-Sat dates via the separate popupWeekStart
// anchor, so they never double up even though the capture window is wider
// than one Wed-Sat block.
export async function computeProductionPlan(): Promise<ProductionPlan> {
  const today = todayISO();
  const monday = mondayOfWeek(today);
  const popupWeekStart = addDays(monday, 2);
  const windowStart = today;
  const windowEnd = addDays(today, 8);

  const [standing, oneOff, recipes, products, stockEntities, latestStock] = await Promise.all([
    getStandingOrders(),
    getOneOffOrders(),
    getRecipes(),
    getProducts(),
    getProductionStockEntities(),
    getLatestProductionStock(),
  ]);
  const recipeNames = new Set(recipes.map((r) => r.recipe));
  const demand = getDemandForWindow(standing, oneOff, popupWeekStart, windowStart, windowEnd, recipeNames);
  const upcomingDemandRaw = getUpcomingStandingDemand(standing, popupWeekStart, recipeNames);

  const recipeByName = new Map(recipes.map((r) => [r.recipe, r]));
  const productByName = new Map(products.map((p) => [p.product, p]));
  const productsByRecipe = new Map<string, Product[]>();
  for (const p of products) {
    const list = productsByRecipe.get(p.recipeSource) ?? [];
    list.push(p);
    productsByRecipe.set(p.recipeSource, list);
  }
  const amtUnitByEntity = new Map(stockEntities.map((e) => [e.entity, e.amtUnit]));

  // A reserve entity's own oz size — a product entity converts through that
  // product's own physical size (its amtUnit, e.g. "kegs"/"bottles", is
  // necessarily specific to that one product, so unitOz is the only
  // authoritative source); a recipe entity has no such per-product size, so
  // it converts through the universal RECIPE_UNIT_OZ table keyed by its own
  // amtUnit instead (e.g. "lbs", "gallons").
  function reserveUnitOz(entity: ProductionStockEntity): number {
    if (entity.entityType === "product") return productByName.get(entity.entity)?.unitOz ?? 0;
    const unit = normalizeUnit(entity.amtUnit.trim());
    const factor = RECIPE_UNIT_OZ[unit];
    // Falling back to 1 (assume already oz) for an unrecognized unit is the
    // same silent-undercount failure mode this whole conversion exists to
    // fix — a typo'd or new unit (e.g. "quart") would quietly compute a
    // too-low oz figure and under-brew with no signal. Warn instead of
    // failing silently, since this feeds real production math.
    if (factor === undefined && unit !== "") {
      console.warn(`Unrecognized reserve stock amtUnit "${entity.amtUnit}" for "${entity.entity}" — assuming oz`);
    }
    return factor ?? 1;
  }

  // Oz-equivalent for display uses the product's own physical size (unitOz),
  // not its recipe-input ozRecipeSourceNeeded — a nitro keg order is 640oz of
  // finished drink, not the 128oz of concentrate that went into it.
  // quantityUnit "oz" lines are already raw oz (e.g. loose popup beans
  // drawn straight against the "guatemala roast" recipe, no bag in between).
  //
  // displayQty is a friendly packaged-unit figure for display: a "count"
  // line already is one (its quantity), so it's used as-is; an "oz" line
  // converts to the one product sourced from that recipe, but only when
  // there's exactly one such product — e.g. espresso ccx has three
  // differently-sized products, so there's no single right conversion and
  // display falls back to raw oz instead.
  function fillOz(lines: DemandLine[]): DemandLine[] {
    return lines.map((line) => {
      if (line.quantityUnit === "oz") {
        const sourced = productsByRecipe.get(line.item) ?? [];
        const displayQty = sourced.length === 1 && sourced[0].unitOz > 0 ? line.quantity / sourced[0].unitOz : null;
        const displayUnit = displayQty !== null ? amtUnitByEntity.get(sourced[0].product) ?? null : null;
        const recipeCategory = recipeByName.get(line.item)?.category ?? null;
        return { ...line, oz: line.quantity, displayQty, displayUnit, recipeCategory };
      }
      return {
        ...line,
        oz: (productByName.get(line.item)?.unitOz ?? 0) * line.quantity,
        displayQty: line.quantity,
        displayUnit: amtUnitByEntity.get(line.item) ?? null,
        recipeCategory: null,
      };
    });
  }
  const demandWithOz = fillOz(demand);
  const upcomingDemand = fillOz(upcomingDemandRaw);

  // Raw demand: count-based demand per product (deliberately NOT folded
  // into a recipe yet — it nets against that product's own on-hand first,
  // below), and oz-per-recipe from direct oz-lines (e.g. loose beans drawn
  // straight against a recipe, no packaged product in between).
  const demandByProduct = new Map<string, number>();
  const rawOzByRecipe = new Map<string, number>();
  for (const line of demandWithOz) {
    if (line.quantityUnit === "oz") {
      rawOzByRecipe.set(line.item, (rawOzByRecipe.get(line.item) ?? 0) + line.quantity);
      continue;
    }
    demandByProduct.set(line.item, (demandByProduct.get(line.item) ?? 0) + line.quantity);
  }

  // Every reserve-tracked entity gets a level (even at/above target) so the
  // "Reserve" section always shows the full picture — a pure on-hand-vs-
  // target snapshot answering "is my safety stock intact," which is a
  // deliberately different question from "how much do I need to make this
  // week" (computed below via the netted totals).
  const reserveLevels: ReserveLevel[] = [];
  const topUpByEntity = new Map<string, number>();
  for (const entity of stockEntities) {
    const onHand = latestStock.get(entity.entity) ?? 0;
    const topUpQty = Math.max(0, entity.amt - onHand);
    topUpByEntity.set(entity.entity, topUpQty);
    const unitOz = reserveUnitOz(entity);
    reserveLevels.push({
      entity: entity.entity,
      entityType: entity.entityType,
      amt: entity.amt,
      amtUnit: entity.amtUnit,
      onHand,
      topUpQty,
      amtOz: entity.amt * unitOz,
      onHandOz: onHand * unitOz,
    });
  }

  // Product-level netting: a reserve-tracked product's actionable "make N"
  // total nets its demand against its own on-hand/target — surplus units
  // already on hand reduce it, a shortfall increases it, same formula
  // either way: max(0, target + demand - onHand). topUpQty is kept as a
  // separate, purely informational "how much of a raw buffer shortfall
  // exists" figure — it's no longer summed into totalQty (that would
  // double-count demand already covered by on-hand stock). The netted
  // totalQty (not raw demand) is what folds upward into the source
  // recipe's raw oz need, since that's the actual number of units that
  // still need making.
  const productRequirements: ProductRequirement[] = [];
  const productEntityNames = new Set(
    stockEntities.filter((e) => e.entityType === "product").map((e) => e.entity),
  );
  for (const entity of stockEntities) {
    if (entity.entityType !== "product") continue;
    const product = productByName.get(entity.entity);
    const demandQty = demandByProduct.get(entity.entity) ?? 0;
    const onHand = latestStock.get(entity.entity) ?? 0;
    const topUpQty = topUpByEntity.get(entity.entity) ?? 0;
    const totalQty = Math.max(0, entity.amt + demandQty - onHand);
    if (totalQty > 0) {
      const totalOz = Math.ceil(totalQty) * (product?.ozRecipeSourceNeeded ?? 0);
      productRequirements.push({ product: entity.entity, demandQty, topUpQty, totalQty, totalOz });
    }
    if (product) {
      rawOzByRecipe.set(product.recipeSource, (rawOzByRecipe.get(product.recipeSource) ?? 0) + totalQty * product.ozRecipeSourceNeeded);
    }
  }
  productRequirements.sort((a, b) => a.product.localeCompare(b.product));

  // Products with real demand but no reserve-stock row are made fresh to
  // order — no on-hand to net against, so their raw demand folds straight
  // into the source recipe's need, same as before this change.
  for (const [productName, demandQty] of demandByProduct) {
    if (productEntityNames.has(productName)) continue; // already handled above
    const product = productByName.get(productName);
    if (!product) continue;
    rawOzByRecipe.set(product.recipeSource, (rawOzByRecipe.get(product.recipeSource) ?? 0) + demandQty * product.ozRecipeSourceNeeded);
  }

  // Recipe-level netting: same formula, one level up — a recipe's
  // actionable "need to brew" total nets its raw demand (direct oz-lines
  // plus everything folded up from products above) against its own
  // on-hand/target. Recipes with no reserve-stock row have nothing to net
  // against, so their raw demand is used as-is (matches pre-netting
  // behavior for anything not reserve-tracked).
  const neededByName = new Map(rawOzByRecipe);
  for (const entity of stockEntities) {
    if (entity.entityType !== "recipe") continue;
    const rawOz = rawOzByRecipe.get(entity.entity) ?? 0;
    const onHand = latestStock.get(entity.entity) ?? 0;
    const unitOz = reserveUnitOz(entity);
    neededByName.set(entity.entity, Math.max(0, entity.amt * unitOz + rawOz - onHand * unitOz));
  }

  const batches: BatchRequirement[] = [];
  for (const [recipeName, totalNeededQty] of neededByName) {
    const recipe = recipeByName.get(recipeName);
    if (!recipe || recipe.recipeOzYieldQty <= 0) continue;
    const batchesNeeded = Math.ceil(totalNeededQty / recipe.recipeOzYieldQty);
    batches.push({
      recipe: recipeName,
      category: recipe.category,
      totalNeededQty,
      unit: "oz",
      recipeOzYieldQty: recipe.recipeOzYieldQty,
      batchesNeeded,
      surplusQty: batchesNeeded * recipe.recipeOzYieldQty - totalNeededQty,
    });
  }
  batches.sort(
    (a, b) => a.category.localeCompare(b.category) || a.recipe.localeCompare(b.recipe),
  );

  return {
    windowStart,
    windowEnd,
    demand: demandWithOz,
    upcomingDemand,
    batches,
    reserveLevels,
    productRequirements,
  };
}
