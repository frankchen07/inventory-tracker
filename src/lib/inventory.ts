import {
  CATALOG_SHEET,
  CATALOG_HEADERS,
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
import type {
  BuyList,
  BuyListRow,
  CatalogItem,
  MonthSpend,
  PurchaseRow,
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

const sameItem = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// threshold is the running-low line: an item shows when its last count plus
// anything bought on or after that count's day is under it. Items with no
// count or no threshold just don't show, since not everything gets counted.
export function computeBuyList(
  catalog: CatalogItem[],
  counts: Map<string, string>,
  countDates: Map<string, string | null>,
  buyListRows: BuyListRow[],
  purchases: PurchaseRow[],
): BuyList {
  const list: BuyList = { low: [], handAdded: [], needsReview: [] };

  for (const c of catalog) {
    const countText = counts.get(c.item) ?? "";
    const countDate = countDates.get(c.item);
    if (countText === "" || !countDate || c.threshold.trim() === "") continue;
    const levels = parseConversion(c.unitConversion);
    const counted = parseReportedQuantity(countText, levels);
    if (counted === null) {
      list.needsReview.push({ item: c.item, problem: `can't read the count "${countText}"` });
      continue;
    }
    const threshold = parseThresholdQuantity(c.threshold, levels);
    if (threshold === null) {
      list.needsReview.push({ item: c.item, problem: `can't read the threshold "${c.threshold}"` });
      continue;
    }
    const since = purchases.filter((p) => sameItem(p.item, c.item) && p.date >= countDate);
    const bought = since.map((p) => parseReportedQuantity(p.quantity, levels));
    if (bought.includes(null)) {
      list.needsReview.push({ item: c.item, problem: "can't read a purchase quantity since the last count" });
      continue;
    }
    const onHand = counted + (bought as number[]).reduce((a, b) => a + b, 0);
    if (onHand < threshold) {
      list.low.push({ item: c.item, supplier: c.supplier, countText, countDate, boughtSince: since.map((p) => p.quantity.trim()) });
    }
  }

  // Items already showing as low aren't repeated; repeats of a name show once.
  const listed = new Set(list.low.map((l) => l.item.toLowerCase()));
  for (const row of buyListRows) {
    if (row.done) continue;
    const match = findCatalogItem(catalog, row.item);
    const name = match?.item ?? row.item.trim();
    if (listed.has(name.toLowerCase())) continue;
    listed.add(name.toLowerCase());
    list.handAdded.push({ item: name, supplier: match?.supplier ?? "", added: row.added, inCatalog: match !== undefined });
  }
  return list;
}

// Lines already logged with the same date, store, item and quantity are
// skipped as likely retries unless allowDuplicate. Buy-list rows close for
// every bought item, skipped ones included, so a retry after a failed close
// still finishes it. Catalog items in `lines` must already use the catalog's
// spelling; anything else is matched to buy-list rows ignoring case.
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
  const key = (name: string) => name.trim().toLowerCase();
  const bought = new Set(lines.map((l) => key(l.item)));
  const close = buyListRows.filter((r) => !r.done && bought.has(key(findCatalogItem(catalog, r.item)?.item ?? r.item)));
  return { rows, skippedAsRepeat, close };
}

export async function loadBuyList() {
  const [snapshot, buyListRows, purchases] = await Promise.all([getInventorySnapshot(), getBuyListRows(), getPurchases()]);
  const list = computeBuyList(snapshot.catalog, snapshot.counts, snapshot.countDates, buyListRows, purchases);
  return { ...snapshot, list };
}

// The calendar month's receipts. Lines with no cost entered are counted as
// unpriced, not guessed.
export function computeMonthSpend(catalog: CatalogItem[], purchases: PurchaseRow[], month: string): MonthSpend {
  const result: MonthSpend = { spend: 0, runs: 0, unpricedPurchases: 0, byStore: [], byItem: [] };
  const stores = new Map<string, { store: string; spend: number; unpriced: number }>();
  const items = new Map<string, { item: string; spend: number; unpriced: number }>();
  const runs = new Set<string>();

  for (const p of purchases) {
    if (!p.date.startsWith(month)) continue;
    const storeKey = p.store.trim().toLowerCase();
    runs.add(`${p.date}|${storeKey}`);
    const name = findCatalogItem(catalog, p.item)?.item ?? p.item.trim();
    const store = stores.get(storeKey) ?? { store: p.store.trim(), spend: 0, unpriced: 0 };
    const line = items.get(name.toLowerCase()) ?? { item: name, spend: 0, unpriced: 0 };
    stores.set(storeKey, store);
    items.set(name.toLowerCase(), line);

    if (p.cost === null) {
      result.unpricedPurchases++;
      store.unpriced++;
      line.unpriced++;
    } else {
      result.spend += p.cost;
      store.spend += p.cost;
      line.spend += p.cost;
    }
  }
  result.runs = runs.size;
  result.byStore = [...stores.values()].sort((a, b) => b.spend - a.spend);
  result.byItem = [...items.values()].sort((a, b) => b.spend - a.spend);
  return result;
}
