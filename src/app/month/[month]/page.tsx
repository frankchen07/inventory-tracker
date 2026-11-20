import { redirect } from "next/navigation";
import { MonthDetailBody } from "@/app/month/month-detail-body";
import { Nav } from "@/app/nav";
import { todayISO } from "@/lib/dates";
import { getCatalog, getPurchases } from "@/lib/inventory";
import { buildMonthDetail, isMonth } from "@/lib/months";

export const dynamic = "force-dynamic";

export default async function MonthDetailPage({ params }: PageProps<"/month/[month]">) {
  const { month } = await params;
  if (!isMonth(month)) redirect("/month");

  const [catalog, purchases] = await Promise.all([getCatalog(), getPurchases()]);
  const m = buildMonthDetail(catalog, purchases, month, todayISO());

  return (
    <>
      <Nav current="months" />
      <MonthDetailBody m={m} />
    </>
  );
}
