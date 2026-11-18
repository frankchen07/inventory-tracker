import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { safeEqual } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import {
  addCatalogItem,
  addPurchases,
  addToBuyList,
  findCatalogItem,
  getAItems,
  getBuyListRows,
  getCatalog,
  getInventorySnapshot,
  getPurchases,
  loadBuyList,
  markBought,
  planPurchase,
  writeCountColumn,
  writeThreshold,
} from "@/lib/inventory";
import { addOneOffOrder, findOrderItem, getProducts, getRecipes, orderUnitProblem } from "@/lib/production";
import type { CatalogItem } from "@/lib/types";
import { checkThreshold, isSuspiciousChange, parseConversion, parseReportedQuantity } from "@/lib/unit-conversion";

function result(payload: object, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }], isError };
}

// Matches each line to the catalog and checks its quantity converts; lines
// that don't are reported back, never saved, so a mis-heard name or unit
// can't land in the money numbers.
function resolveLines<T extends { item: string; quantity: string }>(catalog: CatalogItem[], lines: T[]) {
  const matched: T[] = [];
  const unrecognized: string[] = [];
  const needsUnit: { item: string; quantity: string; units: string[] }[] = [];
  for (const line of lines) {
    const match = findCatalogItem(catalog, line.item);
    if (!match) {
      unrecognized.push(line.item);
      continue;
    }
    const levels = parseConversion(match.unitConversion);
    if (parseReportedQuantity(line.quantity, levels) === null) {
      needsUnit.push({ item: match.item, quantity: line.quantity, units: levels.map((l) => l.unit) });
      continue;
    }
    matched.push({ ...line, item: match.item, quantity: line.quantity.trim() });
  }
  return { matched, unrecognized, needsUnit };
}

