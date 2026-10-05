import { redirect } from "next/navigation";
import { COOKIE_NAME, SESSION_MAX_AGE_SECONDS, createSessionToken, safeEqual, sessionSecret } from "@/lib/auth";

function safeNextPath(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const passphrase = formData.get("passphrase");
  const next = safeNextPath(formData.get("next"));

  const expected = process.env.APP_PASSPHRASE;
  const secret = sessionSecret();
  if (!expected || !secret) {
    console.error("login unavailable: APP_PASSPHRASE and AUTH_SECRET must both be set");
  }
  if (!expected || !secret || typeof passphrase !== "string" || !safeEqual(passphrase, expected)) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const response = new Response(null, {
    status: 303,
    headers: { Location: next },
  });
  response.headers.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${createSessionToken(secret)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  );
  return response;
}
