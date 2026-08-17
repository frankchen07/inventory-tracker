import { notFound } from "next/navigation";
import { getScanDraft } from "@/lib/blob-storage";

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
  const { id: draftId } = await params;
  const draft = await getScanDraft(draftId);
  if (!draft) notFound();

  const rows = [...draft.lineItems].sort((a, b) => a.item.localeCompare(b.item));

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-8 pb-24">
      <h1 className="text-xl font-semibold text-zinc-900">Confirm scan — {draft.scanDate}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        We read the photo below. Check the highlighted rows first — those are the ones we&apos;re
        least sure about. An empty quantity means &quot;not recounted this time&quot; and will keep
        whatever value was last recorded. Fix anything wrong, then confirm.
      </p>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row">
        <div className="lg:w-[42%] lg:shrink-0">
          <div className="lg:sticky lg:top-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={draft.photoUrl}
              alt="Uploaded inventory sheet"
              className="max-h-80 w-full rounded-lg border border-zinc-200 object-contain lg:max-h-[85vh]"
            />
          </div>
        </div>

        <form
          action={`/api/scans/${draftId}/confirm`}
          method="POST"
          className="min-w-0 lg:flex-1"
        >
          <input type="hidden" name="scanDate" value={draft.scanDate} />
          <input type="hidden" name="photoUrl" value={draft.photoUrl} />

          <div className="overflow-x-auto rounded-lg border border-zinc-200">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-2 py-1.5">Item</th>
                  <th className="px-2 py-1.5">Quantity</th>
                  <th className="px-2 py-1.5">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((line) => {
                  const flagged = line.ambiguous || line.confidence < 70;
                  return (
                    <tr key={line.item} className={flagged ? confidenceColor(line.confidence) : ""}>
                      <td className="px-2 py-1 whitespace-nowrap text-zinc-900">{line.item}</td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          name={`quantity_${line.item}`}
                          defaultValue={line.reportedQuantityText}
                          placeholder="not recounted"
                          className="w-40 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          name={`notes_${line.item}`}
                          defaultValue={line.notes ?? ""}
                          className="w-64 rounded border border-zinc-300 px-1.5 py-1"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            type="submit"
            className="mt-4 w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 sm:w-auto"
          >
            Confirm & save to sheet
          </button>
        </form>
      </div>
    </main>
  );
}
