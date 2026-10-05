import { test } from "node:test";
import assert from "node:assert/strict";
import { todayISO } from "@/lib/dates";

test("todayISO uses the shop's Pacific calendar day, not UTC", () => {
  assert.equal(todayISO(new Date("2026-10-05T02:00:00Z")), "2026-10-04");
  assert.equal(todayISO(new Date("2026-10-05T08:00:00Z")), "2026-10-05");
  // PST (UTC-8) after the November DST change.
  assert.equal(todayISO(new Date("2026-11-10T07:30:00Z")), "2026-11-09");
  assert.equal(todayISO(new Date("2026-11-10T08:30:00Z")), "2026-11-10");
});
