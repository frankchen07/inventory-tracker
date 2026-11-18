import {
  CATALOG_SHEET,
  CATALOG_HEADERS,
  A_ITEMS_SHEET,
  A_ITEMS_HEADERS,
  PURCHASES_SHEET,
  PURCHASES_HEADERS,
  BUY_LIST_SHEET,
  BUY_LIST_HEADERS,
  appendRows,
  readRows,
  getOrCreateDateColumn,
  readLatestValues,
  writeCells,
  writeRow,
} from "@/lib/sheets";
import { parseConversion, parseReportedQuantity, parseThresholdQuantity } from "@/lib/unit-conversion";
import { daysBetween } from "@/lib/dates";
import type {
  BuyList,
  BuyListRow,
  CatalogItem,
  MonthSpend,
  PurchaseRow,
  StaleCountItem,
} from "@/lib/types";

export async function getCatalog(): Promise<CatalogItem[]> {
  const rows = await readRows(CATALOG_SHEET, CATALOG_HEADERS);
  return rows.map((r) => ({
    item: r.item,
    category: r.category,
    supplier: r.supplier,
    unitConversion: r.unitConversion,
    threshold: r.threshold,
    rowIndex: r._rowIndex,
  }));
}

export function findCatalogItem(catalog: CatalogItem[], name: string): CatalogItem | undefined {
  const wanted = name.trim().toLowerCase();
  return catalog.find((c) => c.item.toLowerCase() === wanted);
}

export async function writeThreshold(item: CatalogItem, threshold: string): Promise<void> {
  await writeCells(CATALOG_HEADERS.indexOf("threshold"), [{ rowIndex: item.rowIndex, value: threshold }]);
}

// New items go one row past the current last item; date-column cells for
// that row start blank, i.e. "never counted".
export async function addCatalogItem(
  catalog: CatalogItem[],
  record: Omit<CatalogItem, "rowIndex">,
): Promise<number> {
  const rowIndex = Math.max(1, ...catalog.map((c) => c.rowIndex)) + 1;
  await writeRow(CATALOG_SHEET, CATALOG_HEADERS, rowIndex, record);
  return rowIndex;
}

export interface InventorySnapshot {
  catalog: CatalogItem[];
  // Latest raw display text per item (e.g. "1.75 boxes"), "" if never counted.
  counts: Map<string, string>;
  // Date of the column each item's count came from, null if never counted.
  countDates: Map<string, string | null>;
  // Every recorded count per item, oldest first.
  history: Map<string, { date: string; value: string }[]>;
  latestDate: string | null;
}

export async function getInventorySnapshot(): Promise<InventorySnapshot> {
  const [catalog, latest] = await Promise.all([
    getCatalog(),
    readLatestValues(CATALOG_SHEET, CATALOG_HEADERS.length),
  ]);
  const counts = new Map(catalog.map((c) => [c.item, latest.valueAtRow(c.rowIndex)]));
  const countDates = new Map(catalog.map((c) => [c.item, latest.dateAtRow(c.rowIndex)]));
  const history = new Map(catalog.map((c) => [c.item, latest.historyAtRow(c.rowIndex)]));
  return { catalog, counts, countDates, history, latestDate: latest.latestDate };
}

function parseMoney(raw: string): number | null {
  const n = Number(raw.replace(/[$,\s]/g, ""));
  return raw.trim() === "" || Number.isNaN(n) ? null : n;
}

// Keyed by the catalog's own spelling. Names that match no catalog item come
// back in `unknown` so a typo in the tab shows up instead of quietly
// dropping an item from the weekly count.
export async function getAItems(
  catalog: CatalogItem[],
): Promise<{ aItems: Map<string, number | null>; unknown: string[] }> {
  const rows = await readRows(A_ITEMS_SHEET, A_ITEMS_HEADERS);
  const aItems = new Map<string, number | null>();
  const unknown: string[] = [];
  for (const r of rows) {
    const match = findCatalogItem(catalog, r.item);
    if (match) aItems.set(match.item, parseMoney(r.unitCost));
    else unknown.push(r.item);
  }
  return { aItems, unknown };
}

export async function getPurchases(): Promise<PurchaseRow[]> {
  const rows = await readRows(PURCHASES_SHEET, PURCHASES_HEADERS);
  return rows.map((r) => ({ date: r.date, store: r.store, item: r.item, quantity: r.quantity, cost: parseMoney(r.cost) }));
}

export async function getBuyListRows(): Promise<BuyListRow[]> {
  const rows = await readRows(BUY_LIST_SHEET, BUY_LIST_HEADERS);
  return rows.map((r) => ({ item: r.item, added: r.added, done: r.done.trim().toUpperCase() === "TRUE", rowIndex: r._rowIndex }));
}

export async function addPurchases(rows: Record<(typeof PURCHASES_HEADERS)[number], string>[]): Promise<void> {
  await appendRows(PURCHASES_SHEET, PURCHASES_HEADERS, rows);
}

