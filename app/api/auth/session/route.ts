import { NextResponse } from "next/server";
import { getReeprovEnv } from "@/lib/config/env";
import { getOperatingMode, isLoopbackRequest } from "@/lib/auth/operatingMode";
import { extractSessionToken, verifySessionToken } from "@/lib/auth/session";

export async function GET(request: Request): Promise<NextResponse> {
  const mode = getOperatingMode();
  const isLocal = isLoopbackRequest(request);

  if (mode === "personal_local" && getReeprovEnv("REEPROV_ACCESS_KEY")) {
    // An access key is configured: loopback alone is not enough.
    const token = extractSessionToken(request);
    const valid = Boolean(token && verifySessionToken(token));
    return NextResponse.json({
      mode,
      isLocal,
      requiresAuth: !valid,
      authenticated: valid,
      operatorType: "personal",
    });
  }

  if (mode === "personal_local") {
    return NextResponse.json({
      mode,
      isLocal,
      requiresAuth: !isLocal,
      authenticated: isLocal,
      operatorType: "personal",
    });
  }

  if (mode === "self_hosted") {
    const token = extractSessionToken(request);
    const valid = Boolean(token && verifySessionToken(token));

    return NextResponse.json({
      mode,
      isLocal,
      requiresAuth: true,
      authenticated: valid,
      operatorType: "instance_owner",
    });
  }

  // headless_ci
  return NextResponse.json({
    mode,
    isLocal,
    requiresAuth: !isLocal,
    authenticated: isLocal,
    operatorType: "automation",
  });
}
