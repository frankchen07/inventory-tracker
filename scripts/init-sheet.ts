import { randomUUID } from "crypto";
import {
  INVENTORY_ITEMS_HEADERS,
  INVENTORY_ITEMS_SHEET,
  SCAN_LINE_ITEMS_HEADERS,
  SCAN_LINE_ITEMS_SHEET,
  SCANS_HEADERS,
  SCANS_SHEET,
  appendRow,
  ensureSheetWithHeaders,
  readRows,
} from "../src/lib/sheets";
import { REFERENCE_ITEMS } from "../src/lib/reference-items";

async function main() {
  await ensureSheetWithHeaders(INVENTORY_ITEMS_SHEET, INVENTORY_ITEMS_HEADERS);
  await ensureSheetWithHeaders(SCANS_SHEET, SCANS_HEADERS);
  await ensureSheetWithHeaders(SCAN_LINE_ITEMS_SHEET, SCAN_LINE_ITEMS_HEADERS);

  const existing = await readRows(INVENTORY_ITEMS_SHEET, INVENTORY_ITEMS_HEADERS);
  if (existing.length > 0) {
    console.log(`"${INVENTORY_ITEMS_SHEET}" already has ${existing.length} rows — skipping seed.`);
    return;
  }

  for (const item of REFERENCE_ITEMS) {
    await appendRow(INVENTORY_ITEMS_SHEET, INVENTORY_ITEMS_HEADERS, {
      id: randomUUID(),
      name: item.name,
      category: item.category,
      trackingUnit: item.trackingUnit,
      unitsPerContainer: item.unitsPerContainer === null ? "" : String(item.unitsPerContainer),
      currentQuantity: "0",
      reorderThreshold: String(item.reorderThreshold),
      purchaseLocation: item.purchaseLocation,
      lastCountedAt: "",
    });
  }

  console.log(`Seeded ${REFERENCE_ITEMS.length} placeholder items into "${INVENTORY_ITEMS_SHEET}".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
