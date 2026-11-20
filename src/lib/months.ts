import { displayName } from "@/lib/format";
import { computeMonthSpend } from "@/lib/inventory";
import type { CatalogItem, PurchaseRow } from "@/lib/types";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(text: string): boolean {
  return MONTH.test(text);
}

const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function monthDate(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

const monthLabel = (month: string) => monthDate(month).toLocaleDateString("en-US", { month: "long", year: "numeric" });
const shortMonth = (month: string) => monthDate(month).toLocaleDateString("en-US", { month: "short" });

function previousMonth(month: string): string {
  const d = monthDate(month);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export interface MonthRow {
  month: string;
  label: string;
  soFar: boolean;
  total: string;
  runsLine: string;
  comparison: string | null;
  href: string;
}

// Every month from the first logged purchase up to now (or the latest
// purchase, if one is dated later), newest first.
export function buildMonthList(
  catalog: CatalogItem[],
  purchases: PurchaseRow[],
  today: string,
): { rows: MonthRow[]; anyUnpriced: boolean } {
  const current = today.slice(0, 7);
  const logged = purchases.map((p) => p.date.slice(0, 7)).filter(isMonth).sort();
  const first = [current, logged[0] ?? current].sort()[0];
  const last = [current, logged.at(-1) ?? current].sort()[1];

  const months: string[] = [];
  for (let m = last; m >= first; m = previousMonth(m)) months.push(m);

  const spends = months.map((m) => computeMonthSpend(catalog, purchases, m));
  const rows = months.map((month, i): MonthRow => {
    const s = spends[i];
    const lines = s.byItem.reduce((n, item) => n + item.quantities.length, 0);
    let runsLine: string;
    if (lines === 0) runsLine = month === current ? "Nothing logged yet" : "No runs";
    else runsLine = `${plural(s.runs, "run")}${s.unpricedPurchases > 0 ? ` · ${s.unpricedPurchases} with no price` : ""}`;

    let comparison: string | null = null;
    if (lines > 0) {
      const before = months[i + 1];
      if (before === undefined) {
        comparison = "First month logged";
      } else {
        const diff = Math.round(s.spend) - Math.round(spends[i + 1].spend);
        const name = shortMonth(before);
        comparison = diff === 0 ? `Same as ${name}` : `${dollars(Math.abs(diff))} ${diff < 0 ? "less" : "more"} than ${name}`;
      }
    }

    return {
      month,
      label: monthLabel(month),
      soFar: month === current,
      total: dollars(s.spend),
      runsLine,
      comparison,
      href: `/month/${month}`,
    };
  });

  return { rows, anyUnpriced: spends.some((s) => s.unpricedPurchases > 0) };
}

export interface MonthDetail {
  label: string;
  total: string;
  runsText: string | null;
  unpricedNote: string | null;
  empty: boolean;
  stores: { name: string; sub: string; amount: string }[];
  items: { name: string; sub: string; amount: string }[];
}

export function buildMonthDetail(catalog: CatalogItem[], purchases: PurchaseRow[], month: string, today: string): MonthDetail {
  const s = computeMonthSpend(catalog, purchases, month);
  const empty = s.byItem.length === 0;
  const u = s.unpricedPurchases;
  const withUnpriced = (n: number) => (n > 0 ? ` · ${n} with no price` : "");

  let unpricedNote: string | null = null;
  if (u === 1) unpricedNote = "1 purchase has no price, so it isn't in that total.";
  else if (u > 1) unpricedNote = `${u} purchases have no price, so they aren't in that total.`;

  return {
    label: monthLabel(month),
    total: dollars(s.spend),
    runsText: empty ? null : `on ${plural(s.runs, "run")}${month === today.slice(0, 7) ? ", so far" : ""}`,
    unpricedNote,
    empty,
    stores: s.byStore.map((st) => ({
      name: displayName(st.store),
      sub: `${plural(st.runs, "run")}${withUnpriced(st.unpriced)}`,
      amount: st.unpriced < st.lines ? dollars(st.spend) : "no price",
    })),
    items: s.byItem.map((it) => ({
      name: displayName(it.item),
      sub: it.quantities.join(" + "),
      amount:
        it.unpriced < it.quantities.length
          ? `${dollars(it.spend)}${it.unpriced > 0 ? ` + ${it.unpriced} with no price` : ""}`
          : "no price",
    })),
  };
}
