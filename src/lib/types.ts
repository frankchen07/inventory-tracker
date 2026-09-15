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
  recipeProduct: string;
  category: string;
  recipeOzYieldQty: number;
}

// "products" sheet: the countable unit you actually order/reserve/count in
// for one recipe (one recipe, many products) — not necessarily something
// sold directly to an outside customer, e.g. an internal ingredient like
// vanilla syrup bottles still belongs here since demand/reserve tracking
// needs a product-level FK target. source is the recipe this product is
// filled from; ozSourceNeeded is in that recipe's own oz yield.
export interface Product {
  product: string;
  source: string;
  ozSourceNeeded: number;
  // The product's own physical size in oz — same as ozSourceNeeded unless the
  // product is diluted (e.g. a nitro keg holds 640oz of finished drink but
  // only consumes 128oz of concentrate).
  unitOz: number;
}

// "standing orders" sheet: recurring weekly demand. channel distinguishes
// Boast's own Midwife popup from client/event deliveries — display only.
// quantityUnit "count" (default) means quantity is in the named product's
// own unit; "oz" means quantity is already raw oz and product names a
// reserve-tracked product or recipe directly — used for demand that draws
// straight off a bulk reserve with no packaged product in between (e.g.
// loose beans used at the popup, pulled straight from the roast bucket).
export interface StandingOrder {
  customer: string;
  product: string;
  quantity: number;
  quantityUnit: "count" | "oz";
  dayOfWeek: string;
  active: boolean;
  channel: string;
}

// "orders" sheet: one-off demand for a specific date. See StandingOrder for
// what quantityUnit means.
export interface OneOffOrder {
  date: string;
  customer: string;
  product: string;
  quantity: number;
  quantityUnit: "count" | "oz";
  notes: string;
  channel: string;
}

// A single customer/product demand line for one delivery date within the
// week's Wed-Sat window, regardless of whether it came from a standing order
// (mapped onto a concrete date via its weekday) or a one-off order.
export interface DemandLine {
  customer: string;
  product: string;
  quantity: number;
  quantityUnit: "count" | "oz";
  forDate: string;
  channel: string;
  // Oz-equivalent of quantity, using the product's own physical size
  // (unitOz), not its recipe-input ozSourceNeeded.
  oz: number;
}

// How much of one recipe product is needed on a given date, and how many
// batches that requires. unit is always "oz".
export interface BatchRequirement {
  recipeProduct: string;
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
// be 0), powering the always-visible "Reserve" section. When topUpQty > 0 it
// was also folded into the corresponding recipe product's batch total.
export interface ReserveLevel {
  entity: string;
  entityType: "recipe" | "product";
  amt: number;
  amtUnit: string;
  onHand: number;
  topUpQty: number;
  // Oz-equivalent of amt/onHand — identical to amt/onHand when entityType is
  // "recipe" (already oz-native); converted via the product's unitOz when
  // entityType is "product".
  amtOz: number;
  onHandOz: number;
}

// How many units of one product to make this week — demand across both
// channels plus that product's own reserve top-up, in the product's own
// count (e.g. number of kegs, not oz). Only *reserve-tracked* products show
// up here (i.e. products with a "reserve stock" row) — a product made fresh
// at time of sale with no reserve of its own (bottle, pouch, bag sizes) is
// never an independent production action, so it never appears here even
// when it has real demand; its demand is folded into its source instead.
export interface ProductRequirement {
  product: string;
  demandQty: number;
  topUpQty: number;
  totalQty: number;
}

// windowStart/windowEnd are a rolling ~9-day capture window starting today
// (see production.ts), not a fixed calendar-week range — there's no single
// "the date" this plan is for, since demand is aggregated across the whole
// window.
export interface ProductionPlan {
  windowStart: string;
  windowEnd: string;
  demand: DemandLine[];
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
