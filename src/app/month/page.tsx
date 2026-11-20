import { MonthsBody } from "@/app/month/months-body";
import { Nav } from "@/app/nav";
import { todayISO } from "@/lib/dates";
import { getCatalog, getPurchases } from "@/lib/inventory";
import { buildMonthList } from "@/lib/months";

export const dynamic = "force-dynamic";

export default async function MonthsPage() {
  const [catalog, purchases] = await Promise.all([getCatalog(), getPurchases()]);
  const { rows, anyUnpriced } = buildMonthList(catalog, purchases, todayISO());

  return (
    <>
      <Nav current="months" />
      <MonthsBody rows={rows} anyUnpriced={anyUnpriced} />
    </>
  );
}
