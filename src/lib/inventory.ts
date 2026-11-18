import {
  CATALOG_SHEET,
  CATALOG_HEADERS,
  A_ITEMS_SHEET,
  A_ITEMS_HEADERS,
  PURCHASES_SHEET,
  PURCHASES_HEADERS,
  WASTE_SHEET,
  WASTE_HEADERS,
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
  MonthLine,
  MonthSummary,
  PurchaseRow,
  StaleCountItem,
  WasteRow,
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

export async function getWaste(): Promise<WasteRow[]> {
  const rows = await readRows(WASTE_SHEET, WASTE_HEADERS);
  return rows.map((r) => ({ date: r.date, item: r.item, quantity: r.quantity, reason: r.reason }));
}

export async function getBuyListRows(): Promise<BuyListRow[]> {
  const rows = await readRows(BUY_LIST_SHEET, BUY_LIST_HEADERS);
  return rows.map((r) => ({ item: r.item, added: r.added, done: r.done.trim().toUpperCase() === "TRUE", rowIndex: r._rowIndex }));
}

export async function addPurchases(rows: Record<(typeof PURCHASES_HEADERS)[number], string>[]): Promise<void> {
  await appendRows(PURCHASES_SHEET, PURCHASES_HEADERS, rows);
}

export async function addWaste(rows: Record<(typeof WASTE_HEADERS)[number], string>[]): Promise<void> {
  await appendRows(WASTE_SHEET, WASTE_HEADERS, rows);
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
// packs since that's how things are bought. Purchases dated after an item's
// last count are added to it, so a run made since the count doesn't get
// bought twice. Counts are taken after service, so a purchase dated the same
// day as the count is already in it (same rule as orders in production.ts).
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
    const since = purchases.filter((p) => sameItem(p.item, c.item) && p.date > countDate);
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

// Usage between the month's boundary counts: the last count before the month
// and the last one in it. Purchases and waste count only if dated after the
// first and on or before the second — a buy after the last count lands in the
// next period, and one on a count's own day is already in that count.
export function computeMonth(
  catalog: CatalogItem[],
  history: Map<string, { date: string; value: string }[]>,
  aItems: Map<string, number | null>,
  purchases: PurchaseRow[],
  waste: WasteRow[],
  month: string,
): MonthSummary {
  const monthStart = `${month}-01`;
  const summary: MonthSummary = {
    lines: [],
    incomplete: [],
    usedCost: 0,
    shelfCost: 0,
    wasteCost: 0,
    unpricedItems: [],
    spend: 0,
    unpricedPurchases: 0,
    runs: 0,
  };

  for (const c of catalog) {
    if (!aItems.has(c.item)) continue;
    const counts = history.get(c.item) ?? [];
    const startCount = counts.filter((h) => h.date < monthStart).at(-1);
    const endCount = counts.filter((h) => h.date.startsWith(month)).at(-1);
    if (!startCount) {
      summary.incomplete.push({ item: c.item, reason: `no count before ${month}` });
      continue;
    }
    if (!endCount) {
      summary.incomplete.push({ item: c.item, reason: `not counted yet in ${month}` });
      continue;
    }

    const between = (date: string) => date > startCount.date && date <= endCount.date;
    const sumPacks = (rows: { item: string; date: string; quantity: string }[]) =>
      rows
        .filter((r) => sameItem(r.item, c.item) && between(r.date))
        .reduce<number | null>((sum, r) => {
          const packs = toPacks(r.quantity, c.unitConversion);
          return sum === null || packs === null ? null : sum + packs;
        }, 0);

    const start = toPacks(startCount.value, c.unitConversion);
    const end = toPacks(endCount.value, c.unitConversion);
    const bought = sumPacks(purchases);
    const wasted = sumPacks(waste);
    if (start === null || end === null || bought === null || wasted === null) {
      summary.incomplete.push({ item: c.item, reason: "a count, purchase, or waste quantity can't be read" });
      continue;
    }

    const used = start + bought - end;
    if (used < -1e-9) {
      summary.incomplete.push({ item: c.item, reason: "used came out negative, so a purchase probably wasn't logged" });
      continue;
    }
    const unitCost = aItems.get(c.item) ?? null;
    const line: MonthLine = {
      item: c.item,
      unit: parseConversion(c.unitConversion)[0].unit,
      start,
      bought,
      wasted,
      end,
      used,
      usedCost: unitCost === null ? null : used * unitCost,
    };
    summary.lines.push(line);
    if (unitCost === null) {
      summary.unpricedItems.push(c.item);
    } else {
      summary.usedCost += used * unitCost;
      summary.shelfCost += end * unitCost;
      summary.wasteCost += wasted * unitCost;
    }
  }

  const runs = new Set<string>();
  for (const p of purchases) {
    if (!p.date.startsWith(month)) continue;
    runs.add(`${p.date}|${p.store.trim().toLowerCase()}`);
    if (p.cost !== null) {
      summary.spend += p.cost;
      continue;
    }
    const match = findCatalogItem(catalog, p.item);
    const unitCost = match ? aItems.get(match.item) ?? null : null;
    const packs = match ? toPacks(p.quantity, match.unitConversion) : null;
    if (unitCost === null || packs === null) summary.unpricedPurchases++;
    else summary.spend += packs * unitCost;
  }
  summary.runs = runs.size;
  return summary;
}
