import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { uploadScanPhoto } from "@/lib/blob-storage";
import { appendScanLineItem, createScan, getInventoryItems } from "@/lib/inventory";
import { extractInventoryFromPhoto, type InventoryItemRef } from "@/lib/vision-ocr";

const ALLOWED_MEDIA_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(request: Request) {
  const formData = await request.formData();
  const scanDate = formData.get("scanDate");
  const photo = formData.get("photo");

  if (typeof scanDate !== "string" || !scanDate) {
    return NextResponse.json({ error: "scanDate is required" }, { status: 400 });
  }
  if (!(photo instanceof File)) {
    return NextResponse.json({ error: "photo is required" }, { status: 400 });
  }
  const ext = ALLOWED_MEDIA_TYPES[photo.type];
  if (!ext) {
    return NextResponse.json({ error: `unsupported image type: ${photo.type}` }, { status: 400 });
  }

  const bytes = Buffer.from(await photo.arrayBuffer());

  const inventoryItems = await getInventoryItems();
  const itemRefs: InventoryItemRef[] = inventoryItems.map((item) => ({
    inventoryItemId: item.id,
    name: item.name,
    trackingUnit: item.trackingUnit,
  }));

  const { lineItems, rawResponse } = await extractInventoryFromPhoto(
    bytes.toString("base64"),
    photo.type as "image/jpeg" | "image/png" | "image/webp",
    itemRefs,
  );

  const photoUrl = await uploadScanPhoto(`${scanDate}-${Date.now()}.${ext}`, bytes, photo.type);

  const scanId = randomUUID();
  await createScan({
    id: scanId,
    scanDate,
    photoUrl,
    ocrRawJson: JSON.stringify(rawResponse),
  });

  for (const item of lineItems) {
    await appendScanLineItem({
      id: randomUUID(),
      scanId,
      inventoryItemId: item.inventoryItemId,
      reportedQuantity: item.reportedQuantity,
      reportedUnit: item.reportedUnit,
      confidence: item.confidence,
      ambiguous: item.ambiguous,
      notes: item.notes,
    });
  }

  return NextResponse.json({ scanId });
}
