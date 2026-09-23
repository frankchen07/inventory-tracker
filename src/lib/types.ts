// The "inventory" sheet's fixed catalog columns (A-E). Items are keyed by
// name — the sheet has no id column.
export interface CatalogItem {
  item: string;
  category: string;
  supplier: string;
  unitConversion: string;
  threshold: string;
}

// A catalog item currently below its threshold.
export interface RestockItem {
  item: string;
  supplier: string;
  remaining: string;
  remainingAtomic: number;
  thresholdAtomic: number;
}

// A catalog item with a recorded count that couldn't be converted to a
// number (e.g. a bare "6" with no unit) — status unknown, not "in stock."
export interface NeedsReviewItem {
  item: string;
  supplier: string;
  countText: string;
}

// "recipes" sheet: a batch process (brewing, roasting) and what it yields.
// Everything is oz — no per-recipe unit needed.
export interface Recipe {
  recipe: string;
  category: string;
  recipeOzYieldQty: number;
}

// "products" sheet: the countable unit you actually order/reserve/count in
// for one recipe (one recipe, many products) — not necessarily something
// sold directly to an outside customer, e.g. an internal ingredient like
// vanilla syrup bottles still belongs here since demand/reserve tracking
// needs a product-level FK target. recipeSource is the recipe this product
// is filled from; ozRecipeSourceNeeded is in that recipe's own oz yield.
export interface Product {
  product: string;
  recipeSource: string;
  ozRecipeSourceNeeded: number;
  // The product's own physical size in oz — same as ozRecipeSourceNeeded
  // unless the product is diluted (e.g. a nitro keg holds 640oz of finished
  // drink but only consumes 128oz of concentrate).
  unitOz: number;
}

// "standing orders" sheet: recurring demand. channel distinguishes Boast's
// own Midwife popup from client/event deliveries — display only.
// quantityUnit is the RAW sheet cell (e.g. "count", "oz", "lbs", "gallons",
// "kegs", blank) — resolved into a real DemandLine's quantity/quantityUnit
// ("count" | "oz") by resolveQuantity() in production.ts, once `item` is
// known to be a product or a recipe name (only then can "lbs"/"gallons" be
// told apart from a product's own colloquial count unit like "kegs"). See
// resolveQuantity() for the exact rule.
// `item` (not `product`) because it's genuinely either: a `Product.product`
// name (a packaged product — quantity is just a count of it) or a
// `Recipe.recipe` name (drawn directly off a bulk reserve with no
// packaged product in between, e.g. loose beans at the popup) — the same
// generalization "entity" already makes for reserve stock.
// intervalWeeks/anchorDate model cadence beyond weekly: intervalWeeks 1 (or
// blank) is weekly (the original, only behavior); 3 is triweekly; 4
// approximates "monthly" (accepted drift vs. true calendar months).
// anchorDate is any real occurrence of the order — used only to compute
// which weeks are "in phase" with the interval, not to pick the weekday
// (dayOfWeek still does that). A blank anchorDate with intervalWeeks > 1 is
// treated as weekly rather than silently dropping the order — a
// misconfigured row over-producing one week is visible and correctable; one
// that silently skips a real delivery is not.
export interface StandingOrder {
  customer: string;
  item: string;
  quantity: number;
  quantityUnit: string;
  dayOfWeek: string;
  active: boolean;
  channel: string;
  intervalWeeks: number;
  anchorDate: string;
}

// "orders" sheet: one-off demand for a specific date. See StandingOrder for
// what quantityUnit/item mean, and for active (blank = inactive, same
// convention — lets a specific one-off order be cancelled/voided without
// deleting the row).
export interface OneOffOrder {
  date: string;
  customer: string;
  item: string;
  quantity: number;
  quantityUnit: string;
  notes: string;
  channel: string;
  active: boolean;
}

// A single customer/item demand line for one delivery date within the
// week's Wed-Sat window, regardless of whether it came from a standing order
// (mapped onto a concrete date via its weekday) or a one-off order.
export interface DemandLine {
  customer: string;
  item: string;
  quantity: number;
  quantityUnit: "count" | "oz";
  forDate: string;
  channel: string;
  // Oz-equivalent of quantity, using the product's own physical size
  // (unitOz), not its recipe-input ozRecipeSourceNeeded.
  oz: number;
  // A friendly packaged-unit quantity for display, when unambiguous: for a
  // "count" line this is just quantity; for an "oz" line (a recipe drawn
  // directly, e.g. loose vanilla syrup) it's quantity/unitOz of the single
  // product sourced from that recipe, or null if zero or multiple products
  // could apply (e.g. espresso ccx has three differently-sized products, so
  // there's no single right answer — display falls back to raw oz instead).
  displayQty: number | null;
  // The friendly unit name for displayQty (e.g. "kegs", "bottles"), sourced
  // from the matching product's "reserve stock" row (ReserveLevel.amtUnit) —
  // null whenever displayQty is null, and also null if that product has no
  // reserve-stock row to draw a unit name from (falls back to a bare number).
  displayUnit: string | null;
  // The source recipe's category (e.g. "beans"), for an "oz" line whose
  // displayQty fell back to null (no single packaged product to convert
  // through) — lets display pick a friendly fallback unit anyway (pounds
  // for "beans") instead of always falling back to raw oz. Null for "count"
  // lines (never used there, since those always have a non-null displayQty).
  recipeCategory: string | null;
}

