/**
 * GET /api/runs/[runId]/context-intelligence
 * Returns the derived ContextIntelligenceReport for a given run.
 * Fetches precomputed report or computes on-the-fly from the canonical run evidence.
 *
 * Auth: x-agentpulse-key (AGENTPULSE_ACCESS_KEY or AGENTPULSE_INGEST_KEY)
 */

import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { authorizeRequest, AccessControlError } from "@/lib/auth/accessControl";
import { getCanonicalRun } from "@/lib/core/capture/persistence";
import { analyzeRunContext } from "@/lib/core/intelligence/contextAnalyzer";
import {
  getContextIntelligenceReport,
  saveContextIntelligenceReport,
} from "@/lib/core/intelligence/persistence";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const { runId } = await params;

    // 1. Try to load existing report
    const existing = await getContextIntelligenceReport(runId);
    if (existing) {
      return NextResponse.json(existing);
    }

    // 2. Fetch canonical run artifact to compute report on the fly
    const canonical = await getCanonicalRun(runId);
    if (!canonical) {
      return NextResponse.json(
        { message: `Run "${runId}" not found.` },
        { status: 404 }
      );
    }

    // 3. Compute deterministic context intelligence report
    const report = analyzeRunContext(canonical);

    // 4. Persist for future fast lookup
    await saveContextIntelligenceReport(report);

    return NextResponse.json(report);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
