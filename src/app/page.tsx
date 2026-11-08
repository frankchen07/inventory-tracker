import Link from "next/link";
import { computeRestockList, getInventorySnapshot } from "@/lib/inventory";

export const dynamic = "force-dynamic";

const BUTTON = "flex min-h-11 items-center rounded-md px-4 text-base font-medium";

export default async function DashboardPage() {
  const { catalog, counts, latestDate } = await getInventorySnapshot();
  const { lowStock, needsReview } = computeRestockList(catalog, counts);

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEETS_SPREADSHEET_ID}/edit`;

  const byLocation = Map.groupBy(lowStock, (item) => item.supplier || "Unspecified");
  const locations = [...byLocation.keys()].sort((a, b) => a.localeCompare(b));

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 pb-14 pt-7 text-[18px] leading-[1.35] text-zinc-900 tabular-nums">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold">Inventory</h1>
          <p className="mt-1 text-base text-zinc-600">
            {latestDate
              ? `Based on latest data on ${latestDate}, `
              : "No counts recorded yet — "}
            {catalog.length} items tracked · {lowStock.length} low stock · {needsReview.length} need review
          </p>
        </div>
        <Link href="/production" className={`${BUTTON} border border-zinc-300 text-zinc-700 hover:bg-zinc-50`}>
          Production
        </Link>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/scans/upload" className={`${BUTTON} bg-zinc-900 text-white hover:bg-zinc-700`}>
          Scan inventory
        </Link>
        <a
          href={sheetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${BUTTON} border border-zinc-300 text-zinc-700 hover:bg-zinc-50`}
        >
          Open Google Sheet
        </a>
      </div>

      {lowStock.length === 0 && (
        <p className="mt-9 border-t border-zinc-200 py-3.5 text-zinc-600">Nothing needs restocking right now.</p>
      )}
      {locations.map((location) => (
        <section key={location} className="mt-9">
          <h2 className="mb-2 text-[23px] font-bold first-letter:uppercase">{location}</h2>
          {byLocation.get(location)!.map((item) => (
            <div key={item.item} className="flex justify-between gap-4 border-t border-zinc-200 py-3.5">
              <b className="first-letter:uppercase">{item.item}</b>
              <span className="text-right text-zinc-600">{item.remaining} left</span>
            </div>
          ))}
        </section>
      ))}

      {needsReview.length > 0 && (
        <section className="mt-9">
          <h2 className="mb-1.5 text-[23px] font-bold">Needs review ({needsReview.length})</h2>
          <p className="mb-2 text-base text-zinc-600">Couldn&apos;t read the units on these counts. Fix them in the sheet.</p>
          {needsReview.map((item) => (
            <div key={item.item} className="flex justify-between gap-4 border-t border-zinc-200 py-3.5">
              <b className="first-letter:uppercase">{item.item}</b>
              <span className="text-right font-bold text-red-700">&quot;{item.countText}&quot;</span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
