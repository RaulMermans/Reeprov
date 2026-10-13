import { NextResponse } from "next/server";
// Migrated from requireAccessKey to authorizeRequest
import { authorizeRequest } from "@/lib/auth/accessControl";
import { extractSessionToken, verifySessionToken } from "@/lib/auth/session";

export async function POST(request: Request): Promise<NextResponse> {
  // Check session cookie first
  const sessionToken = extractSessionToken(request);
  if (sessionToken && verifySessionToken(sessionToken)) {
    return NextResponse.json({ ok: true, scope: "dashboard" }, { status: 200 });
  }

  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    return NextResponse.json({ ok: true, scope: "dashboard" }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid access key." }, { status: 401 });
  }
}

