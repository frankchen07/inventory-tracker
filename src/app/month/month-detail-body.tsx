import Link from "next/link";
import { PAGE } from "@/app/nav";
import type { MonthDetail } from "@/lib/months";

function Lines({ title, rows }: { title: string; rows: { name: string; sub: string; amount: string }[] }) {
  return (
    <section>
      <h2 className="mb-2 text-xl font-bold">{title}</h2>
      <ul>
        {rows.map((row) => (
          <li key={row.name} className="flex items-baseline justify-between gap-3 border-t border-zinc-200 py-3.5">
            <div className="min-w-0 break-words">
              <span className="block text-[17px] font-semibold">{row.name}</span>
              <span className="block text-sm text-zinc-600">{row.sub}</span>
            </div>
            <span className={`shrink-0 text-right ${row.amount === "no price" ? "text-[15px] text-zinc-600" : "text-[17px] font-semibold"}`}>
              {row.amount}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MonthDetailBody({ m }: { m: MonthDetail }) {
  return (
    <main className={`${PAGE} max-w-[1100px]`}>
      <Link href="/month" className="-ml-1 inline-flex min-h-11 items-center gap-1 text-[15px] font-medium text-zinc-700 hover:text-zinc-900">
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
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Months
      </Link>

      <h1 className="mt-2 text-[28px] font-bold">{m.label}</h1>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2.5">
        <span className="text-[40px] font-bold leading-tight">{m.total}</span>
        {m.runsText && <span className="text-[15px] text-zinc-600">{m.runsText}</span>}
      </p>
      {m.unpricedNote && <p className="text-sm text-zinc-600">{m.unpricedNote}</p>}

      {m.empty ? (
        <p className="mt-8 border-t border-zinc-200 py-3.5 text-zinc-600">Nothing logged this month.</p>
      ) : (
        <div className="mt-8 grid items-start gap-x-12 gap-y-8 lg:grid-cols-2">
          <Lines title="By store" rows={m.stores} />
          <Lines title="What was bought" rows={m.items} />
        </div>
      )}
    </main>
  );
}
