import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { uploadScanDraft, uploadScanPhoto } from "@/lib/blob-storage";
import { getCatalog } from "@/lib/inventory";
import { extractInventoryFromPhoto } from "@/lib/vision-ocr";

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

  const catalog = await getCatalog();

  const { lineItems } = await extractInventoryFromPhoto(
    bytes.toString("base64"),
    photo.type as "image/jpeg" | "image/png" | "image/webp",
    catalog,
  );

  const photoUrl = await uploadScanPhoto(`${scanDate}-${Date.now()}.${ext}`, bytes, photo.type);

  const draftId = randomUUID();
  await uploadScanDraft({
    id: draftId,
    scanDate,
    photoUrl,
    lineItems,
  });

  return NextResponse.json({ draftId });
}
