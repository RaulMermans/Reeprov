import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getOperatingMode } from "@/lib/auth/operatingMode";
import { createSessionToken, getSessionCookieOptions, isRequestHttps } from "@/lib/auth/session";

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) return false;
  return timingSafeEqual(leftBuf, rightBuf);
}

export async function POST(request: Request): Promise<NextResponse> {
  const mode = getOperatingMode();

  // In PERSONAL_LOCAL mode, unlock is a no-op that always succeeds
  if (mode === "personal_local") {
    return NextResponse.json({
      ok: true,
      mode: "personal_local",
      message: "PERSONAL_LOCAL mode requires no authentication for loopback access.",
    });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { accessKey?: string };
    const provided = body.accessKey || request.headers.get("x-reeprov-key") || request.headers.get("x-agentpulse-key");

    const expected = process.env.REEPROV_ACCESS_KEY ?? process.env.AGENTPULSE_ACCESS_KEY;
    if (!expected) {
      return NextResponse.json(
        { ok: false, error: "REEPROV_ACCESS_KEY is not configured on this self-hosted server." },
        { status: 500 }
      );
    }

    if (!provided || !constantTimeEqual(provided.trim(), expected.trim())) {
      return NextResponse.json(
        { ok: false, error: "Invalid access key." },
        { status: 401 }
      );
    }

    const isHttps = isRequestHttps(request);
    const requireHttps = (process.env.REEPROV_REQUIRE_HTTPS ?? process.env.AGENTPULSE_REQUIRE_HTTPS) === "true";
    if (requireHttps && !isHttps) {
      return NextResponse.json(
        { ok: false, error: "HTTPS is required for self-hosted browser sessions. Connect via HTTPS or provide X-Forwarded-Proto: https." },
        { status: 403 }
      );
    }

    // Generate secure bounded HttpOnly session token
    const token = createSessionToken();
    const cookieOpts = getSessionCookieOptions(isHttps);

    const response = NextResponse.json({
      ok: true,
      mode,
      scope: "dashboard",
    });

    response.cookies.set({
      name: cookieOpts.name ?? "reeprov_session",
      value: token,
      httpOnly: true,
      secure: cookieOpts.secure ?? false,
      sameSite: (cookieOpts.sameSite as "lax") ?? "lax",
      path: "/",
      maxAge: cookieOpts.maxAge,
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
