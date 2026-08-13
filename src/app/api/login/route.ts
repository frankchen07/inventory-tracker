import { redirect } from "next/navigation";

const COOKIE_NAME = "inventory_auth";

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

  if (typeof passphrase !== "string" || passphrase !== process.env.APP_PASSPHRASE) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const response = new Response(null, {
    status: 303,
    headers: { Location: next },
  });
  response.headers.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${passphrase}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
  );
  return response;
}
