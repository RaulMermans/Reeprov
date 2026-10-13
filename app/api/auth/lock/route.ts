import { NextResponse } from "next/server";
import { extractSessionToken, revokeSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";

export async function POST(request: Request): Promise<NextResponse> {
  const token = extractSessionToken(request);
  if (token) {
    revokeSessionToken(token);
  }

  const response = NextResponse.json({ ok: true, locked: true });

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
