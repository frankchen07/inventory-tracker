// Sheet text with its first letter uppercased, the rest left as typed.
export function displayName(text: string): string {
  const t = text.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
