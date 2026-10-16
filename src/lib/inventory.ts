import {
  CATALOG_SHEET,
  CATALOG_HEADERS,
  SCAN_PHOTOS_SHEET,
  SCAN_PHOTOS_HEADERS,
  readRows,
  appendRow,
  ensureSheetWithHeaders,
  getOrCreateDateColumn,
  readLatestValues,
  writeCells,
  writeRow,
} from "@/lib/sheets";
import { parseConversion, parseReportedQuantity, parseThresholdQuantity } from "@/lib/unit-conversion";
import type { CatalogItem, NeedsReviewItem, RestockItem } from "@/lib/types";

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
  latestDate: string | null;
}

export async function getInventorySnapshot(): Promise<InventorySnapshot> {
  const [catalog, latest] = await Promise.all([
    getCatalog(),
    readLatestValues(CATALOG_SHEET, CATALOG_HEADERS.length),
  ]);
  const counts = new Map(catalog.map((c) => [c.item, latest.valueAtRow(c.rowIndex)]));
  return { catalog, counts, latestDate: latest.latestDate };
}

export interface RestockResult {
  lowStock: RestockItem[];
  needsReview: NeedsReviewItem[];
}

// Items below threshold, plus a separate bucket for items that have a
// recorded count but couldn't be converted to a number (e.g. a bare "6"
// with no unit) — silently skipping those would be worse than a false
// alarm. Items with no count at all yet (never counted) stay out of both
// lists — that's a different, expected state.
export function computeRestockList(catalog: CatalogItem[], counts: Map<string, string>): RestockResult {
  const lowStock: RestockItem[] = [];
  const needsReview: NeedsReviewItem[] = [];

  for (const item of catalog) {
    const countText = counts.get(item.item) ?? "";
    if (countText === "") continue;

    const levels = parseConversion(item.unitConversion);
    const remainingAtomic = parseReportedQuantity(countText, levels);
    const thresholdAtomic = parseThresholdQuantity(item.threshold, levels);

    if (remainingAtomic === null || thresholdAtomic === null) {
      needsReview.push({ item: item.item, supplier: item.supplier, countText });
      continue;
    }

    if (remainingAtomic < thresholdAtomic) {
      lowStock.push({ item: item.item, supplier: item.supplier, remaining: countText });
    }
  }

  return { lowStock, needsReview };
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

export async function recordScanPhoto(date: string, photoUrl: string): Promise<void> {
  await ensureSheetWithHeaders(SCAN_PHOTOS_SHEET, SCAN_PHOTOS_HEADERS);
  await appendRow(SCAN_PHOTOS_SHEET, SCAN_PHOTOS_HEADERS, { date, photoUrl });
}
