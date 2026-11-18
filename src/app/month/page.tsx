import Link from "next/link";
import { addDays, todayISO } from "@/lib/dates";
import { computeMonthSpend, getAItems, getInventorySnapshot, getPurchases } from "@/lib/inventory";

export const dynamic = "force-dynamic";

const BUTTON = "flex min-h-11 items-center rounded-md px-4 text-base font-medium";

const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function amount(spend: number, unpriced: number): string {
  if (unpriced === 0) return dollars(spend);
  const note = `${unpriced} with no price`;
  return spend > 0 ? `${dollars(spend)} + ${note}` : note;
}

export default async function MonthPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const requested = (await searchParams).month;
  const thisMonth = todayISO().slice(0, 7);
  const month = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : thisMonth;
  const prevMonth = addDays(`${month}-01`, -1).slice(0, 7);

  const [{ catalog, history }, purchases] = await Promise.all([getInventorySnapshot(), getPurchases()]);
  const { aItems, unknown } = await getAItems(catalog);
  const m = computeMonthSpend(catalog, aItems, purchases, history, month);

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
        <p>
          Spent <b>{dollars(m.spend)}</b> on {m.runs} {m.runs === 1 ? "run" : "runs"}.
        </p>
        {m.unpricedPurchases > 0 && (
          <p className="text-base text-zinc-600">
            {m.unpricedPurchases} {m.unpricedPurchases === 1 ? "purchase has" : "purchases have"} no price, so{" "}
            {m.unpricedPurchases === 1 ? "it's" : "they're"} not in that total.
          </p>
        )}
        {m.shelf.date ? (
          <p>
            <b>{dollars(m.shelf.value)}</b> on the shelf at the last count ({dayLabel(m.shelf.date)}).
          </p>
        ) : (
          <p className="text-zinc-600">No counts recorded by the end of {monthLabel(month)}.</p>
        )}
        {m.shelf.unpricedItems.length > 0 && (
          <p className="text-base text-zinc-600">
            No unit cost yet for {m.shelf.unpricedItems.join(", ")}, so they&apos;re left out of the shelf value.
          </p>
        )}
      </div>

      {unknown.length > 0 && (
        <p className="mt-5 font-bold text-red-700">
          Not in inventory, so left out: {unknown.join(", ")}. Fix the name in the a items tab.
        </p>
      )}

      {m.byStore.length > 0 && (
        <section className="mt-9">
          <h2 className="mb-2 text-[23px] font-bold">By store</h2>
          {m.byStore.map((s) => (
            <div key={s.store} className="flex justify-between gap-4 border-t border-zinc-200 py-3.5">
              <b className="first-letter:uppercase">{s.store}</b>
              <span className="text-right">{amount(s.spend, s.unpriced)}</span>
            </div>
          ))}
        </section>
      )}

      {m.byItem.length > 0 && (
        <section className="mt-9">
          <h2 className="mb-2 text-[23px] font-bold">What was bought</h2>
          {m.byItem.map((i) => (
            <div key={i.item} className="flex justify-between gap-4 border-t border-zinc-200 py-3.5">
              <b className="first-letter:uppercase">{i.item}</b>
              <span className="text-right">{amount(i.spend, i.unpriced)}</span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
