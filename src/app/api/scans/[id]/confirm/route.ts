import { redirect } from "next/navigation";
import { confirmScan, getScanLineItems } from "@/lib/inventory";

function parseFloatOrNull(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseStringOrNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const formData = await request.formData();
  const reviewedBy = formData.get("reviewedBy");

  if (typeof reviewedBy !== "string" || reviewedBy.trim() === "") {
    return new Response("reviewedBy is required", { status: 400 });
  }

  const lineItems = await getScanLineItems(id);
  if (lineItems.length === 0) {
    return new Response("scan not found", { status: 404 });
  }

  const corrections = new Map(
    lineItems.map((item) => [
      item.inventoryItemId,
      {
        reportedQuantity: parseFloatOrNull(formData.get(`reportedQuantity_${item.inventoryItemId}`)),
        reportedUnit: parseStringOrNull(formData.get(`reportedUnit_${item.inventoryItemId}`)),
        notes: parseStringOrNull(formData.get(`notes_${item.inventoryItemId}`)),
      },
    ]),
  );

  await confirmScan(id, reviewedBy.trim(), corrections);

  redirect("/");
}
