import { put } from "@vercel/blob";

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
