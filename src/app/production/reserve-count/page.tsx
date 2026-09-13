import Link from "next/link";
import { getProductionStockEntities, getLatestProductionStock } from "@/lib/production";

export const dynamic = "force-dynamic";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function ReserveCountPage() {
  const [entities, latestStock] = await Promise.all([
    getProductionStockEntities(),
    getLatestProductionStock(),
  ]);

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900">Log reserve count</h1>
        <Link href="/production" className="text-sm font-medium text-zinc-500 hover:text-zinc-900">
          Back
        </Link>
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        Walk the shelf and enter what&apos;s actually on hand right now. Leave an entity blank if you
        didn&apos;t recount it — its last known count carries forward.
      </p>

      <form method="post" action="/api/production/reserve-count" className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-900">Date</span>
          <input
            type="date"
            name="date"
            defaultValue={todayISO()}
            required
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="rounded-lg border border-zinc-200">
          <ul className="divide-y divide-zinc-100">
            {entities.map((entity) => {
              const lastKnown = latestStock.get(entity.entity) ?? 0;
              return (
                <li key={entity.entity} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">{entity.entity}</p>
                    <p className="text-xs text-zinc-500">
                      last known: {lastKnown} {entity.amtUnit}
                    </p>
                  </div>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    name={`amt_${entity.entity}`}
                    placeholder={String(lastKnown)}
                    className="w-24 rounded-md border border-zinc-300 px-3 py-2 text-right text-sm"
                  />
                </li>
              );
            })}
          </ul>
        </div>

        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Save count
        </button>
      </form>
    </main>
  );
}
