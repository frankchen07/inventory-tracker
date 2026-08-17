import { google, sheets_v4 } from "googleapis";

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;

// Sheet1 is the single source of truth: columns A-E are the fixed catalog
// (item, category, supplier, unit conversion, threshold), and every column
// from F onward is a date-headered count column, oldest to newest left to
// right. There is no separate scan/history tab — a confirmed count *is* a
// new column here.
export const CATALOG_SHEET = "Sheet1";
export const CATALOG_HEADERS = ["item", "category", "supplier", "unitConversion", "threshold"] as const;

// Lightweight receipt linking a count date to its source photo — not an
// audit log, just enough to go check the original photo if a number looks off.
export const SCAN_PHOTOS_SHEET = "Scan Photos";
export const SCAN_PHOTOS_HEADERS = ["date", "photoUrl"] as const;

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

// Row 1 is always the header row; data starts at row 2. _rowIndex lets callers
// target this exact row later without re-scanning the sheet.
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

// Date columns start right after the fixed catalog columns (index
// CATALOG_HEADERS.length, i.e. column F) and run left-to-right, oldest first.
export async function listDateColumns(): Promise<DateColumn[]> {
  const startCol = columnLetter(CATALOG_HEADERS.length);
  const res = await getClient().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${CATALOG_SHEET}!${startCol}1:ZZ1`,
  });
  const headerRow = res.data.values?.[0] ?? [];
  return headerRow
    .map((date, i) => ({ date: String(date ?? ""), colIndex: CATALOG_HEADERS.length + i }))
    .filter((c) => c.date !== "");
}

export async function getLatestDateColumn(): Promise<DateColumn | null> {
  const cols = await listDateColumns();
  if (cols.length === 0) return null;
  return [...cols].sort((a, b) => a.date.localeCompare(b.date))[cols.length - 1];
}

// Finds the column for a given date, creating it (as a new header cell one
// past the last existing date column) if it doesn't exist yet.
export async function getOrCreateDateColumn(date: string): Promise<number> {
  const cols = await listDateColumns();
  const existing = cols.find((c) => c.date === date);
  if (existing) return existing.colIndex;

  const nextIndex = CATALOG_HEADERS.length + cols.length;
  await getClient().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${CATALOG_SHEET}!${columnLetter(nextIndex)}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[date]] },
  });
  return nextIndex;
}

// rowCount excludes the header row — pass catalog.length.
export async function readColumnValues(colIndex: number, rowCount: number): Promise<string[]> {
  const col = columnLetter(colIndex);
  const res = await getClient().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${CATALOG_SHEET}!${col}2:${col}${rowCount + 1}`,
  });
  const values = res.data.values ?? [];
  return Array.from({ length: rowCount }, (_, i) => String(values[i]?.[0] ?? ""));
}

// values[i] lands in row i+2 (row 1 is the header). Pass one value per
// catalog row, in catalog order — callers are responsible for carry-forward.
export async function writeColumnValues(colIndex: number, values: string[]): Promise<void> {
  const col = columnLetter(colIndex);
  await getClient().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${CATALOG_SHEET}!${col}2:${col}${values.length + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: values.map((v) => [v]) },
  });
}
