import { redirect } from "next/navigation";
import { getProductionStockEntities, writeReserveCountColumn } from "@/lib/production";

export async function POST(request: Request) {
  const formData = await request.formData();
  const date = String(formData.get("date") ?? "").trim();
  if (date === "") {
    return new Response("date is required", { status: 400 });
  }

  const entities = await getProductionStockEntities();
  const valuesByEntity = new Map<string, string>();
  for (const entity of entities) {
    const raw = formData.get(`amt_${entity.entity}`);
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text !== "") valuesByEntity.set(entity.entity, text);
  }

  await writeReserveCountColumn(date, valuesByEntity);

  redirect("/production");
}
