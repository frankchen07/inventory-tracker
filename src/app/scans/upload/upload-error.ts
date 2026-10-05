// Vercel's body-size limit, timeouts and crashes answer with plain text or HTML, not our JSON.
export function uploadErrorMessage(status: number, bodyText: string): string {
  try {
    const { error } = JSON.parse(bodyText);
    if (typeof error === "string" && error) return error;
  } catch {}
  if (status === 413) return "Photo is too large (max about 4.5 MB). Try a smaller photo.";
  return `Server error (${status}). Please try again.`;
}
