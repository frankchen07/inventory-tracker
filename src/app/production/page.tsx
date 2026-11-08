import Link from "next/link";
import { computeProductionPlan, RECIPE_UNIT_OZ } from "@/lib/production";
import type { BatchRequirement, DemandLine, RefillLevel } from "@/lib/types";
import { normalizeUnit } from "@/lib/unit-conversion";

export const dynamic = "force-dynamic";

const OZ_PER_LB = RECIPE_UNIT_OZ.lb;

// Ceiling, not nearest — an oz-derived "how much to produce" figure should
// never round down below what's actually needed.
function ceilDisplay(n: number): number {
  return Math.ceil(n);
}

// 1-decimal rounding for friendly-unit display figures (converted oz counts,
// pounds) — these are informational, not a "never round down" production
// figure, so nearest is right rather than ceiling.
function roundDisplay(n: number): number {
  return Math.round(n * 10) / 10;
}

// Every product name in this app already ends in a natural countable noun
// ("nitro keg", "espresso ccx pouch", "vanilla syrup bottle"), so a friendly
// unit word for a delivery line can be derived from the item name itself
// (its last word) instead of needing a dedicated sheet column — mirrors the
// singularizing logic in unit-conversion.ts's normalizeUnit(), just inverted.
function pluralize(word: string): string {
  if (/[sxz]$/.test(word) || /[cs]h$/.test(word)) return word + "es";
  return word + "s";
}

function formatDayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" });
  return `${weekday} ${m}/${d}`;
}

function batchCount(n: number): string {
  return `${n} ${n === 1 ? "batch" : "batches"}`;
}

// The sheet's colloquial unit, shortened where a standard abbreviation keeps
// table figures from wrapping on a phone, and singular for exactly one.
function unitLabel(unit: string, qty: number): string {
  const singular = normalizeUnit(unit.trim());
  if (singular === "lb" || singular === "pound") return "lb";
  if (singular === "gallon" || singular === "gal") return "gal";
  return qty === 1 ? singular : unit.trim();
}

function amount(qty: number, unit: string): string {
  const n = roundDisplay(qty);
  return unit ? `${n} ${unitLabel(unit, n)}` : `${n}`;
}

// A fractional count ("0.7 nitro keg") reads singular; only more than one
// takes a plural.
function countOf(item: string, qty: number): string {
  const n = roundDisplay(qty);
  if (n <= 1) return `${n} ${item}`;
  const words = item.trim().split(" ");
  return `${n} ${[...words.slice(0, -1), pluralize(words[words.length - 1])].join(" ")}`;
}

// Same-item lines add up first, so the popup's four days of Guatemala read as
// one figure rather than four.
function dueItems(lines: DemandLine[]): string[] {
  const groups = Map.groupBy(lines, (l) => `${l.item}|${l.quantityUnit}`);
  return [...groups.values()]
    .sort((a, b) => a[0].item.localeCompare(b[0].item))
    .map((group) => {
      const { item, quantityUnit, recipeCategory } = group[0];
      const quantity = group.reduce((sum, l) => sum + l.quantity, 0);
      const oz = group.reduce((sum, l) => sum + l.oz, 0);
      if (quantityUnit === "count") return countOf(item, quantity);
      return recipeCategory === "beans"
        ? `${roundDisplay(oz / OZ_PER_LB)} lb ${item}`
        : `${ceilDisplay(oz)} oz ${item}`;
    });
}

// One row per client per day; every popup line merges into a single row with
// a day range, since it's one recurring stall rather than separate deliveries.
function dueRows(lines: DemandLine[]) {
  const popup = lines.filter((l) => l.channel === "popup");
  const clients = Map.groupBy(
    lines.filter((l) => l.channel !== "popup"),
    (l) => `${l.forDate}|${l.customer}`,
  );
  const rows = [...clients.values()].map((group) => ({
    key: `${group[0].forDate}|${group[0].customer}`,
    firstDate: group[0].forDate,
    when: formatDayLabel(group[0].forDate),
    who: group[0].customer.replace(/\b\w/g, (c) => c.toUpperCase()),
    what: dueItems(group).join(", "),
  }));
  if (popup.length > 0) {
    const dates = popup.map((l) => l.forDate).sort();
    const [first, last] = [dates[0], dates[dates.length - 1]];
    rows.push({
      key: "popup",
      firstDate: first,
      when: first === last ? formatDayLabel(first) : `${formatDayLabel(first)}–${formatDayLabel(last)}`,
      who: "Midwife popup",
      what: dueItems(popup).join(", "),
    });
  }
  return rows.sort((a, b) => a.firstDate.localeCompare(b.firstDate));
}

