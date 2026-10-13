/**
 * GET /api/runs
 *
 * Lists saved run summaries. Supports optional query params:
 *   ?projectId=campaign-sandbox    — filter by project
 *   ?workflowId=campaign-rec-v1   — filter by workflow
 *   ?status=failed                 — filter by status
 *   ?limit=50                      — max results (default 50, max 200)
 *
 * Auth: x-agentpulse-key (AGENTPULSE_ACCESS_KEY for dashboard access)
 */

import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { authorizeRequest, AccessControlError } from "@/lib/auth/accessControl";
import { getRunStore } from "@/lib/db/getStores";

export async function GET(request: Request) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });

    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const workflowId = url.searchParams.get("workflowId") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.max(1, Math.min(200, parseInt(limitParam, 10))) : 50;

    const runs = await getRunStore().listRuns({ projectId, workflowId, status, limit });

    return NextResponse.json({ runs, count: runs.length });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
