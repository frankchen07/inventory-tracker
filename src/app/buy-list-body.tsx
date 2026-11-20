import { PAGE } from "@/app/nav";
import type { BuyListView, BuyRow } from "@/lib/buy-list-view";

function Row({ row }: { row: BuyRow }) {
  const bought = row.kind === "bought";
  return (
    <li className="flex items-baseline justify-between gap-3 border-t border-zinc-200 py-3.5">
      <div className="min-w-0 break-words">
        <span className={`flex items-center gap-1.5 text-[17px] ${bought ? "font-medium text-zinc-600" : "font-semibold"}`}>
          {bought && (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0 text-blue-700"
            >
              <path d="M5 12l5 5 9-10" />
            </svg>
          )}
          {row.item}
        </span>
        {row.note && <span className={`block text-sm ${bought ? "text-blue-700" : "text-zinc-600"}`}>{row.note}</span>}
      </div>
      <span className={`shrink-0 text-right ${row.kind === "low" ? "text-[17px]" : "text-[15px] text-zinc-600"}`}>{row.right}</span>
    </li>
  );
}

export function BuyListBody({ view, sheetUrl }: { view: BuyListView; sheetUrl: string }) {
  return (
    <main className={`${PAGE} max-w-[1100px]`}>
      <header>
        <h1 className="text-[28px] font-bold">Buy list</h1>
        <p className="mt-1 text-[15px] text-zinc-600">{view.headline}</p>
        {view.lastCount && <p className="mt-0.5 text-sm text-zinc-600">{view.lastCount}</p>}
      </header>

      {view.banner && (
        <div role="status" className="mt-5 flex gap-3 rounded-lg bg-red-50 px-3.5 py-3 text-red-800">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="mt-px shrink-0"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <div>
            <p className="text-[15px] font-semibold">{view.banner.title}</p>
            {view.banner.detail && <p className="text-sm">{view.banner.detail}</p>}
          </div>
        </div>
      )}

      {view.groups.length === 0 ? (
        <p className="mt-8 border-t border-zinc-200 py-3.5 text-zinc-600">Nothing to buy right now.</p>
      ) : (
        <div className="mt-8 grid items-start gap-x-12 gap-y-8 lg:grid-cols-2">
          {view.groups.map((group) => (
            <section key={group.title}>
              <div className="flex items-baseline justify-between gap-3 pb-2">
                <h2 className="text-xl font-bold">{group.title}</h2>
                <span className="text-sm text-zinc-600">{group.status}</span>
              </div>
              <ul>
                {group.rows.map((row) => (
                  <Row key={`${row.kind}-${row.item}`} row={row} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {view.needsReview.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-bold">Needs review ({view.needsReview.length})</h2>
          <p className="mb-2 text-sm text-zinc-600">Fix these in the sheet.</p>
          <ul>
            {view.needsReview.map((p) => (
              <li key={p.item} className="flex items-baseline justify-between gap-3 border-t border-zinc-200 py-3.5">
                <span className="min-w-0 break-words text-[17px] font-semibold">{p.item}</span>
                <span className="text-right text-sm font-semibold text-red-700">{p.problem}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <a
        href={sheetUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 inline-flex min-h-11 items-center gap-1.5 text-[15px] text-zinc-700 hover:text-zinc-900"
      >
        Open Google Sheet
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 17L17 7M9 7h8v8" />
        </svg>
      </a>
    </main>
  );
}