function makeLabel(b: BatchRequirement): string {
  if (b.category === "purchase") {
    // A batch only counts as one product when it's exactly one product's worth.
    const item = b.output?.ozEach === b.recipeOzYieldQty ? b.output.product : b.recipe;
    return `Buy ${countOf(item, b.batchesForOrders)}`;
  }
  if (b.category === "beans") {
    const lbs = roundDisplay((b.batchesForOrders * b.recipeOzYieldQty) / OZ_PER_LB);
    return `Roast ${lbs} lb ${b.recipe.replace(/\s+roast$/i, "")}`;
  }
  return `${b.category === "concentrate" ? "Brew" : "Make"} ${b.recipe}`;
}

function makeDetail(b: BatchRequirement): string {
  if (b.category === "purchase") return "";
  const batches = batchCount(b.batchesForOrders);
  if (!b.output?.unit) return batches;
  const made = Math.floor((b.batchesForOrders * b.recipeOzYieldQty) / b.output.ozEach);
  return `${batches}, ${made} ${unitLabel(b.output.unit, made)}`;
}

function refillAction(r: RefillLevel, levels: RefillLevel[]): { main: string; detail: string } {
  const { batch } = r;
  if (!batch) {
    if (r.units === 0) return { main: "Full", detail: "" };
    return {
      main: `Up to ${r.units} ${unitLabel(r.amtUnit, r.units)}`,
      detail: r.recipeSource ? `uses ${r.recipeSource}` : "",
    };
  }
  const n = batch.batchesForRefill;
  if (n === 0) return { main: "Full", detail: "" };
  const filled = levels.filter((p) => p.recipeSource === r.entity && p.units > 0).map((p) => p.amtUnit);
  const fills = filled.length > 0 ? `includes filling ${filled.join(", ")}` : "";
  if (batch.category === "beans") {
    return {
      main: `Up to ${roundDisplay((n * batch.recipeOzYieldQty) / OZ_PER_LB)} lb`,
      detail: [batchCount(n), fills].filter(Boolean).join(", "),
    };
  }
  const count = batchCount(n);
  return {
    main: batch.batchesForOrders > 0 ? `Up to ${count.replace(" ", " more ")}` : `Up to ${count}`,
    detail: fills,
  };
}

function Step({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-9">
      <h2 className={`flex items-center gap-3 text-[23px] font-bold ${hint ? "mb-1.5" : "mb-2"}`}>
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-zinc-900 text-lg text-white">
          {n}
        </span>
        {title}
      </h2>
      {hint && <p className="mb-2 text-base text-zinc-600">{hint}</p>}
      {children}
    </section>
  );
}

function DueRow({ when, who, what }: { when: string; who: string; what: string }) {
  return (
    <div className="flex gap-4 border-t border-zinc-200 py-3.5">
      <div className="w-24 flex-none text-zinc-600">{when}</div>
      <div className="min-w-0 flex-1">
        <b className="block">{who}</b>
        {what}
      </div>
    </div>
  );
}

function MakeRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-zinc-200 py-3.5 sm:flex-row sm:justify-between sm:gap-4">
      <b className="text-[21px] first-letter:uppercase">{label}</b>
      <span className="text-base text-zinc-600 sm:flex-none">{detail}</span>
    </div>
  );
}

