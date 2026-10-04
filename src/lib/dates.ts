export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Parses a "YYYY-MM-DD" date string as local calendar date, not UTC, so it
// matches the wall calendar regardless of server timezone.
export function parseDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function todayISO(): string {
  return isoDate(new Date());
}

// Monday of the calendar week containing `date` (JS getDay(): Sun=0..Sat=6).
export function mondayOfWeek(date: string): string {
  const daysSinceMonday = (parseDate(date).getDay() + 6) % 7;
  return addDays(date, -daysSinceMonday);
}