const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "record_inventory_count",
      {
        title: "Record inventory count",
        description:
          "Record physical counts for one or more inventory items, writing directly to the real 'inventory' Google Sheet. Only include items that were actually counted this time — omit anything unchanged, it will carry forward automatically. Translate whatever the user says into the item's packLevels units (see list_inventory_items), e.g. 'half a case' → '0.5 box'; if the unit is ambiguous, ask. Anything returned in needsUnit was saved but can't be converted — ask the user which unit they meant and record it again. Anything in checkThese was saved but is 3x or more off the previous count — read previous vs. recorded back to the user and re-record if it was mis-heard.",
        inputSchema: z.object({
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .describe("Count date as YYYY-MM-DD. Defaults to today if omitted."),
          counts: z
            .array(
              z.object({
                item: z.string().describe("Item name as it appears in the inventory catalog"),
                count: z.string().describe("Quantity in the item's units, e.g. '1.75 boxes' or '1 box and 6 sleeves'"),
              }),
            )
            .min(1),
        }),
      },
      async ({ date, counts }) => {
        const { catalog, counts: previousCounts } = await getInventorySnapshot();

        const valuesByItem = new Map<string, string>();
        const written: string[] = [];
        const unrecognized: string[] = [];
        const needsUnit: { item: string; count: string; units: string[] }[] = [];
        const checkThese: { item: string; previous: string; recorded: string }[] = [];

        for (const { item, count } of counts) {
          const match = findCatalogItem(catalog, item);
          if (!match) {
            unrecognized.push(item);
            continue;
          }
          valuesByItem.set(match.item, count);
          written.push(match.item);
          const levels = parseConversion(match.unitConversion);
          if (count.trim() !== "" && parseReportedQuantity(count, levels) === null) {
            needsUnit.push({ item: match.item, count, units: levels.map((l) => l.unit) });
          }
          const previous = previousCounts.get(match.item) ?? "";
          if (isSuspiciousChange(previous, count, levels)) {
            checkThese.push({ item: match.item, previous, recorded: count });
          }
        }

        const targetDate = date ?? todayISO();
        if (valuesByItem.size > 0) {
          await writeCountColumn(targetDate, valuesByItem, catalog);
        }

        return result({
          date: targetDate,
          written,
          unrecognized,
          ...(needsUnit.length > 0 && { needsUnit }),
          ...(checkThese.length > 0 && { checkThese }),
          ...(unrecognized.length > 0 && {
            hint: "Check list_inventory_items for a differently-worded match; only use add_inventory_item if the item is genuinely new.",
          }),
        });
      },
    );

    server.registerTool(
      "list_inventory_items",
      {
        title: "List inventory items",
        description:
          "List every item in the inventory catalog with its category, supplier, unit conversion, restock threshold, and latest recorded count. packLevels are the units the item is counted in, each with how many of the smallest unit it holds — use them to convert what the user says. Use this to find the exact catalog name for an item and to check whether an item already exists before adding it. aItem marks the items counted weekly: for a weekly count, walk the user through only the aItem items, one at a time; everything else is eyeballed and goes on the buy list by hand. For an aItem, threshold is its par — the level to buy back up to.",
        inputSchema: z.object({}),
      },
      async () => {
        const { catalog, counts, latestDate } = await getInventorySnapshot();
        const { aItems } = await getAItems(catalog);
        return result({
          latestDate,
          items: catalog.map((c) => ({
            item: c.item,
            aItem: aItems.has(c.item),
            category: c.category,
            supplier: c.supplier,
            unitConversion: c.unitConversion,
            threshold: c.threshold,
            packLevels: parseConversion(c.unitConversion),
            latestCount: counts.get(c.item) ?? "",
          })),
        });
      },
    );

    server.registerTool(
      "update_item_threshold",
      {
        title: "Update par",
        description:
          "Change the threshold for one existing inventory item. For a weekly-counted item (aItem in list_inventory_items) this is its par: the level the buy list fills it back up to. Other items aren't counted, so their threshold isn't used. Write it as one amount in any of the item's packLevels units (see list_inventory_items), e.g. '10 sleeves', '500 cups', '1 box', or '1 box and 2 sleeves' — it's converted automatically. Translate what the user says into those units and read the converted amount back to them before calling. Unconvertible thresholds are rejected with the valid units.",
        inputSchema: z.object({
          item: z.string().describe("Item name as it appears in the inventory catalog"),
          threshold: z.string().describe("New threshold, e.g. '10 sleeves'"),
        }),
      },
      async ({ item, threshold }) => {
        const match = findCatalogItem(await getCatalog(), item);
        if (!match) {
          return result({ error: `No catalog item named "${item}". Check list_inventory_items for the exact name.` }, true);
        }
        const check = checkThreshold(threshold, match.unitConversion);
        if (!check.ok) return result({ error: check.reason }, true);

        await writeThreshold(match, threshold.trim());
        return result({ item: match.item, oldThreshold: match.threshold, newThreshold: threshold.trim() });
      },
    );

    server.registerTool(
      "add_inventory_item",
      {
        title: "Add inventory item",
        description:
          "Add a new item to the inventory catalog. Only for items that are genuinely new: call list_inventory_items first and rule out a differently-worded existing item. Confirm the name, category, supplier, and pack size with the user before calling — never guess a supplier or pack size. Reuse an existing category where one fits. Threshold is optional and follows the same format as update_item_threshold; it's only used once the item is listed in the 'a items' tab. This does not record a count; call record_inventory_count afterwards for that.",
        inputSchema: z.object({
          item: z.string().min(1).describe("Item name, lowercase like the rest of the catalog, e.g. 'oat flour'"),
          category: z.string().min(1).describe("Existing category where one fits, e.g. 'consumables'"),
          supplier: z.string().min(1).describe("Where it's bought, e.g. 'costco'"),
          unitConversion: z
            .string()
            .min(1)
            .describe("Pack size, e.g. '1 box has 12 sleeves with 50 cups per sleeve', '1 box has 6 cartons', or '1 bag, no case breakdown'"),
          threshold: z.string().optional().describe("Restock threshold, e.g. '2 cartons'"),
        }),
      },
      async ({ item, category, supplier, unitConversion, threshold }) => {
        const catalog = await getCatalog();
        const existing = findCatalogItem(catalog, item);
        if (existing) {
          return result({ error: `"${existing.item}" is already in the catalog.` }, true);
        }
        const levels = parseConversion(unitConversion);
        if (levels.length === 0) {
          return result(
            { error: `Can't read unit conversion "${unitConversion}" — it must start with "1 <unit>", e.g. "1 box has 6 cartons".` },
            true,
          );
        }
        if (threshold?.trim()) {
          const check = checkThreshold(threshold, unitConversion);
          if (!check.ok) return result({ error: check.reason }, true);
        }

        const record = {
          item: item.trim(),
          category: category.trim(),
          supplier: supplier.trim(),
          unitConversion: unitConversion.trim(),
          threshold: threshold?.trim() ?? "",
        };
        const row = await addCatalogItem(catalog, record);
        return result({ added: record, row, parsedPackLevels: levels });
      },
    );

    server.registerTool(
      "add_order",
      {
        title: "Add one-off order",
        description:
          "Add a dated one-off order (catering, event, extra delivery) to the 'a la carte orders' sheet so it shows up in the production plan. Not for recurring orders — those live in the standing orders tab. Read the date, customer, item, and quantity back to the user before calling. The item must match a product or recipe name (case doesn't matter, the sheet's spelling is what gets saved); an unknown item is rejected with the valid names. For a product (e.g. a keg or bottle) quantity is a plain count and quantityUnit must be blank; for a recipe drawn in bulk quantityUnit is required: oz, lbs, or gallons.",
        inputSchema: z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date the order goes out, YYYY-MM-DD"),
          customer: z.string().min(1).describe("Who it's for, e.g. 'stanford catering'"),
          item: z.string().min(1).describe("Product or recipe name, e.g. 'nitro keg'"),
          quantity: z.number().positive().describe("How many, e.g. 2"),
          quantityUnit: z.string().optional().describe("Blank for a product count; required for a recipe: 'oz', 'lbs', or 'gallons'"),
          channel: z.enum(["client", "popup"]).optional().describe("'popup' for Boast's own popup, otherwise 'client' (default)"),
          notes: z.string().optional(),
        }),
      },
      async ({ date, customer, item, quantity, quantityUnit, channel, notes }) => {
        const [products, recipes] = await Promise.all([getProducts(), getRecipes()]);
        const match = findOrderItem(products, recipes, item);
        if (!match) {
          return result(
            {
              error: `No product or recipe named "${item}".`,
              products: products.map((p) => p.product),
              recipes: recipes.map((r) => r.recipe),
            },
            true,
          );
        }
        const unitProblem = orderUnitProblem(match.kind, quantityUnit ?? "");
        if (unitProblem) return result({ error: unitProblem }, true);

        const record = {
          date,
          customer: customer.trim(),
          item: match.name,
          quantity: String(quantity),
          quantityUnit: quantityUnit?.trim() ?? "",
          channel: channel ?? "client",
          active: "TRUE",
          notes: notes?.trim() ?? "",
        };
        const row = await addOneOffOrder(record);
        return result({
          added: record,
          kind: match.kind,
          row,
          ...(date < todayISO() && { warning: "This date is in the past, so it won't show up in the production plan." }),
        });
      },
    );

    server.registerTool(
      "record_purchase",
      {
        title: "Record purchase",
        description:
          "Log what was bought on one shopping run or delivery to the 'purchases' sheet — this is how the app knows what supplies cost. Quantities use the item's packLevels units like a count (e.g. '6 boxes'). cost is the line total off the receipt if the user has it; leave it out otherwise and the item's unit cost is used. Buying an item also closes its open buy-list entries. Unrecognized names and anything in needsUnit are not saved — check the name or unit and record it again. A line matching one already logged (same date, store, item, quantity) is skipped as a likely repeat; if it really was bought twice, confirm with the user and record it again with allowDuplicate.",
        inputSchema: z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Purchase date as YYYY-MM-DD. Defaults to today."),
          store: z.string().min(1).describe("Where it was bought, e.g. 'costco'"),
          items: z
            .array(
              z.object({
                item: z.string().describe("Item name as it appears in the inventory catalog"),
                quantity: z.string().describe("Amount in the item's units, e.g. '6 boxes'"),
                cost: z.number().nonnegative().optional().describe("Line total in dollars, if known"),
              }),
            )
            .min(1),
          allowDuplicate: z.boolean().optional().describe("Only after the user confirms a repeat purchase"),
        }),
      },
      async ({ date, store, items, allowDuplicate }) => {
        const [catalog, buyListRows, existing] = await Promise.all([getCatalog(), getBuyListRows(), getPurchases()]);
        const targetDate = date ?? todayISO();
        const { matched, unrecognized, needsUnit } = resolveLines(catalog, items);
        const { rows, skippedAsRepeat, close } = planPurchase(
          catalog,
          existing,
          buyListRows,
          matched,
          targetDate,
          store,
          allowDuplicate ?? false,
        );
        if (rows.length > 0) await addPurchases(rows);
        if (close.length > 0) await markBought(close);

        return result({
          date: targetDate,
          written: rows.map((r) => r.item),
          unrecognized,
          ...(needsUnit.length > 0 && { needsUnit }),
          ...(skippedAsRepeat.length > 0 && { skippedAsRepeat }),
          ...(close.length > 0 && { closedOnBuyList: close.map((r) => r.item) }),
        });
      },
    );

    server.registerTool(
      "add_to_buy_list",
      {
        title: "Add to buy list",
        description:
          "Put eyeballed items on the buy list (e.g. 'we're low on napkins'). No count needed. Items must be in the catalog so a later record_purchase can close them; anything else comes back in unrecognized — check list_inventory_items, or add it with add_inventory_item if it's genuinely new. Items already open on the list are skipped.",
        inputSchema: z.object({
          items: z.array(z.string().min(1)).min(1).describe("Item names, e.g. ['napkins', 'dish soap']"),
        }),
      },
      async ({ items }) => {
        const [catalog, buyListRows] = await Promise.all([getCatalog(), getBuyListRows()]);
        const open = new Set(buyListRows.filter((r) => !r.done).map((r) => findCatalogItem(catalog, r.item)?.item ?? r.item));
        const added: string[] = [];
        const alreadyOnList: string[] = [];
        const unrecognized: string[] = [];
        for (const raw of items) {
          const match = findCatalogItem(catalog, raw);
          if (!match) unrecognized.push(raw);
          else if (open.has(match.item)) alreadyOnList.push(match.item);
          else {
            added.push(match.item);
            open.add(match.item);
          }
        }
        if (added.length > 0) await addToBuyList(added, todayISO());
        return result({ added, alreadyOnList, unrecognized });
      },
    );

    server.registerTool(
      "get_buy_list",
      {
        title: "Get buy list",
        description:
          "What to buy now: weekly-counted items below par (with how many whole packs gets them back to par), plus eyeballed items added by hand, each with its supplier. Also lists weekly items never counted and anything that needs fixing in the sheet.",
        inputSchema: z.object({}),
      },
      async () => {
        const { list, unknownAItems } = await loadBuyList();
        return result({ ...list, ...(unknownAItems.length > 0 && { aItemsNotInCatalog: unknownAItems }) });
      },
    );
  },
  { serverInfo: { name: "inventory-tracker", version: "0.1.0" } },
);

function isAuthorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const expected = process.env.MCP_ACCESS_TOKEN;
  return expected ? safeEqual(token, expected) : false;
}

async function authedHandler(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return mcpHandler(request);
}

export { authedHandler as GET, authedHandler as POST };
