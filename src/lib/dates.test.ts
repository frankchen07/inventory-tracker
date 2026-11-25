import { test } from "node:test";
import assert from "node:assert/strict";
import { shortDate, todayISO } from "@/lib/dates";

test("todayISO uses the shop's Pacific calendar day, not UTC", () => {
  assert.equal(todayISO(new Date("2026-10-05T02:00:00Z")), "2026-10-04");
  assert.equal(todayISO(new Date("2026-10-05T08:00:00Z")), "2026-10-05");
  // PST (UTC-8) after the November DST change.
  assert.equal(todayISO(new Date("2026-11-10T07:30:00Z")), "2026-11-09");
  assert.equal(todayISO(new Date("2026-11-10T08:30:00Z")), "2026-11-10");
});

test("shortDate reads like a calendar day", () => {
  assert.equal(shortDate("2026-10-15"), "Oct 15");
  assert.equal(shortDate("2026-03-01"), "Mar 1");
});

test("shortDate shows anything that isn't a real YYYY-MM-DD day as typed", () => {
  for (const typed of ["11/24/2026", "11-24-2026", "2026-13-45", "2026-02-30", "soon"]) assert.equal(shortDate(typed), typed);
});
