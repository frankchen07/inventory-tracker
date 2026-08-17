// Sheet1's fixed catalog columns (A-E). Items are keyed by name — Sheet1 has
// no id column.
export interface CatalogItem {
  item: string;
  category: string;
  supplier: string;
  unitConversion: string;
  threshold: string;
}

// A catalog item currently below its threshold.
export interface RestockItem {
  item: string;
  supplier: string;
  remaining: string;
  remainingAtomic: number;
  thresholdAtomic: number;
}

// A catalog item with a recorded count that couldn't be converted to a
// number (e.g. a bare "6" with no unit) — status unknown, not "in stock."
export interface NeedsReviewItem {
  item: string;
  supplier: string;
  countText: string;
}

export interface ScanDraftLineItem {
  item: string;
  reportedQuantityText: string;
  confidence: number;
  ambiguous: boolean;
  notes: string | null;
}

// In-progress OCR result, stored as a Blob JSON object between upload and
// confirm — never written to Sheet1 until confirmed.
export interface ScanDraft {
  id: string;
  scanDate: string;
  photoUrl: string;
  lineItems: ScanDraftLineItem[];
}
