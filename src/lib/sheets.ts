import { google, sheets_v4 } from "googleapis";

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;

export const INVENTORY_ITEMS_SHEET = "Inventory Items";
export const SCANS_SHEET = "Scans";
export const SCAN_LINE_ITEMS_SHEET = "Scan Line Items";

export const INVENTORY_ITEMS_HEADERS = [
  "id",
  "name",
  "category",
  "trackingUnit",
  "unitsPerContainer",
  "currentQuantity",
  "reorderThreshold",
  "purchaseLocation",
  "lastCountedAt",
] as const;

export const SCANS_HEADERS = [
  "id",
  "scanDate",
  "photoUrl",
  "ocrRawJson",
  "status",
  "reviewedBy",
  "reviewedAt",
  "createdAt",
] as const;

export const SCAN_LINE_ITEMS_HEADERS = [
  "id",
  "scanId",
  "inventoryItemId",
  "reportedQuantity",
  "reportedUnit",
  "confidence",
  "ambiguous",
  "notes",
] as const;

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

// A, B, ... Z, AA, AB, ... — plenty of headroom for our widest tab (9 columns).
function columnLetter(index: number): string {
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

export function rowRange<H extends readonly string[]>(
  sheetName: string,
  headers: H,
  rowIndex: number,
): string {
  const lastCol = columnLetter(headers.length - 1);
  return `${sheetName}!A${rowIndex}:${lastCol}${rowIndex}`;
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

export async function updateRow<H extends readonly string[]>(
  sheetName: string,
  headers: H,
  rowIndex: number,
  record: Record<H[number], string>,
): Promise<void> {
  const lastCol = columnLetter(headers.length - 1);
  const values = headers.map((h) => record[h as H[number]] ?? "");
  await getClient().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${rowIndex}:${lastCol}${rowIndex}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
}

export async function batchUpdateRows(updates: { range: string; values: string[] }[]): Promise<void> {
  if (updates.length === 0) return;
  await getClient().spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates.map((u) => ({ range: u.range, values: [u.values] })),
    },
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