export async function addToBuyList(items: string[], date: string): Promise<void> {
  await appendRows(BUY_LIST_SHEET, BUY_LIST_HEADERS, items.map((item) => ({ item, added: date, done: "" })));
}

// Buying an item closes every open buy-list entry for it.
export async function markBought(rows: BuyListRow[]): Promise<void> {
  await writeCells(
    BUY_LIST_HEADERS.indexOf("done"),
    rows.map((r) => ({ rowIndex: r.rowIndex, value: "TRUE" })),
    BUY_LIST_SHEET,
  );
}

export const STALE_AFTER_DAYS = 7;

// Counts carry forward, so an item skipped for weeks still shows its old
// number as if current — this is what surfaces it. Never-counted items stay
// out; computeBuyList lists those separately.
export function computeStaleCounts(
  catalog: CatalogItem[],
  countDates: Map<string, string | null>,
  today: string,
): StaleCountItem[] {
  return catalog
    .flatMap((c) => {
      const lastCounted = countDates.get(c.item);
      if (!lastCounted) return [];
      const daysAgo = daysBetween(lastCounted, today);
      return daysAgo >= STALE_AFTER_DAYS ? [{ item: c.item, lastCounted, daysAgo }] : [];
    })
    .sort((a, b) => b.daysAgo - a.daysAgo);
}

// Writes a new (or updates an existing) date column. `valuesByItem` should
// only contain items actually recounted this time — every other cell is left
// as-is, so readLatestValues() carries the prior value forward at read time
// and a second entry on the same day doesn't wipe the first.
export async function writeCountColumn(
  date: string,
  valuesByItem: Map<string, string>,
  catalog: CatalogItem[],
): Promise<void> {
  const colIndex = await getOrCreateDateColumn(date);
  const cells = catalog.flatMap((c) => {
    const value = valuesByItem.get(c.item);
    return value === undefined ? [] : [{ rowIndex: c.rowIndex, value }];
  });
  await writeCells(colIndex, cells);
}

// Any count in an item's own units, as top-level packs (boxes, bottles) —
// the unit things are bought and priced in.
export function toPacks(text: string, unitConversion: string): number | null {
  const levels = parseConversion(unitConversion);
  if (levels.length === 0) return null;
  const atomic = parseReportedQuantity(text, levels);
  return atomic === null ? null : atomic / levels[0].perAtomic;
}

const sameItem = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// threshold is the par for A items: the level to buy back up to, in whole
// packs since that's how things are bought. Purchases dated on or after an
// item's last count are added to it, so logging a purchase takes the item off
// the list until the next count.
export function computeBuyList(
  catalog: CatalogItem[],
  counts: Map<string, string>,
  countDates: Map<string, string | null>,
  aItems: Map<string, number | null>,
  buyListRows: BuyListRow[],
  purchases: PurchaseRow[],
): BuyList {
  const list: BuyList = { toBuy: [], handAdded: [], notCounted: [], needsReview: [] };

  for (const c of catalog) {
    if (!aItems.has(c.item)) continue;
    const countText = counts.get(c.item) ?? "";
    const countDate = countDates.get(c.item);
    if (countText === "" || !countDate) {
      list.notCounted.push(c.item);
      continue;
    }
    const levels = parseConversion(c.unitConversion);
    const counted = parseReportedQuantity(countText, levels);
    if (counted === null) {
      list.needsReview.push({ item: c.item, problem: `can't read the count "${countText}"` });
      continue;
    }
    const since = purchases.filter((p) => sameItem(p.item, c.item) && p.date >= countDate);
    const boughtAtomic = since.map((p) => parseReportedQuantity(p.quantity, levels));
    if (boughtAtomic.includes(null)) {
      list.needsReview.push({ item: c.item, problem: "can't read a purchase quantity since the last count" });
      continue;
    }
    if (c.threshold.trim() === "") {
      list.needsReview.push({ item: c.item, problem: "no par set (threshold column)" });
      continue;
    }
    const par = parseThresholdQuantity(c.threshold, levels);
    if (par === null) {
      list.needsReview.push({ item: c.item, problem: `can't read the par "${c.threshold}"` });
      continue;
    }
    const bought = (boughtAtomic as number[]).reduce((a, b) => a + b, 0);
    const onHand = counted + bought;
    // Float dust from fractional packs must not round up to an extra pack.
    const buy = Math.ceil((par - onHand) / levels[0].perAtomic - 1e-9);
    if (buy > 0) {
      list.toBuy.push({
        item: c.item,
        supplier: c.supplier,
        onHand: countText,
        boughtSince: bought / levels[0].perAtomic,
        buy,
        unit: levels[0].unit,
      });
    }
  }

  const listed = new Set([...aItems.keys()].map((i) => i.toLowerCase()));
  for (const row of buyListRows) {
    if (row.done) continue;
    const match = findCatalogItem(catalog, row.item);
    const name = match?.item ?? row.item.trim();
    // A items are already handled by their count; repeats show once.
    if (listed.has(name.toLowerCase())) continue;
    listed.add(name.toLowerCase());
    list.handAdded.push({ item: name, supplier: match?.supplier ?? "" });
  }
  return list;
}

