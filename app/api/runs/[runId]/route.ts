/**
 * GET /api/runs/[runId]
 * Returns the full saved run (runRecord + traceEvents + toolCalls + evalResults + artifactRefs).
 *
 * DELETE /api/runs/[runId]
 * Deletes a saved run.
 *
 * Auth: x-agentpulse-key (AGENTPULSE_ACCESS_KEY for dashboard access)
 */

import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { fileRunStore } from "@/lib/runs/runStore";
import { summarizeRun } from "@/lib/proof-layer/index";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    requireAccessKey(request);

    const { runId } = await params;
    const saved = await fileRunStore.getRun(runId);

    if (!saved) {
      return NextResponse.json(
        { message: `Run "${runId}" not found.` },
        { status: 404 },
      );
    }

    const derivedSummary = summarizeRun(saved.traceEvents, saved.evalResults);

    return NextResponse.json({
      ...saved,
      derivedSummary,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    requireAccessKey(request);

    const { runId } = await params;
    const deleted = await fileRunStore.deleteRun(runId);

    if (!deleted) {
      return NextResponse.json(
        { message: `Run "${runId}" not found or could not be deleted.` },
        { status: 404 },
      );
    }

    return NextResponse.json({ deleted: true, runId });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
