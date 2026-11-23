import { daysBetween, shortDate } from "@/lib/dates";
import { displayName } from "@/lib/format";
import { STALE_AFTER_DAYS } from "@/lib/inventory";
import type { BuyList } from "@/lib/types";

export interface BuyRow {
  item: string;
  right: string;
  note: string | null;
  kind: "low" | "hand" | "bought";
}

export interface BuyGroup {
  title: string;
  status: string;
  rows: BuyRow[];
}

export interface BuyListView {
  headline: string;
  banner: { title: string; detail: string | null } | null;
  lastCount: string | null;
  groups: BuyGroup[];
  needsReview: { item: string; problem: string }[];
}

const NO_SUPPLIER = "No supplier yet";
const ORDER: Record<BuyRow["kind"], number> = { low: 0, hand: 1, bought: 2 };

const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

function ago(days: number): string {
  if (days === 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

// What / shows: to-buy items first, grouped by supplier, with anything already
// bought since its count sunk to the bottom so nobody buys it twice.
export function buildBuyListView(list: BuyList, latestDate: string | null, today: string): BuyListView {
  const groups = new Map<string, { title: string; rows: BuyRow[] }>();
  const add = (supplier: string, row: BuyRow) => {
    const key = supplier.trim().toLowerCase();
    const group = groups.get(key) ?? { title: key === "" ? NO_SUPPLIER : displayName(supplier), rows: [] };
    groups.set(key, group);
    group.rows.push(row);
  };

  for (const l of list.low) {
    const bought = [...l.boughtSince].sort((a, b) => a.date.localeCompare(b.date));
    if (bought.length > 0) {
      const note = `Bought ${bought.map((b) => `${shortDate(b.date)} · ${b.quantity}`).join(", ")}`;
      add(l.supplier, { item: displayName(l.item), right: l.countText, note, kind: "bought" });
    } else {
      const note = l.countDate === latestDate ? null : `Counted ${shortDate(l.countDate)}`;
      add(l.supplier, { item: displayName(l.item), right: l.countText, note, kind: "low" });
    }
  }
  for (const h of list.handAdded) {
    const note = `Added ${shortDate(h.added)}${h.inCatalog ? "" : " · not in inventory"}`;
    add(h.supplier, { item: displayName(h.item), right: "a la carte", note, kind: "hand" });
  }

  const toBuy = (rows: BuyRow[]) => rows.filter((r) => r.kind !== "bought").length;
  // Groups with something to buy first (named suppliers A-Z, then no supplier),
  // then groups where everything is bought, A-Z.
  const rank = (key: string, rows: BuyRow[]) => (toBuy(rows) > 0 ? (key === "" ? 1 : 0) : 2);
  const ordered = [...groups.entries()].sort(
    ([ka, a], [kb, b]) => rank(ka, a.rows) - rank(kb, b.rows) || a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
  );

  const allRows = ordered.flatMap(([, g]) => g.rows);
  const boughtCount = allRows.length - toBuy(allRows);
  const headline = `${items(toBuy(allRows))} to buy${boughtCount > 0 ? ` · ${items(boughtCount)} already bought` : ""}`;

  let banner: BuyListView["banner"] = null;
  let lastCount: string | null = null;
  if (latestDate === null) {
    banner = { title: "No counts recorded yet.", detail: null };
  } else {
    const days = daysBetween(latestDate, today);
    if (days >= STALE_AFTER_DAYS) {
      banner = { title: `Last count ${shortDate(latestDate)}, ${days} days ago`, detail: "Time to count." };
    } else {
      lastCount = `Last count ${shortDate(latestDate)} (${ago(days)})`;
    }
  }

  return {
    headline,
    banner,
    lastCount,
    groups: ordered.map(([, g]) => {
      const rows = [...g.rows].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
      const n = toBuy(rows);
      return { title: g.title, status: n > 0 ? `${items(n)} to buy` : "all bought", rows };
    }),
    needsReview: list.needsReview.map((r) => ({ item: displayName(r.item), problem: r.problem })),
  };
}
