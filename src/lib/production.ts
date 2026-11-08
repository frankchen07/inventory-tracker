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
  readLatestValues,
} from "@/lib/sheets";
import type {
  Recipe,
  Product,
  StandingOrder,
  OneOffOrder,
  DemandLine,
  BatchRequirement,
  OrderFill,
  ProductionStockEntity,
  ReserveLevel,
  ProductRequirement,
  ProductionPlan,
  RefillLevel,
  ReserveDraw,
  SheetProblem,
} from "@/lib/types";
import { normalizeUnit } from "@/lib/unit-conversion";
import { addDays, mondayOfWeek, parseDate, todayISO } from "@/lib/dates";

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
export const RECIPE_UNIT_OZ: Record<string, number> = {
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

// Brewing/roasting happens Monday/Tuesday and covers everything going out
// from that Wednesday through the following Tuesday — popup, deliveries and
// catering alike. So "what to make" is never about a single day — it's the
// whole Wed-Tue window, computed off today's date regardless of which day
// it's actually opened on. A Monday/Tuesday order lands at the *end* of the
// window, prepped a week ahead, never in the same days as production.
const WINDOW_DAYS = ["Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Monday", "Tuesday"];

function parseChannel(raw: string): string {
  return raw.trim().toLowerCase() === "popup" ? "popup" : "client";
}

function parseActive(raw: string): boolean {
  return raw.trim().toUpperCase() === "TRUE";
}

function byDateThenCustomer(a: DemandLine, b: DemandLine): number {
  return a.forDate.localeCompare(b.forDate) || a.customer.localeCompare(b.customer);
}

// Summing fractional quantities (0.1 + 0.2 against 0.3 on hand) leaves float
// dust that would otherwise read as "short" and cost a whole batch.
function shortfall(need: number, have: number): number {
  const short = need - have;
  return short < 1e-9 ? 0 : short;
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
    active: parseActive(r.active),
    channel: parseChannel(r.channel),
    intervalWeeks: Number(r.intervalWeeks) || 1,
    anchorDate: r.anchorDate.trim(),
  }));
}

// Whether a standing order's cadence puts it "in phase" for the calendar
// week containing `date`, the day it would actually go out — not the
// window's Wednesday, since a Tuesday at the end of the window falls in the
// next calendar week. intervalWeeks <= 1 (weekly, or a blank/garbage value),
// a blank anchorDate, and an anchorDate that doesn't parse to a real date
// (typo, wrong format) all short-circuit to always due — see StandingOrder
// in types.ts for why a missing/unusable anchor fails open instead of
// silently dropping the order.
function isDueOn(order: StandingOrder, date: string): boolean {
  if (order.intervalWeeks <= 1 || !order.anchorDate) return true;
  const anchorMonday = mondayOfWeek(order.anchorDate);
  const thisMonday = mondayOfWeek(date);
  const weeksSince = Math.round(
    (parseDate(thisMonday).getTime() - parseDate(anchorMonday).getTime()) / (7 * 86400000),
  );
  if (Number.isNaN(weeksSince)) return true;
  return ((weeksSince % order.intervalWeeks) + order.intervalWeeks) % order.intervalWeeks === 0;
}

function toDemandLine(
  order: StandingOrder | OneOffOrder,
  forDate: string,
  recipeNames: Set<string>,
): DemandLine {
  const { quantity, quantityUnit } = resolveQuantity(order.item, order.quantity, order.quantityUnit, recipeNames);
  return {
    customer: order.customer,
    item: order.item,
    quantity,
    quantityUnit,
    forDate,
    channel: order.channel,
    // filled in by fillOz() once product sizes are known
    oz: 0,
    displayQty: null,
    displayUnit: null,
    recipeCategory: null,
  };
}

// Builds one standing order's demand line against a specific window's
// Wednesday (weekStart) — used both for this window's real demand and for
// next window's look-ahead notice, so the two never drift apart in shape.
// Returns null if the order is out of phase that week, or if dayOfWeek
// isn't a real weekday.
function standingOrderDemandLine(order: StandingOrder, weekStart: string, recipeNames: Set<string>): DemandLine | null {
  const dayIndex = WINDOW_DAYS.findIndex((d) => d.toLowerCase() === order.dayOfWeek.trim().toLowerCase());
  if (dayIndex === -1) return null;
  const date = addDays(weekStart, dayIndex);
  return isDueOn(order, date) ? toDemandLine(order, date, recipeNames) : null;
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
    channel: parseChannel(r.channel),
    active: parseActive(r.active),
  }));
}

