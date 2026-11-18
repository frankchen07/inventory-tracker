import Link from "next/link";
import { daysBetween, todayISO } from "@/lib/dates";
import { computeStaleCounts, loadBuyList, STALE_AFTER_DAYS } from "@/lib/inventory";

export const dynamic = "force-dynamic";

const BUTTON = "flex min-h-11 items-center rounded-md px-4 text-base font-medium";

function ago(days: number): string {
  if (days === 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function packs(n: number, unit: string): string {
  if (n === 1) return `${n} ${unit}`;
  return /([sxz]|[cs]h)$/.test(unit) ? `${n} ${unit}es` : `${n} ${unit}s`;
}

export default async function DashboardPage() {
  const { catalog, countDates, latestDate, aItems, unknownAItems, list } = await loadBuyList();
  const today = todayISO();
  const stale = computeStaleCounts(catalog, countDates, today).filter((s) => aItems.has(s.item));
  const latestDaysAgo = latestDate ? daysBetween(latestDate, today) : null;

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEETS_SPREADSHEET_ID}/edit`;

  const rows = [
    ...list.toBuy.map((b) => ({
      item: b.item,
      supplier: b.supplier,
      buy: `Buy ${packs(b.buy, b.unit)}`,
      note:
        b.boughtSince > 0
          ? `${b.onHand} at last count, ${packs(Math.round(b.boughtSince * 10) / 10, b.unit)} bought since`
          : `${b.onHand} left`,
    })),
    ...list.handAdded.map((h) => ({ item: h.item, supplier: h.supplier, buy: "Buy", note: "added by hand" })),
  ];
  const bySupplier = Map.groupBy(rows, (r) => r.supplier || "Unspecified");
  const suppliers = [...bySupplier.keys()].sort((a, b) => a.localeCompare(b));
  const problems = [
    ...list.needsReview,
    ...unknownAItems.map((item) => ({ item, problem: "is in the a items tab but not in inventory" })),
  ];

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 pb-14 pt-7 text-[18px] leading-[1.35] text-zinc-900 tabular-nums">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold">Buy list</h1>
          <p className="mt-1 text-base text-zinc-600">
            {latestDate && latestDaysAgo !== null ? (
              <span className={latestDaysAgo >= STALE_AFTER_DAYS ? "font-bold text-red-700" : undefined}>
                Last count {latestDate} ({ago(latestDaysAgo)})
              </span>
            ) : (
              "No counts recorded yet"
            )}
            {" · "}
            {aItems.size} items counted weekly
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
                <b>{row.buy}</b>
                <span className="block text-base text-zinc-600">{row.note}</span>
              </span>
            </div>
          ))}
        </section>
      ))}

      {list.notCounted.length > 0 && (
        <section className="mt-9">
          <h2 className="mb-1.5 text-[23px] font-bold">Never counted ({list.notCounted.length})</h2>
          <p className="mb-2 text-base text-zinc-600">Count these in the next weekly count.</p>
          {list.notCounted.map((item) => (
            <div key={item} className="border-t border-zinc-200 py-3.5">
              <b className="first-letter:uppercase">{item}</b>
            </div>
          ))}
        </section>
      )}

      {stale.length > 0 && (
        <section className="mt-9">
          <h2 className="mb-1.5 text-[23px] font-bold">
            Not counted in {STALE_AFTER_DAYS}+ days ({stale.length})
          </h2>
          <p className="mb-2 text-base text-zinc-600">These numbers may be out of date. Count them next time.</p>
          {stale.map((item) => (
            <div key={item.item} className="flex justify-between gap-4 border-t border-zinc-200 py-3.5">
              <b className="first-letter:uppercase">{item.item}</b>
              <span className="text-right text-zinc-600">{ago(item.daysAgo)}</span>
            </div>
          ))}
        </section>
      )}

      {problems.length > 0 && (
        <section className="mt-9">
          <h2 className="mb-1.5 text-[23px] font-bold">Needs review ({problems.length})</h2>
          <p className="mb-2 text-base text-zinc-600">Fix these in the sheet.</p>
          {problems.map((p) => (
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
