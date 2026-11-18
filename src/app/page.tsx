import Link from "next/link";
import { daysBetween, shortDate, todayISO } from "@/lib/dates";
import { loadBuyList, STALE_AFTER_DAYS } from "@/lib/inventory";

export const dynamic = "force-dynamic";

const BUTTON = "flex min-h-11 items-center rounded-md px-4 text-base font-medium";

function ago(days: number): string {
  if (days === 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export default async function DashboardPage() {
  const { latestDate, list } = await loadBuyList();
  const today = todayISO();
  const isStale = (date: string) => daysBetween(date, today) >= STALE_AFTER_DAYS;

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEETS_SPREADSHEET_ID}/edit`;

  const rows = [
    ...list.low.map((l) => ({
      item: l.item,
      supplier: l.supplier,
      main: `${l.countText} left`,
      note: [shortDate(l.countDate), ...l.boughtSince.map((b) => `bought ${shortDate(b.date)} (${b.quantity})`)].join(" · "),
      stale: isStale(l.countDate),
    })),
    ...list.handAdded.map((h) => ({
      item: h.item,
      supplier: h.supplier,
      main: "Added by hand",
      note: `${shortDate(h.added)}${h.inCatalog ? "" : " · not in inventory"}`,
      stale: false,
    })),
  ];
  const bySupplier = Map.groupBy(rows, (r) => r.supplier || "Unspecified");
  const suppliers = [...bySupplier.keys()].sort((a, b) => a.localeCompare(b));

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 pb-14 pt-7 text-[18px] leading-[1.35] text-zinc-900 tabular-nums">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold">Buy list</h1>
          <p className="mt-1 text-base text-zinc-600">
            {latestDate ? (
              <span className={isStale(latestDate) ? "font-bold text-red-700" : undefined}>
                Last count {shortDate(latestDate)} ({ago(daysBetween(latestDate, today))})
              </span>
            ) : (
              "No counts recorded yet"
            )}
            {" · "}
            {list.low.length} running low · {list.handAdded.length} added by hand
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/month" className={`${BUTTON} border border-zinc-300 text-zinc-700 hover:bg-zinc-50`}>
            This month
          </Link>
          <Link href="/production" className={`${BUTTON} border border-zinc-300 text-zinc-700 hover:bg-zinc-50`}>
            Production
          </Link>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <a
          href={sheetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${BUTTON} border border-zinc-300 text-zinc-700 hover:bg-zinc-50`}
        >
          Open Google Sheet
        </a>
      </div>

      {rows.length === 0 && (
        <p className="mt-9 border-t border-zinc-200 py-3.5 text-zinc-600">Nothing to buy right now.</p>
      )}
      {suppliers.map((supplier) => (
        <section key={supplier} className="mt-9">
          <h2 className="mb-2 text-[23px] font-bold first-letter:uppercase">{supplier}</h2>
          {bySupplier.get(supplier)!.map((row) => (
            <div key={row.item} className="flex justify-between gap-4 border-t border-zinc-200 py-3.5">
              <b className="first-letter:uppercase">{row.item}</b>
              <span className="text-right">
                {row.main}
                <span className={`block text-base ${row.stale ? "font-bold text-red-700" : "text-zinc-600"}`}>{row.note}</span>
              </span>
            </div>
          ))}
        </section>
      ))}

      {list.needsReview.length > 0 && (
        <section className="mt-9">
          <h2 className="mb-1.5 text-[23px] font-bold">Needs review ({list.needsReview.length})</h2>
          <p className="mb-2 text-base text-zinc-600">Fix these in the sheet.</p>
          {list.needsReview.map((p) => (
            <div key={p.item} className="flex justify-between gap-4 border-t border-zinc-200 py-3.5">
              <b className="first-letter:uppercase">{p.item}</b>
              <span className="text-right font-bold text-red-700">{p.problem}</span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
