import { test } from "node:test";
import assert from "node:assert/strict";
import { cellUpdates, mergeDateColumns, parseRows } from "@/lib/sheets";

test("parseRows drops blank rows but keeps each row's real sheet row number", () => {
  const rows = parseRows(
    [["cups", "paper"], [], ["lids", "plastic"], ["", ""], ["straws"]],
    ["item", "category"] as const,
  );
  assert.deepEqual(rows, [
    { _rowIndex: 2, item: "cups", category: "paper" },
    { _rowIndex: 4, item: "lids", category: "plastic" },
    { _rowIndex: 6, item: "straws", category: "" },
  ]);
});

test("mergeDateColumns carries forward by date and looks up by sheet row", () => {
  // Date headers out of order, a blank header column, and a blank spacer row (sheet row 3).
  const latest = mergeDateColumns([
    ["2026-09-15", "", "2026-09-01"],
    ["2 boxes", "", "1 box"],
    [],
    ["", "", "4 sleeves"],
    ["", "junk", ""],
  ]);
  assert.equal(latest.latestDate, "2026-09-15");
  assert.equal(latest.valueAtRow(2), "2 boxes");
  assert.equal(latest.valueAtRow(3), "");
  assert.equal(latest.valueAtRow(4), "4 sleeves");
  assert.equal(latest.valueAtRow(5), "");
  assert.equal(latest.valueAtRow(99), "");
});

test("mergeDateColumns with no date columns", () => {
  const latest = mergeDateColumns([]);
  assert.equal(latest.latestDate, null);
  assert.equal(latest.valueAtRow(2), "");
});

test("cellUpdates targets only the given rows, so other items in the column are left alone", () => {
  assert.deepEqual(
    cellUpdates("inventory", 6, [
      { rowIndex: 2, value: "1 box" },
      { rowIndex: 5, value: "3 packs" },
    ]),
    [
      { range: "inventory!G2", values: [["1 box"]] },
      { range: "inventory!G5", values: [["3 packs"]] },
    ],
  );
  assert.deepEqual(cellUpdates("inventory", 6, []), []);
});
