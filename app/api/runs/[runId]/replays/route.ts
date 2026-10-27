/**
 * GET  /api/runs/[runId]/replays — replay results recorded for a run.
 * POST /api/runs/[runId]/replays — store a replay produced by the
 *   developer-side host runner (`reeprov host-replay --upload`).
 *
 * The server never executes host code. It validates the uploaded result's
 * schema, identity and internal consistency, scrubs it under the run's
 * capture policy, and stores it as a runner-reported replay.
 *
 * Auth: x-reeprov-key (dashboard read / write)
 */

import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { getCanonicalRun } from "@/lib/core/capture/persistence";
import { capturePolicyForRun } from "@/lib/core/capture/runPolicy";
import { sanitizeCanonicalRecord } from "@/lib/core/capture/redaction";
import { replayResultSchema } from "@/lib/core/replay/contracts";
import { replayClaimErrors } from "@/lib/core/external/hostRunner";
import { listReplaysForRun, saveReplayResult } from "@/lib/core/replay/persistence";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const { runId } = await params;
    return NextResponse.json({ run_id: runId, replays: await listReplaysForRun(runId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });
    const { runId } = await params;
    const body = (await request.json()) as { replay?: unknown };
    const parsed = replayResultSchema.safeParse(body.replay);
    if (!parsed.success) throw invalidRequest(`Invalid replay result: ${parsed.error.issues.map((i) => i.message).join("; ")}`);

    const source = await getCanonicalRun(runId);
    if (!source) return NextResponse.json({ message: `Run "${runId}" not found.` }, { status: 404 });

    const errors = replayClaimErrors(parsed.data, runId);
    if (errors.length > 0) return NextResponse.json({ status: "REJECTED", errors }, { status: 422 });

    const safe = sanitizeCanonicalRecord(parsed.data, capturePolicyForRun(source));
    await saveReplayResult(safe);
    return NextResponse.json({ status: "STORED", replay_id: safe.replay_id, verification: safe.verification }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
