// Parses the free-text `unit conversion`, `threshold`, and reported-quantity
// cells on the "inventory" sheet. These are hand-written by Frank, not structured data — the
// patterns here are reverse-engineered from the real rows in the "inventory" sheet, not a
// general-purpose grammar. If a new phrasing shows up, extend the patterns
// below rather than trying to generalize preemptively.

export interface UnitLevel {
  unit: string;
  perAtomic: number;
}

function normalizeUnit(word: string): string {
  const w = word.toLowerCase();
  if (/[xsz]es$/.test(w) || /[cs]hes$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && w.length > 1) return w.slice(0, -1);
  return w;
}

const THREE_LEVEL =
  /^1\s+([\w-]+)\s+has\s+(\d+(?:\.\d+)?)\s+([\w-]+)\s+with\s+(\d+(?:\.\d+)?)(?:\s+(?!per\b)[\w-]+)?\s+per\s+[\w-]+/i;
const TWO_LEVEL = /^1\s+([\w-]+)\s+has\s+(\d+(?:\.\d+)?)\s+([\w-]+)/i;
const SINGLE_LEVEL = /^1\s+([\w-]+)/i;

// Returns unit levels ordered largest-to-smallest, each carrying its multiplier
// to the atomic (smallest tracked) unit. The atomic unit itself is never named
// in these cells (Frank never writes "50 cups per sleeve", just "50 per
// sleeve"), so it's intentionally absent from the returned levels — nothing
// ever gets reported in atomic terms anyway.
export function parseConversion(text: string): UnitLevel[] {
  const t = text.trim();

  const three = t.match(THREE_LEVEL);
  if (three) {
    const [, unit1, n2, unit2, n3] = three;
    const mid = Number(n2) * Number(n3);
    return [
      { unit: normalizeUnit(unit1), perAtomic: mid },
      { unit: normalizeUnit(unit2), perAtomic: Number(n3) },
    ];
  }

  const two = t.match(TWO_LEVEL);
  if (two) {
    const [, unit1, n2, unit2] = two;
    return [
      { unit: normalizeUnit(unit1), perAtomic: Number(n2) },
      { unit: normalizeUnit(unit2), perAtomic: 1 },
    ];
  }

  const single = t.match(SINGLE_LEVEL);
  if (single) {
    const [, unit1] = single;
    return [{ unit: normalizeUnit(unit1), perAtomic: 1 }];
  }

  return [];
}

// All levels of a threshold are written as equal (e.g. "1 box or 12 sleeves
// or 600 cups"), so the last number in the string is the atomic figure.
export function parseThreshold(text: string): number | null {
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s+[\w-]+/g)];
  if (matches.length === 0) return null;
  return Number(matches[matches.length - 1][1]);
}

// Sums one or more "<number> <unit>" components (handles "and"-joined mixed
// units like "1 box and 6 sleeves") against the item's parsed conversion
// levels. Returns null if a component's unit doesn't match any known level —
// that should surface as "needs review," not a silent wrong number.
export function parseReportedQuantity(text: string, levels: UnitLevel[]): number | null {
  const t = text.trim();
  if (t === "") return null;

  const segments = t.split(/\s+and\s+/i);
  let total = 0;
  for (const segment of segments) {
    const match = segment.trim().match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (!match) return null;
    const [, numStr, rest] = match;
    const words = rest.trim().split(/\s+/);
    const unitWord = words[words.length - 1];
    const normalized = normalizeUnit(unitWord);
    const level = levels.find((l) => l.unit === normalized);
    if (!level) return null;
    total += Number(numStr) * level.perAtomic;
  }
  return total;
}