export async function getProductionStockEntities(): Promise<ProductionStockEntity[]> {
  const rows = await readRows(RESERVE_STOCK_SHEET, RESERVE_STOCK_HEADERS);
  return rows.map((r) => ({
    entity: r.entity,
    entityType: r.entityType.trim().toLowerCase() === "product" ? "product" : "recipe",
    amt: Number(r.amt) || 0,
    amtUnit: r.amtUnit,
    rowIndex: r._rowIndex,
  }));
}

// Active one-off orders dated within the 7-day window starting weekStart.
function oneOffDemand(oneOff: OneOffOrder[], weekStart: string, recipeNames: Set<string>): DemandLine[] {
  const windowEnd = addDays(weekStart, 6);
  return oneOff
    .filter((order) => order.active && order.date >= weekStart && order.date <= windowEnd)
    .map((order) => toDemandLine(order, order.date, recipeNames));
}

// Standing orders that are active and in phase on the day they'd go out
// (always true for weekly orders), mapped onto a concrete date in the Wed-Tue
// window starting weekStart, plus one-off orders dated within that window.
// Every line carries forDate so the UI can group deliveries by day.
// `standing`/`oneOff` are passed in (rather than fetched here) so
// computeProductionPlan() can fetch every sheet exactly once, in parallel,
// and share them with getUpcomingDemand() instead of reading each tab twice.
export function getDemandForWindow(
  standing: StandingOrder[],
  oneOff: OneOffOrder[],
  weekStart: string,
  recipeNames: Set<string>,
): DemandLine[] {
  const demand: DemandLine[] = [];
  for (const order of standing) {
    if (!order.active) continue;
    const line = standingOrderDemandLine(order, weekStart, recipeNames);
    if (line) demand.push(line);
  }
  demand.push(...oneOffDemand(oneOff, weekStart, recipeNames));
  demand.sort(byDateThenCustomer);
  return demand;
}

