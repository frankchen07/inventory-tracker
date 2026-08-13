import Link from "next/link";
import { getInventoryItems, isLowStock } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export default async function RestockPage() {
  const items = await getInventoryItems();
  const lowItems = items.filter(isLowStock);

  const byLocation = new Map<string, typeof lowItems>();
  for (const item of lowItems) {
    const key = item.purchaseLocation || "Unspecified";
    const group = byLocation.get(key) ?? [];
    group.push(item);
    byLocation.set(key, group);
  }
  const locations = [...byLocation.keys()].sort((a, b) => a.localeCompare(b));

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Restock list</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {lowItems.length === 0 ? "Nothing needs restocking right now." : `${lowItems.length} items need restocking.`}
          </p>
        </div>
        <Link href="/" className="text-sm font-medium text-zinc-700 hover:underline">
          Back to dashboard
        </Link>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {locations.map((location) => (
          <div key={location} className="rounded-lg border border-zinc-200">
            <h2 className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-900">
              {location}
            </h2>
            <ul className="divide-y divide-zinc-100">
              {byLocation.get(location)!.map((item) => (
                <li key={item.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="text-zinc-900">{item.name}</span>
                  <span className="text-zinc-500">
                    {item.currentQuantity} / {item.reorderThreshold} {item.trackingUnit}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}
