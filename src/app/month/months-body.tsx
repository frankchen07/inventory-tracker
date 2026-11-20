import Link from "next/link";
import { PAGE } from "@/app/nav";
import type { MonthRow } from "@/lib/months";

export function MonthsBody({ rows, anyUnpriced }: { rows: MonthRow[]; anyUnpriced: boolean }) {
  return (
    <main className={`${PAGE} max-w-[720px]`}>
      <h1 className="text-[28px] font-bold">Months</h1>
      <p className="mt-1 text-[15px] text-zinc-600">What supplies cost, from logged receipts</p>

      <ul className="mt-6 border-b border-zinc-200">
        {rows.map((row) => (
          <li key={row.month} className="border-t border-zinc-200">
            <Link href={row.href} className="flex items-center gap-3 py-4 hover:bg-zinc-50">
              <div className="min-w-0 flex-1">
                <span className="block text-[17px] font-semibold">
                  {row.label}
                  {row.soFar && <span className="font-normal text-zinc-600"> · so far</span>}
                </span>
                <span className="block text-sm text-zinc-600">{row.runsLine}</span>
              </div>
              <div className="shrink-0 text-right">
                <span className="block text-xl font-bold">{row.total}</span>
                {row.comparison && <span className="block text-sm text-zinc-600">{row.comparison}</span>}
              </div>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="shrink-0 text-zinc-400"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>

      {anyUnpriced && <p className="mt-4 text-sm text-zinc-600">Totals leave out purchases with no price.</p>}
    </main>
  );
}
