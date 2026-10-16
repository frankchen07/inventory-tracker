import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { safeEqual } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import {
  addCatalogItem,
  findCatalogItem,
  getCatalog,
  getInventorySnapshot,
  writeCountColumn,
  writeThreshold,
} from "@/lib/inventory";
import { checkThreshold, parseConversion, parseReportedQuantity } from "@/lib/unit-conversion";

function result(payload: object, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }], isError };
}

const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "record_inventory_count",
      {
        title: "Record inventory count",
        description:
          "Record physical counts for one or more inventory items, writing directly to the real 'inventory' Google Sheet. Only include items that were actually counted this time — omit anything unchanged, it will carry forward automatically. Translate whatever the user says into the item's packLevels units (see list_inventory_items), e.g. 'half a case' → '0.5 box'; if the unit is ambiguous, ask. Anything returned in needsUnit was saved but can't be converted — ask the user which unit they meant and record it again.",
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
        const catalog = await getCatalog();

        const valuesByItem = new Map<string, string>();
        const written: string[] = [];
        const unrecognized: string[] = [];
        const needsUnit: { item: string; count: string; units: string[] }[] = [];

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
          "List every item in the inventory catalog with its category, supplier, unit conversion, restock threshold, and latest recorded count. packLevels are the units the item is counted in, each with how many of the smallest unit it holds — use them to convert what the user says. Use this to find the exact catalog name for an item and to check whether an item already exists before adding it.",
        inputSchema: z.object({}),
      },
      async () => {
        const { catalog, counts, latestDate } = await getInventorySnapshot();
        return result({
          latestDate,
          items: catalog.map((c) => ({
            item: c.item,
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
        title: "Update restock threshold",
        description:
          "Change the restock threshold for one existing inventory item. Write it as one amount in any of the item's packLevels units (see list_inventory_items), e.g. '10 sleeves', '500 cups', '1 box', or '1 box and 2 sleeves' — it's converted automatically. Translate what the user says into those units and read the converted amount back to them before calling. Unconvertible thresholds are rejected with the valid units.",
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
          "Add a new item to the inventory catalog. Only for items that are genuinely new: call list_inventory_items first and rule out a differently-worded existing item. Confirm the name, category, supplier, and pack size with the user before calling — never guess a supplier or pack size. Reuse an existing category where one fits. Threshold is optional and follows the same format as update_item_threshold. This does not record a count; call record_inventory_count afterwards for that.",
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
