import { list, put } from "@vercel/blob";
import type { ScanDraft } from "@/lib/types";

export async function uploadScanPhoto(
  filename: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  const blob = await put(`scan-photos/${filename}`, bytes, {
    access: "public",
    contentType,
  });
  return blob.url;
}

// In-progress OCR result, stored between upload and confirm — never written
// to the "inventory" sheet until the user actually confirms. Uses a fixed pathname (no
// random suffix) so it can be looked up later by draft id alone.
export async function uploadScanDraft(draft: ScanDraft): Promise<void> {
  await put(`scan-drafts/${draft.id}.json`, JSON.stringify(draft), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function getScanDraft(draftId: string): Promise<ScanDraft | null> {
  const { blobs } = await list({ prefix: `scan-drafts/${draftId}.json` });
  const match = blobs[0];
  if (!match) return null;
  const res = await fetch(match.url, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as ScanDraft;
}
