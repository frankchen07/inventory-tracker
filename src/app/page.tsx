import Link from "next/link";
import { getInventoryItems, isLowStock } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const items = await getInventoryItems();
  const sorted = [...items].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const lowCount = items.filter(isLowStock).length;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Inventory Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {items.length} items tracked · {lowCount} low stock
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/scans/upload"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Scan inventory
          </Link>
          <Link
            href="/restock"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Restock list
          </Link>
          <Link
            href="/scans"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Scan history
          </Link>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Current</th>
              <th className="px-3 py-2">Threshold</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Last counted</th>
              <th className="px-3 py-2">Buy from</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {sorted.map((item) => {
              const low = isLowStock(item);
              return (
                <tr key={item.id}>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-900">{item.name}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{item.category}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {item.currentQuantity} {item.trackingUnit}
                    {item.unitsPerContainer !== null && (
                      <span className="text-zinc-400">
                        {" "}
                        (≈ {Math.round(item.currentQuantity * item.unitsPerContainer)} individual)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                    {item.reorderThreshold} {item.trackingUnit}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        low ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"
                      }`}
                    >
                      {low ? "LOW" : "OK"}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                    {item.lastCountedAt ? item.lastCountedAt.slice(0, 10) : "never"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{item.purchaseLocation}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
