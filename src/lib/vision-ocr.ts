import type { CatalogItem } from "@/lib/types";

const OPENROUTER_MODEL = "anthropic/claude-opus-4.8";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OcrLineItem {
  item: string;
  reportedQuantityText: string;
  confidence: number;
  ambiguous: boolean;
  notes: string | null;
}

export interface OcrResult {
  lineItems: OcrLineItem[];
  rawResponse: unknown;
}

const SYSTEM_PROMPT = `You transcribe a handwritten inventory count sheet into structured data. The sheet has one row per supply item, each with a quantity written in the owner's own shorthand — not a plain number.

Transcribe each quantity EXACTLY as the owner would write it themselves, matching the style of these real examples: "1.75 boxes", "2 boxes", "4 sleeves", "0.25 boxes", "1 box and 6 sleeves", "3 full packs", "0.5 pack", "26 growlers". Use decimals for fractions written as "1/4", "1 3/4", etc. (0.25, 1.75). If the sheet mixes two units for one item (e.g. a full box plus a partial sleeve), write both joined with "and", e.g. "1 box and 6 sleeves". Always lowercase.

"confidence" is an integer 0 (no idea) to 100 (certain). Handwriting is often ambiguous — crossed-out digits, stacked numbers, unclear fractions. When not fully certain, still give your best reading, set "ambiguous": true, confidence below 70, and use "notes" to explain (e.g. "could be 1/4 or 1/2"). Also set "ambiguous": true whenever the sheet gives a bare number with no unit at all (e.g. just "6" or "12") — note what unit you're guessing at, since that's a real gap for a human to resolve, not just low confidence.

Only report a line item for items in the known list you were given, using the exact item name provided — do not invent new items or rename them. If an item's row is genuinely blank or not on the sheet at all, still include it with reportedQuantityText: "" and confidence: 100 — that means "not recounted this time," which is meaningfully different from a low reading.`;

function buildUserPrompt(items: CatalogItem[]): string {
  const list = items
    .map((item) => `- ${item.item} (packaging: ${item.unitConversion || "unspecified"})`)
    .join("\n");

  return `Here is a photo of today's inventory count sheet. The known items for this shop are:

${list}

Extract one line item per known item above, with reportedQuantityText written in the owner's shorthand as described.`;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    lineItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item: { type: "string" },
          reportedQuantityText: { type: "string" },
          confidence: { type: "integer" },
          ambiguous: { type: "boolean" },
          notes: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["item", "reportedQuantityText", "confidence", "ambiguous", "notes"],
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
  items: CatalogItem[],
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

  const knownNames = new Set(items.map((item) => item.item));
  const lineItems = parsed.lineItems.filter((li) => knownNames.has(li.item));
  const droppedCount = parsed.lineItems.length - lineItems.length;
  if (droppedCount > 0) {
    console.warn(
      `extractInventoryFromPhoto: dropped ${droppedCount} line item(s) with unrecognized item name — the model may have read a name that doesn't match the known catalog.`,
    );
  }

  return { lineItems, rawResponse: data };
}
