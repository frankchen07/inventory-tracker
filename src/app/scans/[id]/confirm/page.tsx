import { notFound } from "next/navigation";
import { getInventoryItems, getScanById, getScanLineItems } from "@/lib/inventory";
import type { InventoryItem, ScanLineItem } from "@/lib/types";

interface JoinedRow {
  line: ScanLineItem;
  item: InventoryItem;
}

function confidenceColor(confidence: number) {
  if (confidence >= 70) return "bg-green-100 text-green-800";
  if (confidence >= 40) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-800";
}

export default async function ConfirmScanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [scan, lineItems, inventoryItems] = await Promise.all([
    getScanById(id),
    getScanLineItems(id),
    getInventoryItems(),
  ]);

  if (!scan) notFound();

  const itemsById = new Map(inventoryItems.map((item) => [item.id, item]));
  const rows: JoinedRow[] = lineItems
    .map((line) => ({ line, item: itemsById.get(line.inventoryItemId) }))
    .filter((row): row is JoinedRow => row.item !== undefined)
    .sort((a, b) => a.item.name.localeCompare(b.item.name));

  const alreadyConfirmed = scan.status === "confirmed";

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-8 pb-24">
      <h1 className="text-xl font-semibold text-zinc-900">
        {alreadyConfirmed ? "Review scan" : "Confirm scan"} — {scan.scanDate}
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        {alreadyConfirmed
          ? `Confirmed by ${scan.reviewedBy ?? "someone"} on ${
              scan.reviewedAt ? scan.reviewedAt.slice(0, 10) : "an earlier date"
            }. Make corrections below and save again.`
          : "We read the photo below. Check the highlighted rows first — those are the ones we're least sure about. Fix anything wrong, then confirm."}
      </p>

      {!scan.photoUrl && (
        <p className="mt-4 rounded-md bg-zinc-100 p-3 text-sm text-zinc-600">
          No source photo on file for this scan — cross-check against the paper sheet.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-6 lg:flex-row">
        {scan.photoUrl && (
          <div className="lg:w-[42%] lg:shrink-0">
            <div className="lg:sticky lg:top-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={scan.photoUrl}
                alt="Uploaded inventory sheet"
                className="max-h-80 w-full rounded-lg border border-zinc-200 object-contain lg:max-h-[85vh]"
              />
            </div>
          </div>
        )}

        <form
          action={`/api/scans/${scan.id}/confirm`}
          method="POST"
          className="min-w-0 lg:flex-1"
        >
          <div className="overflow-x-auto rounded-lg border border-zinc-200">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-2 py-1.5">Item</th>
                  <th className="px-2 py-1.5">Category</th>
                  <th className="px-2 py-1.5">Quantity</th>
                  <th className="px-2 py-1.5">Unit</th>
                  <th className="px-2 py-1.5">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map(({ line, item }) => {
                  const flagged = line.ambiguous || line.confidence < 70;
                  return (
                    <tr
                      key={item.id}
                      className={flagged ? confidenceColor(line.confidence) : ""}
                    >
                      <td className="px-2 py-1 whitespace-nowrap text-zinc-900">{item.name}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-zinc-500">{item.category}</td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          step="0.25"
                          name={`reportedQuantity_${item.id}`}
                          defaultValue={line.reportedQuantity ?? ""}
                          className="w-20 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          name={`reportedUnit_${item.id}`}
                          defaultValue={line.reportedUnit ?? item.trackingUnit}
                          className="w-24 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          name={`notes_${item.id}`}
                          defaultValue={line.notes ?? ""}
                          className="w-48 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <label className="mt-4 flex flex-col gap-1 sm:w-64">
            <span className="text-sm font-medium text-zinc-700">Confirmed by</span>
            <input
              type="text"
              name="reviewedBy"
              defaultValue={scan.reviewedBy ?? ""}
              required
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
          </label>

          <button
            type="submit"
            className="mt-4 w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 sm:w-auto"
          >
            {alreadyConfirmed ? "Save corrections" : "Confirm & save"}
          </button>
        </form>
      </div>
    </main>
  );
}
