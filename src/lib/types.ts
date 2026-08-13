export const TRACKING_UNITS = [
  "box",
  "sleeve",
  "pack",
  "bag",
  "bottle",
  "roll",
  "tank",
  "individual",
] as const;
export type TrackingUnit = (typeof TRACKING_UNITS)[number];

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  trackingUnit: TrackingUnit;
  unitsPerContainer: number | null;
  currentQuantity: number;
  reorderThreshold: number;
  purchaseLocation: string;
  lastCountedAt: string | null;
}

export const SCAN_STATUSES = ["draft", "confirmed"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export interface Scan {
  id: string;
  scanDate: string;
  photoUrl: string | null;
  ocrRawJson: string | null;
  status: ScanStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface ScanLineItem {
  id: string;
  scanId: string;
  inventoryItemId: string;
  reportedQuantity: number | null;
  reportedUnit: string | null;
  confidence: number;
  ambiguous: boolean;
  notes: string | null;
}
