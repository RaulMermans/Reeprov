/**
 * GET /api/runs/[runId]/canonical
 * Returns the canonical RunArtifact for a run (or an adapted legacy run if created prior to v1).
 *
 * Auth: x-agentpulse-key (AGENTPULSE_ACCESS_KEY or AGENTPULSE_INGEST_KEY)
 */

import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { getCanonicalRun } from "@/lib/core/capture/persistence";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    requireAccessKey(request);
    const { runId } = await params;

    const canonical = await getCanonicalRun(runId);
    if (!canonical) {
      return NextResponse.json(
        { message: `Run "${runId}" not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json(canonical);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
