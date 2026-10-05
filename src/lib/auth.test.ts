import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, safeEqual, sessionSecret, verifySessionToken } from "@/lib/auth";

const SECRET = "test-secret";
const NOW = Date.UTC(2026, 9, 4);
const DAY = 24 * 60 * 60 * 1000;

test("a session token verifies until it expires", () => {
  const token = createSessionToken(SECRET, NOW);
  assert.match(token, /^\d+\.[0-9a-f]{64}$/);
  assert.equal(verifySessionToken(token, SECRET, NOW), true);
  assert.equal(verifySessionToken(token, SECRET, NOW + 29 * DAY), true);
  assert.equal(verifySessionToken(token, SECRET, NOW + 31 * DAY), false);
});

test("tampered, wrong-secret, or malformed tokens are rejected", () => {
  const token = createSessionToken(SECRET, NOW);
  const [expires, sig] = token.split(".");
  const flipped = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
  assert.equal(verifySessionToken(`${expires}.${flipped}`, SECRET, NOW), false);
  assert.equal(verifySessionToken(`${Number(expires) + DAY}.${sig}`, SECRET, NOW), false);
  assert.equal(verifySessionToken(token, "other-secret", NOW), false);
  assert.equal(verifySessionToken(token, undefined, NOW), false);
  assert.equal(verifySessionToken(token, "", NOW), false);
  for (const bad of [undefined, "", "garbage", ".", `${expires}.`, `.${sig}`]) {
    assert.equal(verifySessionToken(bad, SECRET, NOW), false);
  }
});

test("safeEqual compares strings of any length", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", ""), true);
});

test("sessionSecret needs both env vars and changes with the passphrase", () => {
  const saved = { a: process.env.AUTH_SECRET, p: process.env.APP_PASSPHRASE };
  try {
    process.env.AUTH_SECRET = "s";
    process.env.APP_PASSPHRASE = "one";
    const first = sessionSecret();
    const token = createSessionToken(first!, NOW);
    process.env.APP_PASSPHRASE = "two";
    assert.equal(verifySessionToken(token, sessionSecret(), NOW), false);
    delete process.env.AUTH_SECRET;
    assert.equal(sessionSecret(), undefined);
  } finally {
    if (saved.a === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = saved.a;
    if (saved.p === undefined) delete process.env.APP_PASSPHRASE; else process.env.APP_PASSPHRASE = saved.p;
  }
});
