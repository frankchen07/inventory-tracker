import Link from "next/link";
import { computeProductionPlan } from "@/lib/production";
import type { BatchRequirement, DemandLine, ReserveLevel } from "@/lib/types";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  concentrate: "Brew concentrate",
  beans: "Roast beans",
  ingredient: "Make ingredients",
  purchase: "Purchase",
};

// Preferred order for the trailing category sections (see byCategory below)
// — anything not listed here still renders, just after these and under its
// own raw category name, so a typo'd or future category can never silently
// vanish from the page the way "roast" mis-typed as "order" once did.
const CATEGORY_ORDER = ["beans", "purchase"];

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

function formatDayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" });
  return `${weekday} ${m}/${d}`;
}

// Tap/click-friendly popover for an "explain this section" hint — a native
// <details>/<summary> disclosure needs no client-side JS at all (unlike a
// title="..." tooltip, which only opens on hover and never fires on mobile
// tap), so this stays a plain server-rendered component.
function InfoTooltip({ text }: { text: string }) {
  return (
    <details className="relative inline-block">
      <summary className="cursor-help list-none text-xs text-zinc-400 [&::-webkit-details-marker]:hidden">
        &#9432;
      </summary>
      <span className="absolute left-0 top-5 z-10 w-56 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-zinc-600 shadow-md">
        {text}
      </span>
    </details>
  );
}

function batchHeadline(b: BatchRequirement): string {
  const yieldQty = b.batchesNeeded * b.recipeOzYieldQty;
  if (b.category === "beans") return `Roast ${Math.round(yieldQty / 16)} lbs`;
  if (b.category === "purchase") return `Order ${b.batchesNeeded}`;
  return `Make ${b.batchesNeeded} batch${b.batchesNeeded === 1 ? "" : "es"}`;
}

// Reserve rows show a friendly, fractional native unit as the primary figure
// wherever one exists (a product's own kegs/bottles, or — for "beans"
// recipes — pounds), with oz kept only as a secondary reference when it's
// not already redundant with the primary. This is a pure on-hand-vs-target
// snapshot — the actionable "how much to make" figure lives in "Also make"/
// "To make Mon/Tue" instead, so no shortfall figure is shown here.
function reserveRowDisplay(r: ReserveLevel): { primary: string; secondary: string | null } {
  if (r.entityType === "product") {
    return {
      primary: `${r.onHand} / ${r.amt} ${r.amtUnit}`,
      secondary: `${ceilDisplay(r.onHandOz)} / ${ceilDisplay(r.amtOz)} oz`,
    };
  }
  if (r.category === "beans") {
    return {
      primary: `${roundDisplay(r.onHand / 16)} / ${roundDisplay(r.amt / 16)} lbs`,
      secondary: `${ceilDisplay(r.onHandOz)} / ${ceilDisplay(r.amtOz)} oz`,
    };
  }
  return {
    primary: `${r.onHand} / ${r.amt} ${r.amtUnit}`,
    secondary: null,
  };
}

function BatchCard({ b }: { b: BatchRequirement }) {
  const headline = batchHeadline(b);
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <span className="font-medium text-zinc-900">{b.recipeProduct}</span>
      <span className="text-zinc-900">
        {headline} <span className="text-zinc-400">({ceilDisplay(b.totalNeededQty)} {b.unit} needed)</span>
      </span>
    </li>
  );
}

