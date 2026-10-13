/**
 * GET /api/runs/examples/[runId]
 *
 * Returns example/demo run data for the given runId.
 * No auth required — this is demo data only.
 *
 * Response: { run, traceEvents, evalResults, workflow } or 404
 */

import { NextResponse } from "next/server";
import { authorizeRequest, AccessControlError } from "@/lib/auth/accessControl";
import {
  getRunById,
  getExampleTraceEvents,
  getExampleEvalResults,
  getWorkflowById,
} from "@/lib/proof-layer/examples";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    await authorizeRequest(request, { capability: "HEALTH_PUBLIC" });
  const { runId } = await params;

  const run = getRunById(runId);
  if (!run) {
    return NextResponse.json({ message: `Example run "${runId}" not found.` }, { status: 404 });
  }

  const traceEvents = getExampleTraceEvents(runId);
  const evalResults = getExampleEvalResults(runId);
  const workflow = getWorkflowById(run.workflow_id);

    return NextResponse.json({ run, traceEvents, evalResults, workflow });
  } catch (error) {
    if (error instanceof AccessControlError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
