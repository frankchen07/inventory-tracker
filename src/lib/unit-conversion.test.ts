import { test } from "node:test";
import assert from "node:assert/strict";
import { checkThreshold, normalizeUnit, parseConversion, parseReportedQuantity, parseThresholdQuantity } from "@/lib/unit-conversion";

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
  assert.deepEqual(parseConversion("1 box has 12 sleeves with 50 cups per sleeve"), [
    { unit: "box", perAtomic: 600 },
    { unit: "sleeve", perAtomic: 50 },
    { unit: "cup", perAtomic: 1 },
  ]);
  assert.deepEqual(parseConversion(""), []);
});

test("parseThresholdQuantity converts any one unit, and the first level of legacy 'or' thresholds", () => {
  const cups = parseConversion("1 box has 12 sleeves with 50 cups per sleeve");
  assert.equal(parseThresholdQuantity("10 sleeves", cups), 500);
  assert.equal(parseThresholdQuantity("500 cups", cups), 500);
  assert.equal(parseThresholdQuantity("1 box", cups), 600);
  assert.equal(parseThresholdQuantity("1 box or 12 sleeves or 600 cups", cups), 600);
  assert.equal(parseThresholdQuantity("3 packs", parseConversion("1 pack has 1120 napkins, 4 packs per box")), 3360);
  assert.equal(parseThresholdQuantity("none", cups), null);
});

test("a mixed count compares against a threshold in another unit", () => {
  const cups = parseConversion("1 box has 12 sleeves with 50 cups per sleeve");
  const count = parseReportedQuantity("1 box and 100 cups", cups);
  const threshold = parseThresholdQuantity("12 sleeves", cups);
  assert.equal(count, 700);
  assert.equal(threshold, 600);
  assert.equal(count! / 50, 14);
});

test("parseReportedQuantity sums mixed units and rejects unknown ones", () => {
  const levels = parseConversion("1 box has 12 sleeves with 50 per sleeve");
  assert.equal(parseReportedQuantity("1 box and 6 sleeves", levels), 900);
  assert.equal(parseReportedQuantity("1.75 boxes", levels), 1050);
  assert.equal(parseReportedQuantity("6", levels), null);
  assert.equal(parseReportedQuantity("3 bags", levels), null);
  assert.equal(parseReportedQuantity("", levels), null);
});

test("parseReportedQuantity won't guess between two named units", () => {
  const levels = parseConversion("1 box has 12 sleeves with 50 cups per sleeve");
  assert.equal(parseReportedQuantity("3 sleeves of cups", levels), null);
  assert.equal(parseReportedQuantity("2 full boxes", levels), 1200);
});

test("checkThreshold accepts any single quantity that converts", () => {
  const cups = "1 box has 12 sleeves with 50 cups per sleeve";
  assert.deepEqual(checkThreshold("10 sleeves", cups), { ok: true });
  assert.deepEqual(checkThreshold("500 cups", cups), { ok: true });
  assert.deepEqual(checkThreshold("1 box and 2 sleeves", cups), { ok: true });
  assert.deepEqual(checkThreshold("3 packs", "1 pack has 1120 napkins, 4 packs per box"), { ok: true });
  assert.deepEqual(checkThreshold("1 bottle", "1 bottle is 32 oz, no case breakdown"), { ok: true });
});

test("checkThreshold rejects what wouldn't convert, naming the valid units", () => {
  const cups = "1 box has 12 sleeves with 50 cups per sleeve";
  const bags = checkThreshold("2 bags", cups);
  assert.equal(bags.ok, false);
  assert.match(!bags.ok ? bags.reason : "", /box, sleeve, cup/);
  assert.equal(checkThreshold("2 boxes of cups", "1 box has 192 cups").ok, false);
  assert.equal(checkThreshold("1 box or 12 sleeves", cups).ok, false);
  assert.equal(checkThreshold("", cups).ok, false);
  assert.equal(checkThreshold("1 box", "").ok, false);
});
