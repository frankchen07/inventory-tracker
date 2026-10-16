// Parses the free-text `unit conversion`, `threshold`, and reported-quantity
// cells on the "inventory" sheet. These are hand-written by Frank, not structured data — the
// patterns here are reverse-engineered from the real rows in the "inventory" sheet, not a
// general-purpose grammar. If a new phrasing shows up, extend the patterns
// below rather than trying to generalize preemptively.

export interface UnitLevel {
  unit: string;
  perAtomic: number;
}

export function normalizeUnit(word: string): string {
  const w = word.toLowerCase();
  if (/[xsz]es$/.test(w) || /[cs]hes$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && w.length > 1) return w.slice(0, -1);
  return w;
}

const THREE_LEVEL =
  /^1\s+([\w-]+)\s+has\s+(\d+(?:\.\d+)?)\s+([\w-]+)\s+with\s+(\d+(?:\.\d+)?)(?:\s+(?!per\b)([\w-]+))?\s+per\s+[\w-]+/i;
const TWO_LEVEL = /^1\s+([\w-]+)\s+has\s+(\d+(?:\.\d+)?)\s+([\w-]+)/i;
const SINGLE_LEVEL = /^1\s+([\w-]+)/i;

// Returns unit levels ordered largest-to-smallest, each carrying its multiplier
// to the atomic (smallest tracked) unit. In three-level cells the atomic unit
// is only a level when named ("50 cups per sleeve", not "50 per sleeve").
export function parseConversion(text: string): UnitLevel[] {
  const t = text.trim();

  const three = t.match(THREE_LEVEL);
  if (three) {
    const [, unit1, n2, unit2, n3, unit3] = three;
    const mid = Number(n2) * Number(n3);
    return [
      { unit: normalizeUnit(unit1), perAtomic: mid },
      { unit: normalizeUnit(unit2), perAtomic: Number(n3) },
      ...(unit3 ? [{ unit: normalizeUnit(unit3), perAtomic: 1 }] : []),
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
    // "3 sleeves of cups" names two units — ambiguous, so needs review.
    const named = rest.trim().split(/\s+/).map(normalizeUnit);
    const matching = levels.filter((l) => named.includes(l.unit));
    if (matching.length !== 1) return null;
    total += Number(numStr) * matching[0].perAtomic;
  }
  return total;
}

// Thresholds are a quantity like any count ("10 sleeves", "500 cups"). Older
// cells list equal amounts ("1 box or 12 sleeves or 600 cups"); the first is used.
export function parseThresholdQuantity(text: string, levels: UnitLevel[]): number | null {
  return parseReportedQuantity(text.split(/\s+or\s+/i)[0], levels);
}
