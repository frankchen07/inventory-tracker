import Link from "next/link";
import { addDays, todayISO } from "@/lib/dates";
import { computeMonth, getAItems, getInventorySnapshot, getPurchases, getWaste } from "@/lib/inventory";

export const dynamic = "force-dynamic";

const BUTTON = "flex min-h-11 items-center rounded-md px-4 text-base font-medium";

const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const qty = (n: number) => `${Math.round(n * 10) / 10}`;

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default async function MonthPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const requested = (await searchParams).month;
  const thisMonth = todayISO().slice(0, 7);
  const month = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : thisMonth;
  const prevMonth = addDays(`${month}-01`, -1).slice(0, 7);

  const [{ catalog, history }, purchases, waste] = await Promise.all([getInventorySnapshot(), getPurchases(), getWaste()]);
  const { aItems, unknown } = await getAItems(catalog);
  const m = computeMonth(catalog, history, aItems, purchases, waste, month);

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 pb-14 pt-7 text-[18px] leading-[1.35] text-zinc-900 tabular-nums">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-[28px] font-bold">{monthLabel(month)}</h1>
        <div className="flex flex-wrap gap-2">
          <Link href={`/month?month=${prevMonth}`} className={`${BUTTON} border border-zinc-300 text-zinc-700 hover:bg-zinc-50`}>
            {monthLabel(prevMonth)}
          </Link>
          {month !== thisMonth && (
            <Link href="/month" className={`${BUTTON} border border-zinc-300 text-zinc-700 hover:bg-zinc-50`}>
              This month
            </Link>
          )}
          <Link href="/" className={`${BUTTON} border border-zinc-300 text-zinc-700 hover:bg-zinc-50`}>
            Buy list
          </Link>
        </div>
      </div>

      <div className="mt-5 space-y-1">
        {m.lines.length === 0 ? (
          <p className="text-zinc-600">
            Not enough counts to work out usage yet. Each item needs a count before the month and one during it.
          </p>
        ) : (
          <>
            <p>
              Used <b>{dollars(m.usedCost)}</b> of supplies, <b>{dollars(m.wasteCost)}</b> of it thrown out.
            </p>
            <p>
              <b>{dollars(m.shelfCost)}</b> sitting on the shelf.
            </p>
          </>
        )}
        <p>
          Spent <b>{dollars(m.spend)}</b> on {m.runs} {m.runs === 1 ? "run" : "runs"}
          {m.unpricedPurchases > 0 && ` (plus ${m.unpricedPurchases} purchases with no price)`}.
        </p>
        {m.unpricedItems.length > 0 && (
          <p className="text-base text-zinc-600">
            No unit cost yet for {m.unpricedItems.join(", ")}, so they&apos;re left out of the dollar totals.
          </p>
        )}
      </div>

      {m.lines.length > 0 && (
        <section className="mt-9">
          <h2 className="mb-2 text-[23px] font-bold">By item</h2>
          {m.lines.map((l) => (
            <div key={l.item} className="flex justify-between gap-4 border-t border-zinc-200 py-3.5">
              <span>
                <b className="first-letter:uppercase">{l.item}</b>
                <span className="block text-base text-zinc-600">
                  {qty(l.start)} → {qty(l.end)} {l.unit}, bought {qty(l.bought)}
                  {l.wasted > 0 && `, ${qty(l.wasted)} thrown out`}
                </span>
              </span>
              <span className="text-right">
                Used <b>{qty(l.used)}</b>
                <span className="block text-base text-zinc-600">{l.usedCost === null ? "no price" : dollars(l.usedCost)}</span>
              </span>
            </div>
          ))}
        </section>
      )}

      {unknown.length > 0 && (
        <p className="mt-5 font-bold text-red-700">
          Not in inventory, so left out: {unknown.join(", ")}. Fix the name in the a items tab.
        </p>
      )}

      {m.incomplete.length > 0 && (
        <section className="mt-9">
          <h2 className="mb-1.5 text-[23px] font-bold">Can&apos;t work out yet ({m.incomplete.length})</h2>
          {m.incomplete.map((i) => (
            <div key={i.item} className="flex justify-between gap-4 border-t border-zinc-200 py-3.5">
              <b className="first-letter:uppercase">{i.item}</b>
              <span className="text-right text-zinc-600">{i.reason}</span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
