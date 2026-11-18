import { google, sheets_v4 } from "googleapis";

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;

// "inventory" is the single source of truth: columns A-E are the fixed
// catalog (item, category, supplier, unit conversion, threshold), and every
// column from F onward is a date-headered count column, oldest to newest
// left to right. There is no separate history tab — a recorded count *is* a
// new column here.
export const CATALOG_SHEET = "inventory";
export const CATALOG_HEADERS = ["item", "category", "supplier", "unitConversion", "threshold"] as const;

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

// Money tracking for the inventory side. Separate tabs rather than extra
// columns on "inventory", whose columns after threshold are all read as
// count dates. Listing an item in "a items" is what makes it counted weekly;
// unitCost is dollars per top-level pack (box, bottle, bag).
export const A_ITEMS_SHEET = "a items";
export const A_ITEMS_HEADERS = ["item", "unitCost"] as const;

export const PURCHASES_SHEET = "purchases";
export const PURCHASES_HEADERS = ["date", "store", "item", "quantity", "cost", "notes"] as const;

// Eyeballed items someone flagged to buy; done is TRUE once bought.
export const BUY_LIST_SHEET = "buy list";
export const BUY_LIST_HEADERS = ["item", "added", "done"] as const;

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

export type SheetRow<H extends readonly string[]> = Record<H[number], string> & {
  _rowIndex: number;
};

// Row 1 is always the header row; data starts at row 2. Blank rows are
// dropped, so _rowIndex (the real sheet row) — not the position in the
// returned array — is what lines a row up with its date-column cells.
export function parseRows<H extends readonly string[]>(values: unknown[][], headers: H): SheetRow<H>[] {
  return values
    .map((row, i) => {
      const obj = { _rowIndex: i + 2 } as SheetRow<H>;
      headers.forEach((h, idx) => {
        const cell = row[idx];
        (obj as Record<string, string>)[h] = cell === undefined || cell === null ? "" : String(cell);
      });
      return obj;
    })
    .filter((row) => headers.some((h) => row[h as H[number]] !== ""));
}

export async function readRows<H extends readonly string[]>(
  sheetName: string,
  headers: H,
): Promise<SheetRow<H>[]> {
  const lastCol = columnLetter(headers.length - 1);
  const res = await getClient().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A2:${lastCol}`,
  });
  return parseRows(res.data.values ?? [], headers);
}

// Writes a whole row at a known position rather than via values.append, whose
// table detection decides the target row itself.
export async function writeRow<H extends readonly string[]>(
  sheetName: string,
  headers: H,
  rowIndex: number,
  record: Record<H[number], string>,
): Promise<void> {
  const values = headers.map((h) => record[h as H[number]] ?? "");
  await getClient().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${rowIndex}:${columnLetter(headers.length - 1)}${rowIndex}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
}

// Appends below the current last row, same reason as writeRow. Returns the
// first written row.
export async function appendRows<H extends readonly string[]>(
  sheetName: string,
  headers: H,
  records: Record<H[number], string>[],
): Promise<number> {
  const existing = await readRows(sheetName, headers);
  const first = Math.max(1, ...existing.map((r) => r._rowIndex)) + 1;
  const last = first + records.length - 1;
  await getClient().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${first}:${columnLetter(headers.length - 1)}${last}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: records.map((record) => headers.map((h) => record[h as H[number]] ?? "")) },
  });
  return first;
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

export interface LatestValues {
  // Latest non-blank value in that sheet row, "" if never counted.
  valueAtRow: (rowIndex: number) => string;
  // Header date of the column that value came from, null if never counted.
  dateAtRow: (rowIndex: number) => string | null;
  // Every non-blank count in that row, oldest first.
  historyAtRow: (rowIndex: number) => { date: string; value: string }[];
  latestDate: string | null;
}

// Merges date columns (header row first, as read from the first date column
// rightward) oldest-to-newest, so a blank cell resolves to the nearest
// earlier non-blank value for that row. This is the one place "untouched
// item = no change" gets applied — neither entry path writes carried-forward
// values into the sheet, so a blank cell always means "not recounted this time."
export function mergeDateColumns(grid: unknown[][]): LatestValues {
  const [headerRow = [], ...rows] = grid;
  const cols = headerRow
    .map((date, i) => ({ date: String(date ?? ""), i }))
    .filter((c) => c.date !== "")
    .sort((a, b) => a.date.localeCompare(b.date));

  const histories: { date: string; value: string }[][] = rows.map(() => []);
  for (const { date, i } of cols) {
    rows.forEach((row, r) => {
      const v = String(row?.[i] ?? "");
      if (v !== "") histories[r].push({ date, value: v });
    });
  }
  return {
    valueAtRow: (rowIndex) => histories[rowIndex - 2]?.at(-1)?.value ?? "",
    dateAtRow: (rowIndex) => histories[rowIndex - 2]?.at(-1)?.date ?? null,
    historyAtRow: (rowIndex) => histories[rowIndex - 2] ?? [],
    latestDate: cols.at(-1)?.date ?? null,
  };
}

export async function readLatestValues(sheetName: string, fixedColumnCount: number): Promise<LatestValues> {
  const res = await getClient().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${columnLetter(fixedColumnCount)}1:ZZ`,
  });
  return mergeDateColumns(res.data.values ?? []);
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

export interface RowCell {
  rowIndex: number;
  value: string;
}

// One range per cell, so rows not passed in — including items already
// counted earlier the same day — are never touched.
export function cellUpdates(sheetName: string, colIndex: number, cells: RowCell[]): sheets_v4.Schema$ValueRange[] {
  const col = columnLetter(colIndex);
  return cells.map(({ rowIndex, value }) => ({ range: `${sheetName}!${col}${rowIndex}`, values: [[value]] }));
}

export async function writeCells(
  colIndex: number,
  cells: RowCell[],
  sheetName: string = CATALOG_SHEET,
): Promise<void> {
  if (cells.length === 0) return;
  await getClient().spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: "USER_ENTERED", data: cellUpdates(sheetName, colIndex, cells) },
  });
}
