/**
 * GET /api/runs/[runId]/checkpoints
 * Returns all recorded checkpoints for a run.
 *
 * Auth: x-agentpulse-key
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

    const checkpoints =
      canonical.checkpoints && canonical.checkpoints.length > 0
        ? canonical.checkpoints
        : canonical.lineage?.checkpoint_reference
          ? [canonical.lineage.checkpoint_reference]
          : [];

    return NextResponse.json({
      run_id: runId,
      checkpoints,
      count: checkpoints.length,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