export default async function ProductionPage() {
  const plan = await computeProductionPlan();

  const due = dueRows(plan.demand);
  const upcoming = dueRows(plan.upcomingDemand);
  const toMake = plan.batches.filter((b) => b.batchesForOrders > 0);
  const nothingToMake = toMake.length === 0 && plan.orderFills.length === 0 && plan.sheetProblems.length === 0;

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 pb-14 pt-7 text-[18px] leading-[1.35] text-zinc-900 tabular-nums">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold">Production</h1>
          <p className="mt-1 text-base text-zinc-600">Covers orders through {formatDayLabel(plan.windowEnd)}</p>
        </div>
        <Link
          href="/"
          className="flex min-h-11 items-center rounded-md border border-zinc-300 px-4 text-base font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Inventory dashboard
        </Link>
      </div>

      <Step n={1} title="What's due">
        {due.length === 0 && <p className="border-t border-zinc-200 py-3.5 text-zinc-600">Nothing due this week.</p>}
        {due.map((row) => (
          <DueRow key={row.key} when={row.when} who={row.who} what={row.what} />
        ))}
        {upcoming.length > 0 && (
          <div className="mt-6 text-zinc-600">
            <p className="mb-2 text-base">Next week, heads up</p>
            {upcoming.map((row) => (
              <DueRow key={row.key} when={row.when} who={row.who} what={row.what} />
            ))}
          </div>
        )}
      </Step>

      <Step n={2} title="Take it from reserves">
        {plan.reserveDraws.length === 0 ? (
          <p className="border-t border-zinc-200 py-3.5 text-zinc-600">Nothing to take this week.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-right text-[15px] text-zinc-600">
                <th scope="col" className="py-1.5 text-left font-normal">Item</th>
                <th scope="col" className="py-1.5 pl-3 font-normal">Have</th>
                <th scope="col" className="py-1.5 pl-3 font-normal">Need</th>
                <th scope="col" className="py-1.5 pl-3 font-normal">Left</th>
              </tr>
            </thead>
            <tbody>
              {plan.reserveDraws.map((d) => (
                <tr key={d.item} className="border-t border-zinc-200 text-right">
                  <td className="py-3.5 text-left font-bold first-letter:uppercase">{d.item}</td>
                  <td className="whitespace-nowrap py-3.5 pl-3">{d.have === 0 ? "0" : amount(d.have, d.unit)}</td>
                  <td className="whitespace-nowrap py-3.5 pl-3">{amount(d.need, d.unit)}</td>
                  <td className={`whitespace-nowrap py-3.5 pl-3 ${d.short > 0 ? "font-bold text-red-700" : ""}`}>
                    {d.short > 0 ? `Short ${amount(Math.max(0.1, d.short), d.unit)}` : amount(d.left, d.unit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Step>

      <Step n={3} title="Make what's short" hint="You need these to fill this week's orders.">
        {nothingToMake && <p className="border-t border-zinc-200 py-3.5 text-zinc-600">Nothing short. Reserves cover every order.</p>}
        {toMake.map((b) => (
          <MakeRow key={b.recipe} label={makeLabel(b)} detail={makeDetail(b)} />
        ))}
        {plan.orderFills.map((f) => (
          <MakeRow key={f.product} label={`Fill ${countOf(f.product, f.units)}`} detail={`uses ${f.recipeSource}`} />
        ))}
        {plan.sheetProblems.map((p) => (
          <div key={p.item} className="border-t border-zinc-200 py-3.5">
            <b className="block text-[21px] first-letter:uppercase">{p.item}</b>
            <span className="text-base font-bold text-red-700">Can&apos;t plan this: it {p.problem}</span>
          </div>
        ))}
      </Step>

      {plan.refillLevels.length > 0 && (
        <Step
          n={4}
          title="Refill reserves if you want"
          hint="Where each reserve ends up after orders. Your call how much to refill."
        >
          {plan.refillLevels.map((r) => {
            const { main, detail } = refillAction(r, plan.refillLevels);
            return (
              <div
                key={r.entity}
                className="grid grid-cols-1 items-center gap-x-5 gap-y-1.5 border-t border-zinc-200 py-3.5 sm:grid-cols-[1fr_1.2fr_auto]"
              >
                <b className="first-letter:uppercase">{r.entity}</b>
                <div>
                  <div className="h-4 overflow-hidden rounded bg-zinc-200">
                    <div className="h-full bg-zinc-900" style={{ width: `${Math.min(100, (r.level / r.amt) * 100)}%` }} />
                  </div>
                  <div className="mt-1 text-base text-zinc-600">
                    {roundDisplay(r.level)} of {amount(r.amt, r.amtUnit)}
                  </div>
                </div>
                <div className="font-bold sm:min-w-[190px] sm:text-right">
                  {main}
                  {detail && <div className="text-base font-normal text-zinc-600">{detail}</div>}
                </div>
              </div>
            );
          })}
        </Step>
      )}
    </main>
  );
}
