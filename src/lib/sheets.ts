import { google, sheets_v4 } from "googleapis";

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;

// "inventory" is the single source of truth: columns A-E are the fixed
// catalog (item, category, supplier, unit conversion, threshold), and every
// column from F onward is a date-headered count column, oldest to newest
// left to right. There is no separate scan/history tab — a confirmed count
// *is* a new column here.
export const CATALOG_SHEET = "inventory";
export const CATALOG_HEADERS = ["item", "category", "supplier", "unitConversion", "threshold"] as const;

// Lightweight receipt linking a count date to its source photo — not an
// audit log, just enough to go check the original photo if a number looks off.
export const SCAN_PHOTOS_SHEET = "scan photos";
export const SCAN_PHOTOS_HEADERS = ["date", "photoUrl"] as const;

// Production planning tabs. Frank creates these by hand with the header row
// already in place. readRows maps columns by position, not by name, so each
// *_HEADERS order must match its tab's real header row exactly.
export const RECIPES_SHEET = "recipes";
export const RECIPES_HEADERS = ["recipe", "category", "recipeOzYieldQty"] as const;

export const PRODUCTS_SHEET = "products";
// unitOz: the product's own physical size in oz, for display only (blank
// defaults to ozRecipeSourceNeeded) — differs from ozRecipeSourceNeeded when
// the product is diluted, e.g. a nitro keg holds 640oz of finished drink but
// only consumes 128oz of concentrate. recipeSource: the recipe this product
// is filled from directly — every product sources a recipe, never another
// product.
export const PRODUCTS_HEADERS = ["product", "unitOz", "recipeSource", "ozRecipeSourceNeeded"] as const;

// See StandingOrder in types.ts for what each column means.
export const STANDING_ORDERS_SHEET = "standing orders";
export const STANDING_ORDERS_HEADERS = ["customer", "item", "quantity", "quantityUnit", "dayOfWeek", "anchorDate", "intervalWeeks", "active", "channel"] as const;

// See OneOffOrder in types.ts.
export const ORDERS_SHEET = "a la carte orders";
export const ORDERS_HEADERS = ["date", "customer", "item", "quantity", "quantityUnit", "channel", "active", "notes"] as const;

// Running reserve-level tracking for finished/semi-finished production goods
// — shaped exactly like "inventory": fixed catalog columns, then one date
// column per periodic physical count.
export const RESERVE_STOCK_SHEET = "reserve stock";
export const RESERVE_STOCK_HEADERS = ["entity", "entityType", "amt", "amtUnit"] as const;

let client: sheets_v4.Sheets | null = null;

function getClient(): sheets_v4.Sheets {
  if (!client) {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    client = google.sheets({ version: "v4", auth });
  }
  return client;
}

// A, B, ... Z, AA, AB, ... — plenty of headroom as date columns accumulate.
export function columnLetter(index: number): string {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

export type SheetRow<H extends readonly string[]> = Record<H[number], string>;

// Row 1 is always the header row; data starts at row 2.
export async function readRows<H extends readonly string[]>(
  sheetName: string,
  headers: H,
): Promise<SheetRow<H>[]> {
  const lastCol = columnLetter(headers.length - 1);
  const res = await getClient().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A2:${lastCol}`,
  });
  const values = res.data.values ?? [];
  return values
    .map((row) => {
      const obj = {} as SheetRow<H>;
      headers.forEach((h, idx) => {
        const cell = row[idx];
        (obj as Record<string, string>)[h] = cell === undefined || cell === null ? "" : String(cell);
      });
      return obj;
    })
    .filter((row) => headers.some((h) => row[h as H[number]] !== ""));
}

export async function appendRow<H extends readonly string[]>(
  sheetName: string,
  headers: H,
  record: Record<H[number], string>,
): Promise<void> {
  const values = headers.map((h) => record[h as H[number]] ?? "");
  await getClient().spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:A`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
}

export async function ensureSheetWithHeaders<H extends readonly string[]>(
  sheetName: string,
  headers: H,
): Promise<void> {
  const sheets = getClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = spreadsheet.data.sheets?.some((s) => s.properties?.title === sheetName);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
  }

  const existingHeaderRow = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1:${columnLetter(headers.length - 1)}1`,
  });
  if (existingHeaderRow.data.values?.length) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[...headers]] },
  });
}

export interface DateColumn {
  date: string;
  colIndex: number;
}

// Date columns start right after a sheet's fixed catalog columns and run
// left-to-right, oldest first. Defaults match "inventory" (index
// CATALOG_HEADERS.length, i.e. column F); pass sheetName/fixedColumnCount to
// reuse this against another sheet shaped the same way, e.g. "reserve stock".
export async function listDateColumns(
  sheetName: string = CATALOG_SHEET,
  fixedColumnCount: number = CATALOG_HEADERS.length,
): Promise<DateColumn[]> {
  const startCol = columnLetter(fixedColumnCount);
  const res = await getClient().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${startCol}1:ZZ1`,
  });
  const headerRow = res.data.values?.[0] ?? [];
  return headerRow
    .map((date, i) => ({ date: String(date ?? ""), colIndex: fixedColumnCount + i }))
    .filter((c) => c.date !== "");
}

// Reads every date column of a date-columned sheet in one request and merges
// them oldest-to-newest, so a blank cell resolves to the nearest earlier
// non-blank value for that row. This is the one place "untouched item = no
// change" gets applied — neither entry path writes carried-forward values
// into the sheet, so a blank cell always means "not recounted this time."
// values[i] is data row i (sheet row i+2), "" if never counted.
export async function readLatestValues(
  sheetName: string,
  fixedColumnCount: number,
): Promise<{ values: string[]; latestDate: string | null }> {
  const res = await getClient().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${columnLetter(fixedColumnCount)}1:ZZ`,
  });
  const [headerRow = [], ...rows] = res.data.values ?? [];
  const cols = headerRow
    .map((date, i) => ({ date: String(date ?? ""), i }))
    .filter((c) => c.date !== "")
    .sort((a, b) => a.date.localeCompare(b.date));

  const values = rows.map(() => "");
  for (const { i } of cols) {
    rows.forEach((row, r) => {
      const v = String(row?.[i] ?? "");
      if (v !== "") values[r] = v;
    });
  }
  return { values, latestDate: cols.at(-1)?.date ?? null };
}

// Finds the column for a given date, creating it (as a new header cell one
// past the last existing date column) if it doesn't exist yet.
export async function getOrCreateDateColumn(
  date: string,
  sheetName: string = CATALOG_SHEET,
  fixedColumnCount: number = CATALOG_HEADERS.length,
): Promise<number> {
  const cols = await listDateColumns(sheetName, fixedColumnCount);
  const existing = cols.find((c) => c.date === date);
  if (existing) return existing.colIndex;

  const nextIndex = fixedColumnCount + cols.length;
  await getClient().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${columnLetter(nextIndex)}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[date]] },
  });
  return nextIndex;
}

// values[i] lands in row i+2 (row 1 is the header). Pass one value per
// catalog row, in catalog order — callers are responsible for carry-forward.
export async function writeColumnValues(
  colIndex: number,
  values: string[],
  sheetName: string = CATALOG_SHEET,
): Promise<void> {
  const col = columnLetter(colIndex);
  await getClient().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${col}2:${col}${values.length + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: values.map((v) => [v]) },
  });
}
