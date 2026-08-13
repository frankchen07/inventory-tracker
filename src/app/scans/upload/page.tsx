import { UploadForm } from "./upload-form";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function UploadScanPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-xl font-semibold text-zinc-900">Scan inventory</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Take a photo of the completed inventory count sheet. The app will read it using optical
        character recognition and show you the numbers. Please review them for accuracy and
        confirm.
      </p>
      <UploadForm defaultDate={todayISO()} />
    </main>
  );
}
