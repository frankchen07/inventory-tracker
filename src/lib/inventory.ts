import {
  CATALOG_SHEET,
  CATALOG_HEADERS,
  SCAN_PHOTOS_SHEET,
  SCAN_PHOTOS_HEADERS,
  readRows,
  appendRow,
  ensureSheetWithHeaders,
  getOrCreateDateColumn,
  listDateColumns,
  readColumnValues,
  writeColumnValues,
} from "@/lib/sheets";
import { parseConversion, parseReportedQuantity, parseThreshold } from "@/lib/unit-conversion";
import type { CatalogItem, NeedsReviewItem, RestockItem } from "@/lib/types";

export async function getCatalog(): Promise<CatalogItem[]> {
  const rows = await readRows(CATALOG_SHEET, CATALOG_HEADERS);
  return rows.map((r) => ({
    item: r.item,
    category: r.category,
    supplier: r.supplier,
    unitConversion: r.unitConversion,
    threshold: r.threshold,
  }));
}

// Merges every date column left-to-right so a blank cell always resolves to
// the nearest earlier non-blank value for that item. This is the one place
// "untouched item = no change" gets applied — neither entry path writes
// carried-forward values into the sheet itself, so a blank cell always means
// "not recounted this time," not "assumed unchanged." Returns raw display
// text per item (e.g. "1.75 boxes", "8 sleeves").
export async function getLatestCounts(): Promise<Map<string, string>> {
  const catalog = await getCatalog();
  const cols = await listDateColumns();
  const sorted = [...cols].sort((a, b) => a.date.localeCompare(b.date));

  const result = new Map<string, string>(catalog.map((c) => [c.item, ""]));
  for (const col of sorted) {
    const values = await readColumnValues(col.colIndex, catalog.length);
    catalog.forEach((c, i) => {
      const v = values[i];
      if (v !== "") result.set(c.item, v);
    });
  }
  return result;
}

export interface RestockResult {
  lowStock: RestockItem[];
  needsReview: NeedsReviewItem[];
}

// Items below threshold, plus a separate bucket for items that have a
// recorded count but couldn't be converted to a number (e.g. a bare "6"
// with no unit). Those used to be silently skipped, which is worse than a
// false alarm — they'd just vanish from the list with no signal anything
// was wrong. Items with no count at all yet (never counted) stay out of
// both lists — that's a different, expected state.
export async function computeRestockList(): Promise<RestockResult> {
  const catalog = await getCatalog();
  const counts = await getLatestCounts();
  const lowStock: RestockItem[] = [];
  const needsReview: NeedsReviewItem[] = [];

  for (const item of catalog) {
    const countText = counts.get(item.item) ?? "";
    if (countText === "") continue;

    const levels = parseConversion(item.unitConversion);
    const remainingAtomic = parseReportedQuantity(countText, levels);
    const thresholdAtomic = parseThreshold(item.threshold);

    if (remainingAtomic === null || thresholdAtomic === null) {
      needsReview.push({ item: item.item, supplier: item.supplier, countText });
      continue;
    }

    if (remainingAtomic < thresholdAtomic) {
      lowStock.push({
        item: item.item,
        supplier: item.supplier,
        remaining: countText,
        remainingAtomic,
        thresholdAtomic,
      });
    }
  }

  return { lowStock, needsReview };
}

// Writes a new (or updates an existing) date column. `valuesByItem` should
// only contain items actually recounted this time — everything else is left
// blank so getLatestCounts() carries the prior value forward at read time.
export async function writeCountColumn(date: string, valuesByItem: Map<string, string>): Promise<void> {
  const catalog = await getCatalog();
  const colIndex = await getOrCreateDateColumn(date);
  const values = catalog.map((c) => valuesByItem.get(c.item) ?? "");
  await writeColumnValues(colIndex, values);
}

export async function recordScanPhoto(date: string, photoUrl: string): Promise<void> {
  await ensureSheetWithHeaders(SCAN_PHOTOS_SHEET, SCAN_PHOTOS_HEADERS);
  await appendRow(SCAN_PHOTOS_SHEET, SCAN_PHOTOS_HEADERS, { date, photoUrl });
}