// How much of one recipe product is needed this week, and how many batches
// that requires. totalNeededQty is already netted against on-hand reserve
// stock (max(0, target + demand - onHand), or raw demand as-is for a recipe
// with no reserve-stock row) — see computeProductionPlan() in production.ts.
// unit is always "oz".
export interface BatchRequirement {
  recipe: string;
  category: string;
  totalNeededQty: number;
  unit: string;
  recipeOzYieldQty: number;
  batchesNeeded: number;
  surplusQty: number;
}

// "reserve stock" sheet: a running reserve level for a finished/semi-finished
// good, tracked the same way "inventory" tracks purchased-item counts — fixed
// columns plus a date column per periodic physical count.
export interface ProductionStockEntity {
  entity: string;
  entityType: "recipe" | "product";
  amt: number;
  amtUnit: string;
}

// Current on-hand vs. target for one reserve-tracked entity — every entity
// gets one of these regardless of whether it's currently short (topUpQty may
// be 0), powering the always-visible "Reserve" section. This is a pure
// on-hand-vs-target snapshot ("is my safety stock intact") — topUpQty is
// informational only here and is *not* what feeds batch/product totals;
// those net demand against on-hand directly (see ProductRequirement and
// BatchRequirement) rather than reusing this raw shortfall figure.
export interface ReserveLevel {
  entity: string;
  entityType: "recipe" | "product";
  // amt/amtUnit are exactly what's written in the "reserve stock" sheet —
  // whatever colloquial unit Frank tracks that entity in day-to-day (kegs,
  // bottles, lbs, gallons), not necessarily oz.
  amt: number;
  amtUnit: string;
  onHand: number;
  topUpQty: number;
  // Oz-equivalent of amt/onHand: converted via the product's own unitOz when
  // entityType is "product", or via amtUnit against a fixed physical-unit
  // table (lbs, gallons, ...) when entityType is "recipe" — see
  // reserveUnitOz() in production.ts. This is the number that actually feeds
  // production math; amt/amtUnit above are for display only.
  amtOz: number;
  onHandOz: number;
}

// How many units of one product to make this week, in the product's own
// count (e.g. number of kegs, not oz). Only *reserve-tracked* products show
// up here (i.e. products with a "reserve stock" row) — a product made fresh
// at time of sale with no reserve of its own (bottle, pouch, bag sizes) is
// never an independent production action, so it never appears here even
// when it has real demand; its demand is folded into its source instead.
export interface ProductRequirement {
  product: string;
  demandQty: number;
  // Informational only: the raw max(0, target - onHand) buffer shortfall,
  // ignoring demand entirely. NOT summed into totalQty — see totalQty.
  topUpQty: number;
  // The actionable "make N" figure: demand netted against on-hand/target,
  // max(0, target + demandQty - onHand) — NOT demandQty + topUpQty, since
  // that would double-count demand already covered by on-hand stock.
  totalQty: number;
  // Oz of source recipe consumed to produce the whole-unit count shown as
  // "Make N" (i.e. Math.ceil(totalQty) * product.ozRecipeSourceNeeded) — a
  // display-only figure, deliberately NOT the same number that actually
  // folds into the source recipe's raw oz need (which uses the unrounded
  // totalQty — see rawOzByRecipe in computeProductionPlan()). Rounding
  // totalQty up here keeps "Make 2" and its oz figure mutually consistent
  // (2 whole bottles really do take this much oz), instead of pairing a
  // rounded-up count with the smaller, unrounded raw-demand oz figure.
  totalOz: number;
}

// windowStart/windowEnd are a rolling ~9-day capture window starting today
// (see production.ts), not a fixed calendar-week range — there's no single
// "the date" this plan is for, since demand is aggregated across the whole
// window.
export interface ProductionPlan {
  windowStart: string;
  windowEnd: string;
  demand: DemandLine[];
  // Non-weekly standing orders due next calendar week — informational only,
  // never folded into batches/productRequirements below (see
  // getUpcomingStandingDemand in production.ts for why).
  upcomingDemand: DemandLine[];
  batches: BatchRequirement[];
  reserveLevels: ReserveLevel[];
  productRequirements: ProductRequirement[];
}

export interface ScanDraftLineItem {
  item: string;
  reportedQuantityText: string;
  confidence: number;
  ambiguous: boolean;
  notes: string | null;
}

// In-progress OCR result, stored as a Blob JSON object between upload and
// confirm — never written to the "inventory" sheet until confirmed.
export interface ScanDraft {
  id: string;
  scanDate: string;
  photoUrl: string;
  lineItems: ScanDraftLineItem[];
}