// Lines already logged with the same date, store, item and quantity are
// skipped as likely retries unless allowDuplicate. Buy-list rows close for
// every bought item, skipped ones included, so a retry after a failed close
// still finishes it. `lines` must already be resolved to catalog names.
export function planPurchase(
  catalog: CatalogItem[],
  existing: PurchaseRow[],
  buyListRows: BuyListRow[],
  lines: { item: string; quantity: string; cost?: number }[],
  date: string,
  store: string,
  allowDuplicate: boolean,
) {
  const storeName = store.trim();
  const isRepeat = (item: string, quantity: string) =>
    existing.some(
      (p) =>
        p.date === date &&
        p.store.trim().toLowerCase() === storeName.toLowerCase() &&
        p.item === item &&
        p.quantity.trim() === quantity,
    );
  const skippedAsRepeat = allowDuplicate ? [] : lines.filter((l) => isRepeat(l.item, l.quantity)).map((l) => l.item);
  const rows = lines
    .filter((l) => !skippedAsRepeat.includes(l.item))
    .map((l) => ({
      date,
      store: storeName,
      item: l.item,
      quantity: l.quantity,
      cost: l.cost === undefined ? "" : String(l.cost),
      notes: "",
    }));
  const bought = new Set(lines.map((l) => l.item));
  const close = buyListRows.filter((r) => !r.done && bought.has(findCatalogItem(catalog, r.item)?.item ?? r.item));
  return { rows, skippedAsRepeat, close };
}

export async function loadBuyList() {
  const [snapshot, buyListRows, purchases] = await Promise.all([getInventorySnapshot(), getBuyListRows(), getPurchases()]);
  const { aItems, unknown } = await getAItems(snapshot.catalog);
  const list = computeBuyList(snapshot.catalog, snapshot.counts, snapshot.countDates, aItems, buyListRows, purchases);
  return { ...snapshot, aItems, unknownAItems: unknown, list };
}

// The calendar month's receipts: each line at its receipt cost, else packs x
// the item's unitCost, else counted as unpriced. Shelf value is each A item's
// last count in or before the month, at unitCost.
export function computeMonthSpend(
  catalog: CatalogItem[],
  aItems: Map<string, number | null>,
  purchases: PurchaseRow[],
  history: Map<string, { date: string; value: string }[]>,
  month: string,
): MonthSpend {
  const result: MonthSpend = {
    spend: 0,
    runs: 0,
    unpricedPurchases: 0,
    byStore: [],
    byItem: [],
    shelf: { date: null, value: 0, unpricedItems: [] },
  };
  const stores = new Map<string, { store: string; spend: number; unpriced: number }>();
  const items = new Map<string, { item: string; spend: number; unpriced: number }>();
  const runs = new Set<string>();

  for (const p of purchases) {
    if (!p.date.startsWith(month)) continue;
    const storeKey = p.store.trim().toLowerCase();
    runs.add(`${p.date}|${storeKey}`);
    const match = findCatalogItem(catalog, p.item);
    const name = match?.item ?? p.item.trim();
    const store = stores.get(storeKey) ?? { store: p.store.trim(), spend: 0, unpriced: 0 };
    const line = items.get(name) ?? { item: name, spend: 0, unpriced: 0 };
    stores.set(storeKey, store);
    items.set(name, line);

    let value = p.cost;
    if (value === null && match) {
      const unitCost = aItems.get(match.item) ?? null;
      const packs = toPacks(p.quantity, match.unitConversion);
      if (unitCost !== null && packs !== null) value = packs * unitCost;
    }
    if (value === null) {
      result.unpricedPurchases++;
      store.unpriced++;
      line.unpriced++;
    } else {
      result.spend += value;
      store.spend += value;
      line.spend += value;
    }
  }
  result.runs = runs.size;
  result.byStore = [...stores.values()].sort((a, b) => b.spend - a.spend);
  result.byItem = [...items.values()].sort((a, b) => b.spend - a.spend);

  for (const c of catalog) {
    if (!aItems.has(c.item)) continue;
    const last = (history.get(c.item) ?? []).filter((h) => h.date.slice(0, 7) <= month).at(-1);
    if (!last) continue;
    if (!result.shelf.date || last.date > result.shelf.date) result.shelf.date = last.date;
    const unitCost = aItems.get(c.item) ?? null;
    const packs = toPacks(last.value, c.unitConversion);
    if (unitCost === null || packs === null) result.shelf.unpricedItems.push(c.item);
    else result.shelf.value += packs * unitCost;
  }
  return result;
}
