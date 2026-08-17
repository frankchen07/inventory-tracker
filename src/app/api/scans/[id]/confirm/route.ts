import { redirect } from "next/navigation";
import { getScanDraft } from "@/lib/blob-storage";
import { recordScanPhoto, writeCountColumn } from "@/lib/inventory";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: draftId } = await params;
  const formData = await request.formData();

  const draft = await getScanDraft(draftId);
  if (!draft) {
    return new Response("scan draft not found", { status: 404 });
  }

  const valuesByItem = new Map<string, string>();
  for (const line of draft.lineItems) {
    const raw = formData.get(`quantity_${line.item}`);
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text !== "") valuesByItem.set(line.item, text);
  }

  await writeCountColumn(draft.scanDate, valuesByItem);
  await recordScanPhoto(draft.scanDate, draft.photoUrl);

  redirect("/");
}
