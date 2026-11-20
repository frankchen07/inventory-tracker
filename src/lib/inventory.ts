import {
  CATALOG_SHEET,
  PURCHASES_SHEET,
  PURCHASES_HEADERS,
  BUY_LIST_SHEET,
  BUY_LIST_HEADERS,
  appendRows,
  readRows,
  getOrCreateDateColumn,
  mergeDateColumns,
  readGrid,
  readHeaderRow,
  writeCells,
  writeRow,
} from "@/lib/sheets";
import type { LatestValues } from "@/lib/sheets";
import { parseConversion, parseReportedQuantity, parseThresholdQuantity } from "@/lib/unit-conversion";
import type {
  BuyList,
  BuyListRow,
  CatalogItem,
  MonthSpend,
  PurchaseRow,
} from "@/lib/types";

const CATALOG_FIELDS = ["item", "location", "category", "supplier", "unitConversion", "threshold"] as const;
type CatalogField = (typeof CATALOG_FIELDS)[number];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Header text to column index, ignoring case and spaces ("unit conversion"
// is unitConversion). Columns the app doesn't know are left alone.
export function catalogColumns(headerRow: unknown[]): Partial<Record<CatalogField, number>> {
  const cols: Partial<Record<CatalogField, number>> = {};
  headerRow.forEach((header, i) => {
    const key = String(header ?? "").replace(/\s+/g, "").toLowerCase();
    const field = CATALOG_FIELDS.find((f) => f.toLowerCase() === key);
    if (field && cols[field] === undefined) cols[field] = i;
  });
  return cols;
}

// Reads "inventory" by header name: catalog fields wherever they sit, and
// every YYYY-MM-DD header as a count column. rowIndex is the real sheet row,
// which is what lines an item up with its counts.
export function parseInventoryGrid(grid: unknown[][]): { catalog: CatalogItem[]; latest: LatestValues } {
  const [headerRow = [], ...rows] = grid;
  const cols = catalogColumns(headerRow);
  if (cols.item === undefined) throw new Error(`The inventory tab has no "item" header.`);
  const cell = (row: unknown[] | undefined, field: CatalogField) => {
    const i = cols[field];
    return i === undefined ? "" : String(row?.[i] ?? "");
  };

  const catalog = rows.flatMap((row, r) =>
    cell(row, "item").trim() === ""
      ? []
      : [
          {
            item: cell(row, "item"),
            location: cell(row, "location"),
            category: cell(row, "category"),
            supplier: cell(row, "supplier"),
            unitConversion: cell(row, "unitConversion"),
            threshold: cell(row, "threshold"),
            rowIndex: r + 2,
          },
        ],
  );
  const dateCols = headerRow.flatMap((h, i) => (ISO_DATE.test(String(h ?? "").trim()) ? [i] : []));
  const latest = mergeDateColumns([dateCols.map((i) => headerRow[i]), ...rows.map((row) => dateCols.map((i) => row?.[i] ?? ""))]);
  return { catalog, latest };
}

export async function getCatalog(): Promise<CatalogItem[]> {
  return parseInventoryGrid(await readGrid(CATALOG_SHEET)).catalog;
}

export function findCatalogItem(catalog: CatalogItem[], name: string): CatalogItem | undefined {
  const wanted = name.trim().toLowerCase();
  return catalog.find((c) => c.item.toLowerCase() === wanted);
}

export async function writeThreshold(item: CatalogItem, threshold: string): Promise<void> {
  const col = catalogColumns(await readHeaderRow(CATALOG_SHEET)).threshold;
  if (col === undefined) throw new Error(`The inventory tab has no "threshold" header.`);
  await writeCells(col, [{ rowIndex: item.rowIndex, value: threshold }]);
}

// New items go one row past the current last item; date-column cells for
// that row start blank, i.e. "never counted".
export async function addCatalogItem(
  catalog: CatalogItem[],
  record: Omit<CatalogItem, "rowIndex">,
): Promise<number> {
  const rowIndex = Math.max(1, ...catalog.map((c) => c.rowIndex)) + 1;
  // Lay the record out under each field's header; other columns stay blank.
  const cols = catalogColumns(await readHeaderRow(CATALOG_SHEET));
  const last = Math.max(...Object.values(cols));
  const headers = Array.from({ length: last + 1 }, (_, i) => CATALOG_FIELDS.find((f) => cols[f] === i) ?? "");
  await writeRow(CATALOG_SHEET, headers, rowIndex, record as Record<string, string>);
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
  const { catalog, latest } = parseInventoryGrid(await readGrid(CATALOG_SHEET));
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
  return rows.map((r) => ({ item: r.item, store: r.store, added: r.added, done: r.done.trim().toUpperCase() === "TRUE", rowIndex: r._rowIndex }));
}

export async function addPurchases(rows: Record<(typeof PURCHASES_HEADERS)[number], string>[]): Promise<void> {
  await appendRows(PURCHASES_SHEET, PURCHASES_HEADERS, rows);
}

export async function addToBuyList(items: string[], date: string, store: string): Promise<void> {
  await appendRows(BUY_LIST_SHEET, BUY_LIST_HEADERS, items.map((item) => ({ item, added: date, done: "", store })));
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

// threshold is the running-low line: an item shows when its last count is
// under it, until the next count. Purchases dated on or after that count's day
// are listed with it so nobody buys it twice; they don't change the count,
// since the next count picks them up. Items with no count or no threshold
// just don't show, since not everything gets counted.
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
    if (counted < threshold) {
      const boughtSince = purchases
        .filter((p) => sameItem(p.item, c.item) && p.date >= countDate)
        .map((p) => ({ date: p.date, quantity: p.quantity.trim() }));
      list.low.push({ item: c.item, supplier: c.supplier, countText, countDate, boughtSince });
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
    list.handAdded.push({ item: name, supplier: row.store.trim() || (match?.supplier ?? ""), added: row.added, inCatalog: match !== undefined });
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
// unpriced, not guessed. Lines are taken in date order, so each item's
// quantities read in the order they were bought.
export function computeMonthSpend(catalog: CatalogItem[], purchases: PurchaseRow[], month: string): MonthSpend {
  const result: MonthSpend = { spend: 0, runs: 0, unpricedPurchases: 0, byStore: [], byItem: [] };
  const stores = new Map<string, { store: string; spend: number; unpriced: number; lines: number; days: Set<string> }>();
  const items = new Map<string, { item: string; spend: number; unpriced: number; quantities: string[] }>();
  const runs = new Set<string>();

  const inMonth = purchases.filter((p) => p.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));
  for (const p of inMonth) {
    const storeKey = p.store.trim().toLowerCase();
    runs.add(`${p.date}|${storeKey}`);
    const name = findCatalogItem(catalog, p.item)?.item ?? p.item.trim();
    const store = stores.get(storeKey) ?? { store: p.store.trim(), spend: 0, unpriced: 0, lines: 0, days: new Set<string>() };
    const line = items.get(name.toLowerCase()) ?? { item: name, spend: 0, unpriced: 0, quantities: [] };
    stores.set(storeKey, store);
    items.set(name.toLowerCase(), line);
    store.days.add(p.date);
    store.lines++;
    line.quantities.push(p.quantity.trim());

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
  result.byStore = [...stores.values()]
    .map(({ days, ...s }) => ({ ...s, runs: days.size }))
    .sort((a, b) => b.spend - a.spend);
  // Highest spend first; items with no priced line at all go last.
  const unpricedOnly = (i: { unpriced: number; quantities: string[] }) => (i.unpriced === i.quantities.length ? 1 : 0);
  result.byItem = [...items.values()].sort((a, b) => b.spend - a.spend || unpricedOnly(a) - unpricedOnly(b));
  return result;
}
