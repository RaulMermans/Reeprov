import { NextRequest, NextResponse } from "next/server";
import { DemoProjectManager } from "@/lib/projects/demoProject";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

export async function POST(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "ADMIN" });
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    const action = body.action || "setup";

    if (action === "reset") {
      await DemoProjectManager.resetDemoProject();
      return NextResponse.json({ ok: true, message: "Demo project reset successfully." });
    }

    const result = await DemoProjectManager.setupDemoProject();
    return NextResponse.json({
      ok: true,
      message: "Demo project setup successfully.",
      ...result,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