// Next window's non-weekly (intervalWeeks > 1) standing orders and one-off
// orders — purely informational, e.g. so a triweekly keg customer's delivery
// shows up a week ahead of time to leave lead time for ordering extra
// supplies. Deliberately excludes weekly orders (business as usual, no
// notice needed) and never feeds computeProductionPlan()'s batch totals —
// widening what actually gets *produced* this week to cover next week's
// demand would double-count that order's oz (once as an early "preview" this
// week, then again for real next week).
export function getUpcomingDemand(
  standing: StandingOrder[],
  oneOff: OneOffOrder[],
  weekStart: string,
  recipeNames: Set<string>,
): DemandLine[] {
  const nextWeekStart = addDays(weekStart, 7);

  const upcoming: DemandLine[] = [];
  for (const order of standing) {
    if (!order.active || order.intervalWeeks <= 1) continue;
    if (standingOrderDemandLine(order, weekStart, recipeNames)) continue; // already showing in this window's demand
    const line = standingOrderDemandLine(order, nextWeekStart, recipeNames);
    if (line) upcoming.push(line);
  }
  upcoming.push(...oneOffDemand(oneOff, nextWeekStart, recipeNames));
  upcoming.sort(byDateThenCustomer);
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
// windowStart/windowEnd are this calendar week's Wednesday through the
// following Tuesday (see WINDOW_DAYS). Next window's orders show up early
// as upcomingDemand, for lead time.
export async function computeProductionPlan(): Promise<ProductionPlan> {
  const [standing, oneOff, recipes, products, stockEntities, latest] = await Promise.all([
    getStandingOrders(),
    getOneOffOrders(),
    getRecipes(),
    getProducts(),
    getProductionStockEntities(),
    readLatestValues(RESERVE_STOCK_SHEET, RESERVE_STOCK_HEADERS.length),
  ]);
  // A physical count is ground truth as of the date it was taken, carried
  // forward until the next one; never counted reads as 0.
  const latestStock = new Map(stockEntities.map((e) => [e.entity, Number(latest.valueAtRow(e.rowIndex)) || 0]));
  const countDates = new Map(
    stockEntities.flatMap((e) => {
      const date = latest.dateAtRow(e.rowIndex);
      return date ? [[e.entity, date] as const] : [];
    }),
  );
  return buildProductionPlan({ standing, oneOff, recipes, products, stockEntities, latestStock, countDates }, todayISO());
}

export interface ProductionInputs {
  standing: StandingOrder[];
  oneOff: OneOffOrder[];
  recipes: Recipe[];
  products: Product[];
  stockEntities: ProductionStockEntity[];
  latestStock: Map<string, number>;
  // Date of each reserve entity's latest count; missing if never counted.
  countDates: Map<string, string>;
}

export function buildProductionPlan(
  { standing, oneOff, recipes, products, stockEntities, latestStock, countDates }: ProductionInputs,
  today: string,
): ProductionPlan {
  const windowStart = addDays(mondayOfWeek(today), 2);
  const windowEnd = addDays(windowStart, 6);

  const recipeNames = new Set(recipes.map((r) => r.recipe));
  const windowDemand = getDemandForWindow(standing, oneOff, windowStart, recipeNames);
  const upcomingDemandRaw = getUpcomingDemand(standing, oneOff, windowStart, recipeNames);

  const recipeByName = new Map(recipes.map((r) => [r.recipe, r]));
  const productByName = new Map(products.map((p) => [p.product, p]));
  const productsByRecipe = Map.groupBy(products, (p) => p.recipeSource);
  const amtUnitByEntity = new Map(stockEntities.map((e) => [e.entity, e.amtUnit]));

  // Counts are taken after service, so an order dated on or before an item's
  // count is already reflected in it — subtracting it again would double-count.
  // An order is checked against the reserve it draws from: its own row, else
  // its product's recipe row. With no count to check against, an order drops
  // off once its day has passed (it's been made and delivered).
  const stockEntityNames = new Set(stockEntities.map((e) => e.entity));
  const countedAs = (item: string) => {
    if (stockEntityNames.has(item)) return item;
    const recipe = productByName.get(item)?.recipeSource ?? "";
    return stockEntities.some((e) => e.entity === recipe && e.entityType === "recipe") ? recipe : "";
  };
  const yesterday = addDays(today, -1);
  const demand = windowDemand.filter((line) => line.forDate > (countDates.get(countedAs(line.item)) ?? yesterday));

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
  const addRawOz = (recipe: string, oz: number) => rawOzByRecipe.set(recipe, (rawOzByRecipe.get(recipe) ?? 0) + oz);
  for (const line of demandWithOz) {
    if (line.quantityUnit === "oz") {
      addRawOz(line.item, line.quantity);
      continue;
    }
    demandByProduct.set(line.item, (demandByProduct.get(line.item) ?? 0) + line.quantity);
  }
  const directOzByRecipe = new Map(rawOzByRecipe);

  // Every reserve-tracked entity gets a level (even at/above target) so the
  // "Reserve" section always shows the full picture — a pure on-hand-vs-
  // target snapshot answering "is my safety stock intact," which is a
  // deliberately different question from "how much do I need to make this
  // week" (computed below via the netted totals).
  const reserveLevels: ReserveLevel[] = stockEntities.map((entity) => {
    const onHand = latestStock.get(entity.entity) ?? 0;
    const unitOz = reserveUnitOz(entity);
    return {
      entity: entity.entity,
      entityType: entity.entityType,
      amt: entity.amt,
      amtUnit: entity.amtUnit,
      onHand,
      topUpQty: Math.max(0, entity.amt - onHand),
      amtOz: entity.amt * unitOz,
      onHandOz: onHand * unitOz,
    };
  });

  // Product-level netting: a reserve-tracked product's actionable "make N"
  // total nets its demand against its own on-hand/target — surplus units
  // already on hand reduce it, a shortfall increases it, same formula
  // either way: max(0, target + demand - onHand). Not demand + topUp, which
  // would double-count demand already covered by on-hand stock. The netted
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
    const totalQty = Math.max(0, entity.amt + demandQty - onHand);
    if (totalQty > 0) {
      const totalOz = Math.ceil(totalQty) * (product?.ozRecipeSourceNeeded ?? 0);
      productRequirements.push({ product: entity.entity, totalQty, totalOz, recipeSource: product?.recipeSource ?? "" });
    }
    if (product) addRawOz(product.recipeSource, totalQty * product.ozRecipeSourceNeeded);
  }
  productRequirements.sort((a, b) => a.product.localeCompare(b.product));

  // Products with real demand but no reserve-stock row are made fresh to
  // order — no on-hand to net against, so their raw demand folds straight
  // into the source recipe's need.
  for (const [productName, demandQty] of demandByProduct) {
    if (productEntityNames.has(productName)) continue; // already handled above
    const product = productByName.get(productName);
    if (!product) continue;
    addRawOz(product.recipeSource, demandQty * product.ozRecipeSourceNeeded);
  }

  // Recipe-level netting: same formula, one level up — a recipe's
  // actionable "need to brew" total nets its raw demand (direct oz-lines
  // plus everything folded up from products above) against its own
  // on-hand/target. Recipes with no reserve-stock row have nothing to net
  // against, so their raw demand is used as-is.
  const neededByName = new Map(rawOzByRecipe);
  for (const entity of stockEntities) {
    if (entity.entityType !== "recipe") continue;
    const rawOz = rawOzByRecipe.get(entity.entity) ?? 0;
    const onHand = latestStock.get(entity.entity) ?? 0;
    const unitOz = reserveUnitOz(entity);
    neededByName.set(entity.entity, Math.max(0, entity.amt * unitOz + rawOz - onHand * unitOz));
  }

  // The part of each recipe's raw need that this week's orders actually
  // require: direct oz-lines, made-fresh products, and only the *shortfall*
  // of a tracked product (units it already has on hand are covered, and its
  // gap back up to target is optional refill, not order demand).
  const onHandOf = (name: string) => latestStock.get(name) ?? 0;
  const recipeEntityByName = new Map(
    stockEntities.filter((e) => e.entityType === "recipe").map((e) => [e.entity, e]),
  );
  const trackedProductsOf = (recipe: string) =>
    (productsByRecipe.get(recipe) ?? []).filter((p) => productEntityNames.has(p.product));
  const orderOzByRecipe = new Map(directOzByRecipe);
  const orderFills: OrderFill[] = [];
  const sheetProblems: SheetProblem[] = [];
  for (const [productName, demandQty] of demandByProduct) {
    const product = productByName.get(productName);
    if (!product) {
      sheetProblems.push({ item: productName, problem: "isn't in the products tab" });
      continue;
    }
    const isTracked = productEntityNames.has(productName);
    const qty = isTracked ? shortfall(demandQty, onHandOf(productName)) : demandQty;
    if (qty > 0 && product.ozRecipeSourceNeeded <= 0) {
      sheetProblems.push({ item: productName, problem: "has no recipe oz in the products tab" });
    }
    if (
      isTracked &&
      qty > 0 &&
      (recipeEntityByName.has(product.recipeSource) || trackedProductsOf(product.recipeSource).length > 1)
    ) {
      orderFills.push({ product: productName, units: Math.ceil(qty), recipeSource: product.recipeSource });
    }
    orderOzByRecipe.set(
      product.recipeSource,
      (orderOzByRecipe.get(product.recipeSource) ?? 0) + qty * product.ozRecipeSourceNeeded,
    );
  }

  const orderShortOz = (recipe: string) => {
    const entity = recipeEntityByName.get(recipe);
    const haveOz = entity ? onHandOf(recipe) * reserveUnitOz(entity) : 0;
    return shortfall(orderOzByRecipe.get(recipe) ?? 0, haveOz);
  };

  const batches: BatchRequirement[] = [];
  for (const [recipeName, totalNeededQty] of neededByName) {
    const recipe = recipeByName.get(recipeName);
    if (!recipe || recipe.recipeOzYieldQty <= 0) continue;
    const batchesNeeded = Math.ceil(totalNeededQty / recipe.recipeOzYieldQty);
    const batchesForOrders = Math.min(batchesNeeded, Math.ceil(orderShortOz(recipeName) / recipe.recipeOzYieldQty));
    const tracked = trackedProductsOf(recipeName);
    const candidates = tracked.length > 0 ? tracked : productsByRecipe.get(recipeName) ?? [];
    const soleProduct = candidates.length === 1 ? candidates[0] : null;
    batches.push({
      recipe: recipeName,
      category: recipe.category,
      totalNeededQty,
      recipeOzYieldQty: recipe.recipeOzYieldQty,
      batchesNeeded,
      surplusQty: batchesNeeded * recipe.recipeOzYieldQty - totalNeededQty,
      batchesForOrders,
      batchesForRefill: batchesNeeded - batchesForOrders,
      output:
        soleProduct && soleProduct.ozRecipeSourceNeeded > 0 && !recipeEntityByName.has(recipeName)
          ? {
              product: soleProduct.product,
              unit: amtUnitByEntity.get(soleProduct.product) ?? null,
              ozEach: soleProduct.ozRecipeSourceNeeded,
            }
          : null,
    });
  }
  batches.sort(
    (a, b) => a.category.localeCompare(b.category) || a.recipe.localeCompare(b.recipe),
  );
  const batchByRecipe = new Map(batches.map((b) => [b.recipe, b]));
  for (const recipeName of orderOzByRecipe.keys()) {
    if (orderShortOz(recipeName) > 0 && !batchByRecipe.has(recipeName)) {
      sheetProblems.push({ item: recipeName, problem: "has no batch yield in the recipes tab" });
    }
  }

  const toDraw = (item: string, unit: string, have: number, need: number): ReserveDraw => ({
    item,
    unit,
    have,
    need,
    left: Math.max(0, have - need),
    short: shortfall(need, have),
  });
  const reserveDraws: ReserveDraw[] = [];
  for (const entity of stockEntities) {
    const need =
      entity.entityType === "product"
        ? demandByProduct.get(entity.entity) ?? 0
        : (orderOzByRecipe.get(entity.entity) ?? 0) / reserveUnitOz(entity);
    if (need > 0) {
      reserveDraws.push(toDraw(entity.entity, entity.entityType === "product" ? "" : entity.amtUnit, onHandOf(entity.entity), need));
    }
  }
  for (const [recipeName, oz] of directOzByRecipe) {
    const recipe = recipeByName.get(recipeName);
    if (!recipe || recipeEntityByName.has(recipeName)) continue;
    reserveDraws.push(
      recipe.category === "beans" ? toDraw(recipeName, "lbs", 0, oz / RECIPE_UNIT_OZ.lb) : toDraw(recipeName, "oz", 0, oz),
    );
  }
  for (const [productName, demandQty] of demandByProduct) {
    const product = productByName.get(productName);
    if (!product || productEntityNames.has(productName) || recipeEntityByName.has(product.recipeSource)) continue;
    reserveDraws.push(toDraw(productName, "", 0, demandQty));
  }
  reserveDraws.sort((a, b) => Number(a.short > 0) - Number(b.short > 0));

  // What an order batch makes beyond the order shortfall lands in the reserve
  // it was brewed into, so a level here can sit above max(0, have - need).
  const orderLeftoverOz = (recipe: string) => {
    const batch = batchByRecipe.get(recipe);
    return batch ? batch.batchesForOrders * batch.recipeOzYieldQty - orderShortOz(recipe) : 0;
  };
  const refillLevels: RefillLevel[] = [];
  for (const entity of stockEntities) {
    if (entity.amt <= 0) continue;
    const onHand = onHandOf(entity.entity);
    if (entity.entityType === "recipe") {
      const unitOz = reserveUnitOz(entity);
      const need = (orderOzByRecipe.get(entity.entity) ?? 0) / unitOz;
      const level = Math.max(0, onHand - need) + orderLeftoverOz(entity.entity) / unitOz;
      const batch = batchByRecipe.get(entity.entity) ?? null;
      refillLevels.push({
        entity: entity.entity,
        amt: entity.amt,
        amtUnit: entity.amtUnit,
        level,
        batch,
        units: batch ? 0 : Math.ceil(shortfall(entity.amt, level)),
        recipeSource: "",
      });
      continue;
    }
    const product = productByName.get(entity.entity);
    const recipeSource = product?.recipeSource ?? "";
    // Only a recipe with no bulk reserve and this as its one tracked product
    // has batches that clearly belong to this row; otherwise those batches
    // are shared, so the honest count is units of this product.
    const batch =
      !recipeEntityByName.has(recipeSource) && trackedProductsOf(recipeSource).length === 1
        ? batchByRecipe.get(recipeSource) ?? null
        : null;
    const leftover = batch && product?.ozRecipeSourceNeeded ? orderLeftoverOz(recipeSource) / product.ozRecipeSourceNeeded : 0;
    const level = Math.max(0, onHand - (demandByProduct.get(entity.entity) ?? 0)) + leftover;
    refillLevels.push({
      entity: entity.entity,
      amt: entity.amt,
      amtUnit: entity.amtUnit,
      level,
      batch,
      units: batch ? 0 : Math.ceil(shortfall(entity.amt, level)),
      recipeSource,
    });
  }
  refillLevels.sort((a, b) => a.level / a.amt - b.level / b.amt);

  return {
    windowStart,
    windowEnd,
    demand: demandWithOz,
    upcomingDemand,
    batches,
    reserveLevels,
    productRequirements,
    reserveDraws,
    refillLevels,
    orderFills,
    sheetProblems,
  };
}
