import {
  INVENTORY_ITEMS_HEADERS,
  INVENTORY_ITEMS_SHEET,
  readRows,
  rowRange,
  SCAN_LINE_ITEMS_HEADERS,
  SCAN_LINE_ITEMS_SHEET,
  SCANS_HEADERS,
  SCANS_SHEET,
  appendRow,
  batchUpdateRows,
} from "@/lib/sheets";
import type { InventoryItem, Scan, ScanLineItem, ScanStatus, TrackingUnit } from "@/lib/types";

function toNumber(value: string): number | null {
  if (value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBoolean(value: string): boolean {
  return value.trim().toLowerCase() === "true";
}

export async function getInventoryItems(): Promise<InventoryItem[]> {
  const rows = await readRows(INVENTORY_ITEMS_SHEET, INVENTORY_ITEMS_HEADERS);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    trackingUnit: r.trackingUnit as TrackingUnit,
    unitsPerContainer: toNumber(r.unitsPerContainer),
    currentQuantity: toNumber(r.currentQuantity) ?? 0,
    reorderThreshold: toNumber(r.reorderThreshold) ?? 0,
    purchaseLocation: r.purchaseLocation,
    lastCountedAt: r.lastCountedAt || null,
  }));
}

export function isLowStock(item: Pick<InventoryItem, "currentQuantity" | "reorderThreshold">): boolean {
  return item.currentQuantity <= item.reorderThreshold;
}

export async function createScan(input: {
  id: string;
  scanDate: string;
  photoUrl: string | null;
  ocrRawJson: string;
}): Promise<void> {
  await appendRow(SCANS_SHEET, SCANS_HEADERS, {
    id: input.id,
    scanDate: input.scanDate,
    photoUrl: input.photoUrl ?? "",
    ocrRawJson: input.ocrRawJson,
    status: "draft",
    reviewedBy: "",
    reviewedAt: "",
    createdAt: new Date().toISOString(),
  });
}

export async function appendScanLineItem(item: ScanLineItem): Promise<void> {
  await appendRow(SCAN_LINE_ITEMS_SHEET, SCAN_LINE_ITEMS_HEADERS, {
    id: item.id,
    scanId: item.scanId,
    inventoryItemId: item.inventoryItemId,
    reportedQuantity: item.reportedQuantity === null ? "" : String(item.reportedQuantity),
    reportedUnit: item.reportedUnit ?? "",
    confidence: String(item.confidence),
    ambiguous: String(item.ambiguous),
    notes: item.notes ?? "",
  });
}

export async function getScanById(id: string): Promise<Scan | null> {
  const rows = await readRows(SCANS_SHEET, SCANS_HEADERS);
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  return {
    id: row.id,
    scanDate: row.scanDate,
    photoUrl: row.photoUrl || null,
    ocrRawJson: row.ocrRawJson || null,
    status: row.status as ScanStatus,
    reviewedBy: row.reviewedBy || null,
    reviewedAt: row.reviewedAt || null,
    createdAt: row.createdAt,
  };
}

export async function listScans(): Promise<Scan[]> {
  const rows = await readRows(SCANS_SHEET, SCANS_HEADERS);
  return rows
    .map((row) => ({
      id: row.id,
      scanDate: row.scanDate,
      photoUrl: row.photoUrl || null,
      ocrRawJson: row.ocrRawJson || null,
      status: row.status as ScanStatus,
      reviewedBy: row.reviewedBy || null,
      reviewedAt: row.reviewedAt || null,
      createdAt: row.createdAt,
    }))
    .sort((a, b) => b.scanDate.localeCompare(a.scanDate));
}

export async function getScanLineItems(scanId: string): Promise<ScanLineItem[]> {
  const rows = await readRows(SCAN_LINE_ITEMS_SHEET, SCAN_LINE_ITEMS_HEADERS);
  return rows
    .filter((r) => r.scanId === scanId)
    .map((r) => ({
      id: r.id,
      scanId: r.scanId,
      inventoryItemId: r.inventoryItemId,
      reportedQuantity: toNumber(r.reportedQuantity),
      reportedUnit: r.reportedUnit || null,
      confidence: toNumber(r.confidence) ?? 0,
      ambiguous: toBoolean(r.ambiguous),
      notes: r.notes || null,
    }));
}

// Applies human-corrected line item values: overwrites each scan line item row,
// writes the resulting quantity into the matching inventory item's current stock,
// and marks the scan confirmed. Low-stock status is derived at read time elsewhere,
// not stored here. All row writes go out as a single Sheets batchUpdate — doing
// this as one call per row (~2 per item) risks tripping Sheets' per-minute request
// quota on a single confirm of a ~40-item sheet.
export async function confirmScan(
  scanId: string,
  reviewedBy: string,
  corrections: Map<string, { reportedQuantity: number | null; reportedUnit: string | null; notes: string | null }>,
): Promise<void> {
  const [lineItemRows, itemRows, scanRows] = await Promise.all([
    readRows(SCAN_LINE_ITEMS_SHEET, SCAN_LINE_ITEMS_HEADERS),
    readRows(INVENTORY_ITEMS_SHEET, INVENTORY_ITEMS_HEADERS),
    readRows(SCANS_SHEET, SCANS_HEADERS),
  ]);

  const itemsById = new Map(itemRows.map((r) => [r.id, r]));
  const scanRow = scanRows.find((r) => r.id === scanId);
  if (!scanRow) throw new Error(`scan not found: ${scanId}`);

  const countedAt = new Date().toISOString();
  const updates: { range: string; values: string[] }[] = [];

  for (const row of lineItemRows) {
    if (row.scanId !== scanId) continue;
    const correction = corrections.get(row.inventoryItemId);
    if (!correction) continue;

    updates.push({
      range: rowRange(SCAN_LINE_ITEMS_SHEET, SCAN_LINE_ITEMS_HEADERS, row._rowIndex),
      values: SCAN_LINE_ITEMS_HEADERS.map((h) => {
        if (h === "reportedQuantity") {
          return correction.reportedQuantity === null ? "" : String(correction.reportedQuantity);
        }
        if (h === "reportedUnit") return correction.reportedUnit ?? "";
        if (h === "notes") return correction.notes ?? "";
        return row[h];
      }),
    });

    if (correction.reportedQuantity === null) continue;
    const itemRow = itemsById.get(row.inventoryItemId);
    if (!itemRow) {
      console.warn(
        `confirmScan: inventory item ${row.inventoryItemId} referenced by scan ${scanId} no longer exists in "${INVENTORY_ITEMS_SHEET}" — skipping its stock update.`,
      );
      continue;
    }

    updates.push({
      range: rowRange(INVENTORY_ITEMS_SHEET, INVENTORY_ITEMS_HEADERS, itemRow._rowIndex),
      values: INVENTORY_ITEMS_HEADERS.map((h) => {
        if (h === "currentQuantity") return String(correction.reportedQuantity);
        if (h === "lastCountedAt") return countedAt;
        return itemRow[h];
      }),
    });
  }

  updates.push({
    range: rowRange(SCANS_SHEET, SCANS_HEADERS, scanRow._rowIndex),
    values: SCANS_HEADERS.map((h) => {
      if (h === "status") return "confirmed";
      if (h === "reviewedBy") return reviewedBy;
      if (h === "reviewedAt") return countedAt;
      return scanRow[h];
    }),
  });

  await batchUpdateRows(updates);
}
