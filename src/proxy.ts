import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, sessionSecret, verifySessionToken } from "@/lib/auth";

export function proxy(request: NextRequest) {
  if (verifySessionToken(request.cookies.get(COOKIE_NAME)?.value, sessionSecret())) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/login|api/mcp|login).*)"],
};
