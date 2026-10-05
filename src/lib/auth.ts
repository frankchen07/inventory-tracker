import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "inventory_auth";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

// Hashing first gives equal-length buffers, which timingSafeEqual requires.
export function safeEqual(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

// Keyed on the passphrase too, so changing it logs everyone out.
export function sessionSecret(): string | undefined {
  const { AUTH_SECRET, APP_PASSPHRASE } = process.env;
  return AUTH_SECRET && APP_PASSPHRASE ? `${AUTH_SECRET}:${APP_PASSPHRASE}` : undefined;
}

function sign(expires: string, secret: string): string {
  return createHmac("sha256", secret).update(expires).digest("hex");
}

export function createSessionToken(secret: string, now = Date.now()): string {
  const expires = String(now + SESSION_MAX_AGE_SECONDS * 1000);
  return `${expires}.${sign(expires, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string | undefined, now = Date.now()): boolean {
  if (!token || !secret) return false;
  const [expires, signature] = token.split(".");
  if (!/^\d+$/.test(expires ?? "") || !signature) return false;
  return safeEqual(signature, sign(expires, secret)) && Number(expires) > now;
}
