import Link from "next/link";
import { listScans } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export default async function ScanHistoryPage() {
  const scans = await listScans();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Scan history</h1>
          <p className="mt-1 text-sm text-zinc-500">{scans.length} scans on file.</p>
        </div>
        <Link
          href="/scans/upload"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Scan inventory
        </Link>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-zinc-200">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Reviewed by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {scans.map((scan) => (
              <tr key={scan.id}>
                <td className="px-3 py-2">
                  <Link href={`/scans/${scan.id}/confirm`} className="text-zinc-900 hover:underline">
                    {scan.scanDate}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      scan.status === "confirmed"
                        ? "bg-green-100 text-green-800"
                        : "bg-yellow-100 text-yellow-800"
                    }`}
                  >
                    {scan.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-zinc-500">{scan.reviewedBy ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
