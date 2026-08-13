import type { TrackingUnit } from "@/lib/types";

// Placeholder starting catalog covering the categories from the PRD. Names, units,
// thresholds, and purchase locations are reasonable guesses, not real counts —
// correct them directly in the "Inventory Items" sheet once real data is available.
export interface ReferenceItem {
  name: string;
  category: string;
  trackingUnit: TrackingUnit;
  unitsPerContainer: number | null;
  reorderThreshold: number;
  purchaseLocation: string;
}

export const REFERENCE_ITEMS: ReferenceItem[] = [
  // Cups & lids
  { name: "Cups 8oz", category: "Cups & Lids", trackingUnit: "pack", unitsPerContainer: 50, reorderThreshold: 5, purchaseLocation: "Costco" },
  { name: "Cups 12oz", category: "Cups & Lids", trackingUnit: "pack", unitsPerContainer: 50, reorderThreshold: 5, purchaseLocation: "Costco" },
  { name: "Cups 16oz", category: "Cups & Lids", trackingUnit: "pack", unitsPerContainer: 50, reorderThreshold: 5, purchaseLocation: "Costco" },
  { name: "Lids 8oz", category: "Cups & Lids", trackingUnit: "sleeve", unitsPerContainer: 50, reorderThreshold: 3, purchaseLocation: "Costco" },
  { name: "Lids 12oz", category: "Cups & Lids", trackingUnit: "sleeve", unitsPerContainer: 50, reorderThreshold: 3, purchaseLocation: "Costco" },
  { name: "Lids 16oz", category: "Cups & Lids", trackingUnit: "sleeve", unitsPerContainer: 50, reorderThreshold: 3, purchaseLocation: "Costco" },
  { name: "Cup Sleeves", category: "Cups & Lids", trackingUnit: "sleeve", unitsPerContainer: 100, reorderThreshold: 3, purchaseLocation: "Costco" },

  // Milk & alternatives
  { name: "Whole Milk", category: "Milk & Alternatives", trackingUnit: "box", unitsPerContainer: 6, reorderThreshold: 2, purchaseLocation: "Costco" },
  { name: "Oat Milk", category: "Milk & Alternatives", trackingUnit: "box", unitsPerContainer: 6, reorderThreshold: 2, purchaseLocation: "Costco" },
  { name: "Almond Milk", category: "Milk & Alternatives", trackingUnit: "box", unitsPerContainer: 6, reorderThreshold: 2, purchaseLocation: "Costco" },
  { name: "Soy Milk", category: "Milk & Alternatives", trackingUnit: "box", unitsPerContainer: 6, reorderThreshold: 1, purchaseLocation: "Costco" },
  { name: "Half & Half", category: "Milk & Alternatives", trackingUnit: "box", unitsPerContainer: 6, reorderThreshold: 1, purchaseLocation: "Costco" },

  // Matcha, sugar, cocoa, syrups
  { name: "Matcha Powder", category: "Matcha, Sugar & Syrups", trackingUnit: "bag", unitsPerContainer: null, reorderThreshold: 1, purchaseLocation: "Supplier A" },
  { name: "Cane Sugar", category: "Matcha, Sugar & Syrups", trackingUnit: "bag", unitsPerContainer: null, reorderThreshold: 1, purchaseLocation: "Costco" },
  { name: "Raw Sugar Packets", category: "Matcha, Sugar & Syrups", trackingUnit: "box", unitsPerContainer: 500, reorderThreshold: 1, purchaseLocation: "Costco" },
  { name: "Cocoa Powder", category: "Matcha, Sugar & Syrups", trackingUnit: "bag", unitsPerContainer: null, reorderThreshold: 1, purchaseLocation: "Supplier A" },
  { name: "Vanilla Syrup", category: "Matcha, Sugar & Syrups", trackingUnit: "bottle", unitsPerContainer: null, reorderThreshold: 2, purchaseLocation: "Supplier B" },
  { name: "Caramel Syrup", category: "Matcha, Sugar & Syrups", trackingUnit: "bottle", unitsPerContainer: null, reorderThreshold: 2, purchaseLocation: "Supplier B" },
  { name: "Hazelnut Syrup", category: "Matcha, Sugar & Syrups", trackingUnit: "bottle", unitsPerContainer: null, reorderThreshold: 2, purchaseLocation: "Supplier B" },

  // Cleaning supplies
  { name: "Espresso Machine Cleaner", category: "Cleaning Supplies", trackingUnit: "bottle", unitsPerContainer: null, reorderThreshold: 1, purchaseLocation: "Supplier A" },
  { name: "Group Head Cleaning Tablets", category: "Cleaning Supplies", trackingUnit: "pack", unitsPerContainer: 100, reorderThreshold: 1, purchaseLocation: "Supplier A" },
  { name: "Milk Frother Cleaner", category: "Cleaning Supplies", trackingUnit: "bottle", unitsPerContainer: null, reorderThreshold: 1, purchaseLocation: "Supplier A" },
  { name: "All-Purpose Cleaner", category: "Cleaning Supplies", trackingUnit: "bottle", unitsPerContainer: null, reorderThreshold: 2, purchaseLocation: "Costco" },
  { name: "Sanitizer", category: "Cleaning Supplies", trackingUnit: "bottle", unitsPerContainer: null, reorderThreshold: 2, purchaseLocation: "Costco" },
  { name: "Dish Soap", category: "Cleaning Supplies", trackingUnit: "bottle", unitsPerContainer: null, reorderThreshold: 1, purchaseLocation: "Costco" },
  { name: "Bar Towels", category: "Cleaning Supplies", trackingUnit: "pack", unitsPerContainer: 25, reorderThreshold: 1, purchaseLocation: "Costco" },

  // Tanks & growlers
  { name: "CO2 Tank", category: "Tanks & Growlers", trackingUnit: "tank", unitsPerContainer: null, reorderThreshold: 1, purchaseLocation: "Supplier C" },
  { name: "Nitro Tank", category: "Tanks & Growlers", trackingUnit: "tank", unitsPerContainer: null, reorderThreshold: 1, purchaseLocation: "Supplier C" },
  { name: "Growlers 32oz", category: "Tanks & Growlers", trackingUnit: "individual", unitsPerContainer: null, reorderThreshold: 5, purchaseLocation: "Supplier C" },
  { name: "Growlers 64oz", category: "Tanks & Growlers", trackingUnit: "individual", unitsPerContainer: null, reorderThreshold: 5, purchaseLocation: "Supplier C" },

  // Napkins & paper
  { name: "Napkins", category: "Napkins & Paper", trackingUnit: "pack", unitsPerContainer: 250, reorderThreshold: 2, purchaseLocation: "Costco" },
  { name: "Paper Towels", category: "Napkins & Paper", trackingUnit: "roll", unitsPerContainer: null, reorderThreshold: 2, purchaseLocation: "Costco" },
  { name: "Parchment Paper", category: "Napkins & Paper", trackingUnit: "roll", unitsPerContainer: null, reorderThreshold: 1, purchaseLocation: "Costco" },
  { name: "Receipt Paper Rolls", category: "Napkins & Paper", trackingUnit: "roll", unitsPerContainer: null, reorderThreshold: 3, purchaseLocation: "Supplier D" },
  { name: "To-Go Bags", category: "Napkins & Paper", trackingUnit: "pack", unitsPerContainer: 100, reorderThreshold: 2, purchaseLocation: "Supplier D" },

  // Gloves, labels, tape, misc
  { name: "Nitrile Gloves S", category: "Gloves & Labels", trackingUnit: "box", unitsPerContainer: 100, reorderThreshold: 1, purchaseLocation: "Costco" },
  { name: "Nitrile Gloves M", category: "Gloves & Labels", trackingUnit: "box", unitsPerContainer: 100, reorderThreshold: 1, purchaseLocation: "Costco" },
  { name: "Nitrile Gloves L", category: "Gloves & Labels", trackingUnit: "box", unitsPerContainer: 100, reorderThreshold: 1, purchaseLocation: "Costco" },
  { name: "Cup Labels", category: "Gloves & Labels", trackingUnit: "roll", unitsPerContainer: null, reorderThreshold: 1, purchaseLocation: "Supplier D" },
  { name: "Bag Labels", category: "Gloves & Labels", trackingUnit: "roll", unitsPerContainer: null, reorderThreshold: 1, purchaseLocation: "Supplier D" },
  { name: "Packing Tape", category: "Gloves & Labels", trackingUnit: "roll", unitsPerContainer: null, reorderThreshold: 1, purchaseLocation: "Costco" },
  { name: "Straws", category: "Gloves & Labels", trackingUnit: "pack", unitsPerContainer: 500, reorderThreshold: 2, purchaseLocation: "Costco" },
  { name: "Stir Sticks", category: "Gloves & Labels", trackingUnit: "pack", unitsPerContainer: 500, reorderThreshold: 2, purchaseLocation: "Costco" },
  { name: "Coffee Filters", category: "Gloves & Labels", trackingUnit: "pack", unitsPerContainer: null, reorderThreshold: 1, purchaseLocation: "Supplier A" },
];
