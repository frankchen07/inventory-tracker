import Link from "next/link";
import { computeRestockList, getCatalog } from "@/lib/inventory";
import { getLatestDateColumn } from "@/lib/sheets";
import type { RestockItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [catalog, { lowStock, needsReview }, latestDate] = await Promise.all([
    getCatalog(),
    computeRestockList(),
    getLatestDateColumn(),
  ]);

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEETS_SPREADSHEET_ID}/edit`;

  const byLocation = new Map<string, RestockItem[]>();
  for (const item of lowStock) {
    const key = item.supplier || "Unspecified";
    const group = byLocation.get(key) ?? [];
    group.push(item);
    byLocation.set(key, group);
  }
  const locations = [...byLocation.keys()].sort((a, b) => a.localeCompare(b));

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Inventory Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {latestDate
              ? `Based on latest data on ${latestDate.date}, `
              : "No counts recorded yet — "}
            {catalog.length} items tracked · {lowStock.length} low stock · {needsReview.length} need review
          </p>
        </div>
        <Link
          href="/production"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Production
        </Link>
      </div>

      <div className="mt-4 flex gap-2">
        <Link
          href="/scans/upload"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Scan inventory
        </Link>
        <a
          href={sheetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Open Google Sheet
        </a>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {lowStock.length === 0 && (
          <p className="text-sm text-zinc-500">Nothing needs restocking right now.</p>
        )}
        {locations.map((location) => (
          <div key={location} className="rounded-lg border border-zinc-200">
            <h2 className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-900">
              {location}
            </h2>
            <ul className="divide-y divide-zinc-100">
              {byLocation.get(location)!.map((item) => (
                <li key={item.item} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="text-zinc-900">{item.item}</span>
                  <span className="text-zinc-500">{item.remaining} remaining</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {needsReview.length > 0 && (
        <div className="mt-8 rounded-lg border border-amber-200">
          <h2 className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900">
            Needs review — couldn&apos;t read units ({needsReview.length})
          </h2>
          <ul className="divide-y divide-amber-100">
            {needsReview.map((item) => (
              <li key={item.item} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-zinc-900">{item.item}</span>
                <span className="text-zinc-500">
                  couldn&apos;t read units from &quot;{item.countText}&quot; — fix in the sheet
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
