import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { getCatalog, writeCountColumn } from "@/lib/inventory";

const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "record_inventory_count",
      {
        title: "Record inventory count",
        description:
          "Record physical counts for one or more inventory items, writing directly to the real 'inventory' Google Sheet. Only include items that were actually counted this time — omit anything unchanged, it will carry forward automatically.",
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
                count: z.string().describe("Reported quantity, e.g. '12' or '1.75 boxes'"),
              }),
            )
            .min(1),
        }),
      },
      async ({ date, counts }) => {
        const catalog = await getCatalog();
        const byLowerName = new Map(catalog.map((c) => [c.item.toLowerCase(), c.item]));

        const valuesByItem = new Map<string, string>();
        const written: string[] = [];
        const unrecognized: string[] = [];

        for (const { item, count } of counts) {
          const canonical = byLowerName.get(item.trim().toLowerCase());
          if (!canonical) {
            unrecognized.push(item);
            continue;
          }
          valuesByItem.set(canonical, count);
          written.push(canonical);
        }

        const targetDate = date ?? new Date().toISOString().slice(0, 10);
        if (valuesByItem.size > 0) {
          await writeCountColumn(targetDate, valuesByItem);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ date: targetDate, written, unrecognized }),
            },
          ],
        };
      },
    );
  },
  { serverInfo: { name: "inventory-tracker", version: "0.1.0" } },
);

function isAuthorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return Boolean(process.env.MCP_ACCESS_TOKEN) && token === process.env.MCP_ACCESS_TOKEN;
}

async function authedHandler(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return mcpHandler(request);
}

export { authedHandler as GET, authedHandler as POST };
