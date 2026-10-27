/**
 * GET  /api/runs/[runId]/checkpoints
 *   Registered/legacy checkpoints with a restorability assessment each, plus
 *   checkpoint observations (never restorable).
 *   Auth: x-reeprov-key (dashboard read)
 *
 * POST /api/runs/[runId]/checkpoints
 *   Body { kind: "register", ...RegisterCheckpointInput }  — restorable-checkpoint capture
 *   Body { kind: "observe", checkpoint_id, ... }           — observation only
 *   Auth: x-reeprov-key (ingest key scoped to the run's project)
 *   201 REGISTERED / REGISTERED_NOT_RESTORABLE / OBSERVATION_RECORDED,
 *   200 DUPLICATE, 4xx REJECTED with a specific code.
 */

import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { getRunStore, requireIngestAuth } from "@/lib/db/getStores";
import { getCanonicalRun } from "@/lib/core/capture/persistence";
import { observeCheckpoint, registerCheckpoint } from "@/lib/core/capture/checkpointRegistration";
import { assessCheckpoint, verifiedResumesFrom } from "@/lib/core/fork/restorability";
import { getChildren } from "@/lib/core/fork/lineage";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const { runId } = await params;

    const canonical = await getCanonicalRun(runId);
    if (!canonical) {
      return NextResponse.json({ message: `Run "${runId}" not found.` }, { status: 404 });
    }

    const checkpoints =
      canonical.checkpoints && canonical.checkpoints.length > 0
        ? canonical.checkpoints
        : canonical.lineage?.checkpoint_reference
          ? [canonical.lineage.checkpoint_reference]
          : [];
    const verifiedResumes = verifiedResumesFrom(await getChildren(runId));

    return NextResponse.json({
      run_id: runId,
      checkpoints,
      assessments: checkpoints.map((c) => assessCheckpoint(canonical, c, { verifiedResumes })),
      observations: canonical.checkpoint_observations ?? [],
      count: checkpoints.length,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireIngestAuth(request, "POST /api/runs/[runId]/checkpoints");
    const { runId } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    const run = await getRunStore().getRun(runId);
    const ownedByScope = !auth.integration || run?.runRecord.project_id === auth.integration.projectId;
    if (!run || !ownedByScope) {
      return NextResponse.json(
        { status: "REJECTED", code: "RUN_NOT_FOUND", message: `Run "${runId}" not found or not owned by integration scope.` },
        { status: 404 },
      );
    }

    const kind = body["kind"];
    const result =
      kind === "register" ? await registerCheckpoint(runId, body, run)
        : kind === "observe" ? await observeCheckpoint(runId, body, run)
          : (() => { throw invalidRequest('kind must be "register" or "observe".'); })();

    const status =
      result.status === "REJECTED"
        ? result.code === "CHECKPOINT_ID_CONFLICT" || result.code === "RUN_NOT_RUNNING" ? 409 : 422
        : result.status === "DUPLICATE" ? 200 : 201;
    return NextResponse.json(result, { status });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
