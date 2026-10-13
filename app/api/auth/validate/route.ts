import { NextResponse } from "next/server";
import { AccessKeyError, requireAccessKey } from "@/lib/auth/requireAccessKey";
import { extractSessionToken, verifySessionToken } from "@/lib/auth/session";
import { getOperatingMode, isLoopbackRequest } from "@/lib/auth/operatingMode";

export async function POST(request: Request): Promise<NextResponse> {
  // Check session cookie first
  const sessionToken = extractSessionToken(request);
  if (sessionToken && verifySessionToken(sessionToken)) {
    return NextResponse.json({ ok: true, scope: "dashboard" }, { status: 200 });
  }

  try {
    requireAccessKey(request);
    return NextResponse.json({ ok: true, scope: "dashboard" }, { status: 200 });
  } catch (error) {
    if (error instanceof AccessKeyError) {
      return NextResponse.json({ ok: false, error: "Invalid access key." }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: "Invalid access key." }, { status: 401 });
  }
}