export default async function ProductionPage() {
  const plan = await computeProductionPlan();

  const byCategory = new Map<string, BatchRequirement[]>();
  for (const b of plan.batches) {
    const list = byCategory.get(b.category) ?? [];
    list.push(b);
    byCategory.set(b.category, list);
  }

  // Everything except concentrate/ingredient (which have fixed positions
  // around "Also make" below) renders here, in CATEGORY_ORDER's preference
  // order, then anything else alphabetically — so a category nobody's
  // labeled yet still shows up instead of silently disappearing.
  const trailingCategories = [...byCategory.keys()]
    .filter((c) => c !== "concentrate" && c !== "ingredient")
    .sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });

  const popupLines = plan.demand.filter((l) => l.channel === "popup");
  const clientLines = plan.demand.filter((l) => l.channel !== "popup");

  // displayUnit is taken from whichever line for an item is seen first and
  // never re-derived per line — safe because it depends only on `item`
  // (via amtUnitByEntity/productsByRecipe in fillOz(), fixed per plan), so
  // every line sharing an item necessarily agrees, *unless* a product name
  // and a recipe name were to collide (not expected — they're distinct
  // sheets/columns in practice). Same pre-existing assumption `oz`/
  // `displayQty` summation above already relies on for `item` grouping.
  const popupTotals = new Map<string, { oz: number; displayQty: number | null; displayUnit: string | null }>();
  for (const line of popupLines) {
    const prior = popupTotals.get(line.item) ?? { oz: 0, displayQty: 0, displayUnit: line.displayUnit };
    popupTotals.set(line.item, {
      oz: prior.oz + line.oz,
      displayQty: prior.displayQty === null || line.displayQty === null ? null : prior.displayQty + line.displayQty,
      displayUnit: prior.displayUnit,
    });
  }
  const popupItems = [...popupTotals.keys()].sort((a, b) => a.localeCompare(b));

  const clientSorted = [...clientLines].sort(
    (a: DemandLine, b: DemandLine) => a.forDate.localeCompare(b.forDate) || a.customer.localeCompare(b.customer),
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Production</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Covers orders through {formatDayLabel(plan.windowEnd)}
          </p>
        </div>
        <Link
          href="/"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Inventory dashboard
        </Link>
      </div>

      <p className="mt-8 text-xs font-semibold uppercase tracking-wide text-zinc-400">This week</p>
      <div className="mt-2 rounded-lg border border-zinc-200">
        <h2 className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-900">
          This week&apos;s Midwife popup
        </h2>
        {popupItems.length === 0 ? (
          <p className="px-4 py-3 text-sm text-zinc-500">Nothing planned for the popup this week.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {popupItems.map((item) => {
              const t = popupTotals.get(item)!;
              return (
                <li key={item} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
                  <span className="text-zinc-900">{item}</span>
                  <span className="text-zinc-500">
                    {t.displayQty !== null
                      ? `${roundDisplay(t.displayQty)}${t.displayUnit ? ` ${t.displayUnit}` : ""}`
                      : `${ceilDisplay(t.oz)} oz`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200">
        <h2 className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-900">
          This week&apos;s deliveries &amp; events
        </h2>
        {clientSorted.length === 0 ? (
          <p className="px-4 py-3 text-sm text-zinc-500">Nothing scheduled for clients this week.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {clientSorted.map((line, i) => (
              <li key={`${line.customer}-${line.item}-${i}`} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
                <span className="text-zinc-900">{line.customer}</span>
                <span className="text-zinc-500">
                  {line.quantityUnit === "oz" ? (
                    <>{line.item} <span className="text-zinc-400">({ceilDisplay(line.oz)} oz)</span></>
                  ) : (
                    <>
                      {line.item} &times; {line.quantity}{" "}
                      <span className="text-zinc-400">({ceilDisplay(line.oz)} oz)</span>
                    </>
                  )}{" "}
                  <span className="text-zinc-400">({formatDayLabel(line.forDate)})</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {plan.upcomingDemand.length > 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300">
          <h2 className="border-b border-dashed border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-500">
            Heads up &mdash; next week
          </h2>
          <ul className="divide-y divide-zinc-100">
            {plan.upcomingDemand.map((line, i) => (
              <li key={`${line.customer}-${line.item}-${i}`} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
                <span className="text-zinc-700">{line.customer}</span>
                <span className="text-zinc-400">
                  {line.quantityUnit === "oz" ? (
                    <>{line.item} <span className="text-zinc-400">({ceilDisplay(line.oz)} oz)</span></>
                  ) : (
                    <>
                      {line.item} &times; {line.quantity} ({ceilDisplay(line.oz)} oz)
                    </>
                  )}{" "}
                  ({formatDayLabel(line.forDate)})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-zinc-200">
        <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-2">
          <h2 className="text-sm font-semibold text-zinc-900">Reserve</h2>
          <Link href="/production/reserve-count" className="text-xs font-medium text-zinc-500 hover:text-zinc-900">
            Log count
          </Link>
        </div>
        <ul className="divide-y divide-zinc-100">
          {plan.reserveLevels.map((r) => {
            const { primary, secondary } = reserveRowDisplay(r);
            return (
              <li key={r.entity} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
                <span className="text-zinc-900">{r.entity}</span>
                <span className={r.topUpQty > 0 ? "font-medium text-amber-700" : "text-zinc-500"}>
                  {primary}
                  {secondary && <> <span className="text-zinc-400">({secondary})</span></>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-8 flex items-center gap-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">To make Mon/Tue</p>
        <InfoTooltip text="Tops up reserve stock and covers this week's Midwife popup and client deliveries" />
      </div>

      {byCategory.get("concentrate") && (
        <div className="mt-2 rounded-lg border border-zinc-200">
          <h2 className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-900">
            {CATEGORY_LABEL.concentrate}
          </h2>
          <ul className="divide-y divide-zinc-100">
            {byCategory.get("concentrate")!.map((b) => (
              <BatchCard key={b.recipeProduct} b={b} />
            ))}
          </ul>
        </div>
      )}

      {byCategory.get("ingredient") && (
        <div className="mt-6 rounded-lg border border-zinc-200">
          <h2 className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-900">
            {CATEGORY_LABEL.ingredient}
          </h2>
          <ul className="divide-y divide-zinc-100">
            {byCategory.get("ingredient")!.map((b) => (
              <BatchCard key={b.recipeProduct} b={b} />
            ))}
          </ul>
        </div>
      )}

      {plan.productRequirements.length > 0 && (
        <div className="mt-6 rounded-lg border border-zinc-200">
          <h2 className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-900">
            Also make
          </h2>
          <ul className="divide-y divide-zinc-100">
            {plan.productRequirements.map((p) => (
              <li key={p.product} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <span className="font-medium text-zinc-900">{p.product}</span>
                <span className="text-zinc-900">
                  Make {ceilDisplay(p.totalQty)}{" "}
                  <span className="text-zinc-400">({ceilDisplay(p.totalOz)} oz)</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {trailingCategories.map((category) => (
        <div key={category} className="mt-6 rounded-lg border border-zinc-200">
          <h2 className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-900">
            {CATEGORY_LABEL[category] ?? category}
          </h2>
          <ul className="divide-y divide-zinc-100">
            {byCategory.get(category)!.map((b) => (
              <BatchCard key={b.recipeProduct} b={b} />
            ))}
          </ul>
        </div>
      ))}
    </main>
  );
}
