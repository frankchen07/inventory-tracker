import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUnit, parseConversion, parseReportedQuantity, parseThreshold } from "@/lib/unit-conversion";

test("normalizeUnit singularizes", () => {
  assert.equal(normalizeUnit("Boxes"), "box");
  assert.equal(normalizeUnit("pouches"), "pouch");
  assert.equal(normalizeUnit("sleeves"), "sleeve");
  assert.equal(normalizeUnit("oz"), "oz");
});

test("parseConversion handles three, two, and one level", () => {
  assert.deepEqual(parseConversion("1 box has 12 sleeves with 50 per sleeve"), [
    { unit: "box", perAtomic: 600 },
    { unit: "sleeve", perAtomic: 50 },
  ]);
  assert.deepEqual(parseConversion("1 case has 6 bottles"), [
    { unit: "case", perAtomic: 6 },
    { unit: "bottle", perAtomic: 1 },
  ]);
  assert.deepEqual(parseConversion("1 growler"), [{ unit: "growler", perAtomic: 1 }]);
  assert.deepEqual(parseConversion(""), []);
});

test("parseThreshold takes the last number", () => {
  assert.equal(parseThreshold("1 box or 12 sleeves or 600 cups"), 600);
  assert.equal(parseThreshold("none"), null);
});

test("parseReportedQuantity sums mixed units and rejects unknown ones", () => {
  const levels = parseConversion("1 box has 12 sleeves with 50 per sleeve");
  assert.equal(parseReportedQuantity("1 box and 6 sleeves", levels), 900);
  assert.equal(parseReportedQuantity("1.75 boxes", levels), 1050);
  assert.equal(parseReportedQuantity("6", levels), null);
  assert.equal(parseReportedQuantity("3 bags", levels), null);
  assert.equal(parseReportedQuantity("", levels), null);
});
