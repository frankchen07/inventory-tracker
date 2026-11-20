import { BuyListBody } from "@/app/buy-list-body";
import { Nav } from "@/app/nav";
import { buildBuyListView } from "@/lib/buy-list-view";
import { todayISO } from "@/lib/dates";
import { loadBuyList } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export default async function BuyListPage() {
  const { latestDate, list } = await loadBuyList();
  const view = buildBuyListView(list, latestDate, todayISO());
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEETS_SPREADSHEET_ID}/edit`;

  return (
    <>
      <Nav current="buy" />
      <BuyListBody view={view} sheetUrl={sheetUrl} />
    </>
  );
}
