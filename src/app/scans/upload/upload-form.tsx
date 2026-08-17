"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Status = "idle" | "processing" | "error";

export function UploadForm({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const scanDate = (form.elements.namedItem("scanDate") as HTMLInputElement).value;
    const file = (form.elements.namedItem("photo") as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      setStatus("processing");
      const body = new FormData();
      body.set("scanDate", scanDate);
      body.set("photo", file);

      const res = await fetch("/api/scans/upload", { method: "POST", body });
      if (!res.ok) {
        throw new Error((await res.json()).error ?? "could not process sheet");
      }
      const { draftId } = await res.json();
      router.push(`/scans/${draftId}/confirm`);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-zinc-700">Date of count</span>
        <input
          type="date"
          name="scanDate"
          defaultValue={defaultDate}
          required
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-zinc-700">Photo</span>
        <input
          type="file"
          name="photo"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          required
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={status === "processing"}
        className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {status === "processing" ? "Reading sheet…" : "Upload & read sheet"}
      </button>
    </form>
  );
}
