const OPENROUTER_MODEL = "anthropic/claude-opus-4.8";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface InventoryItemRef {
  inventoryItemId: string;
  name: string;
  trackingUnit: string;
}

export interface OcrLineItem {
  inventoryItemId: string;
  reportedQuantity: number | null;
  reportedUnit: string | null;
  confidence: number;
  ambiguous: boolean;
  notes: string | null;
}

export interface OcrResult {
  lineItems: OcrLineItem[];
  rawResponse: unknown;
}

const SYSTEM_PROMPT = `You transcribe a handwritten craft-roastery inventory sheet into structured data. The sheet has one row per supply item: an Item Name, a Quantity, and a Unit (box/sleeve/pack/bag/bottle/roll/tank/individual).

Quantities are often fractional, written as "1/4", "1 3/4", "1½", etc. Convert these directly to decimals in your output (0.25, 1.75, 1.5) — do not report fractions as strings.

"confidence" is an integer from 0 (no idea) to 100 (certain). Handwriting is often ambiguous — crossed-out digits, stacked numbers, unclear fractions. When you are not fully certain of a value, still give your best reading, set "ambiguous": true, set "confidence" below 70, and use "notes" to record what the ambiguity is (e.g. "could be 1/4 or 1/2", "digit crossed out, reading second attempt"). Also flag "ambiguous": true if the unit written on the sheet doesn't match the item's known unit, and explain the mismatch in "notes".

Only report a line item for inventory items that appear in the known list you were given, using the exact inventoryItemId values provided — do not invent new items. If an item's row is genuinely blank (not counted), still include it with reportedQuantity: null, confidence: 100.`;

function buildUserPrompt(items: InventoryItemRef[]): string {
  const list = items
    .map((item) => `- inventoryItemId="${item.inventoryItemId}": ${item.name} (unit: ${item.trackingUnit})`)
    .join("\n");

  return `Here is a photo of today's inventory count sheet. The known items for this roastery are:

${list}

Extract one line item per known item above. reportedQuantity should be a decimal number (e.g. 1.75 for "1 3/4"), or null if the row is blank. reportedUnit should be the unit written on the sheet next to that item, or null if none was written.`;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    lineItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          inventoryItemId: { type: "string" },
          reportedQuantity: { anyOf: [{ type: "number" }, { type: "null" }] },
          reportedUnit: { anyOf: [{ type: "string" }, { type: "null" }] },
          confidence: { type: "integer" },
          ambiguous: { type: "boolean" },
          notes: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: [
          "inventoryItemId",
          "reportedQuantity",
          "reportedUnit",
          "confidence",
          "ambiguous",
          "notes",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["lineItems"],
  additionalProperties: false,
} as const;

export async function extractInventoryFromPhoto(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
  items: InventoryItemRef[],
): Promise<OcrResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: 16000,
      reasoning: { effort: "high" },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "sheet_extraction",
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${mediaType};base64,${imageBase64}` },
            },
            { type: "text", text: buildUserPrompt(items) },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter request failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const finishReason = data.choices?.[0]?.finish_reason;
  if (finishReason === "content_filter") {
    throw new Error("The model declined to process this image.");
  }

  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("No structured output returned from OCR extraction.");
  }

  let parsed: { lineItems: OcrLineItem[] };
  try {
    parsed = JSON.parse(content) as { lineItems: OcrLineItem[] };
  } catch (err) {
    throw new Error(
      `OCR returned unparseable JSON despite the strict schema: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const knownIds = new Set(items.map((item) => item.inventoryItemId));
  const lineItems = parsed.lineItems.filter((li) => knownIds.has(li.inventoryItemId));
  const droppedCount = parsed.lineItems.length - lineItems.length;
  if (droppedCount > 0) {
    console.warn(
      `extractInventoryFromPhoto: dropped ${droppedCount} line item(s) with unrecognized inventoryItemId — the model may have read an item name that doesn't match the known catalog.`,
    );
  }

  return { lineItems, rawResponse: data };
}
