/**
 * POST /api/runs/start
 *
 * Creates a new run record and optionally emits a run_started trace event.
 *
 * Auth: x-agentpulse-key (AGENTPULSE_INGEST_KEY or AGENTPULSE_ACCESS_KEY)
 *
 * Body:
 *   project_id    string   — stable project identifier
 *   project_name  string   — human-readable project name
 *   workflow_id   string   — workflow being run
 *   summary       string   — human-readable description of this run
 *   run_id?       string   — client-provided; generated if omitted
 */

import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { requireIngestKey } from "@/lib/auth/requireIngestKey";
import { getRunStore, touchIntegrationForProject } from "@/lib/db/getStores";
import { generateRunId } from "@/lib/runs/runId";
import { runRecordSchema, traceEventSchema } from "@/lib/proof-layer/schemas";
import type { RunRecord, TraceEvent } from "@/lib/proof-layer/schemas";

export async function POST(request: Request) {
  try {
    requireIngestKey(request);

    const body = await request.json() as Record<string, unknown>;

    const project_id = body["project_id"];
    const project_name = body["project_name"];
    const workflow_id = body["workflow_id"];
    const summary = body["summary"];

    if (!project_id || typeof project_id !== "string") {
      throw invalidRequest("project_id is required.");
    }
    if (!project_name || typeof project_name !== "string") {
      throw invalidRequest("project_name is required.");
    }
    if (!workflow_id || typeof workflow_id !== "string") {
      throw invalidRequest("workflow_id is required.");
    }
    if (!summary || typeof summary !== "string") {
      throw invalidRequest("summary is required.");
    }

    const run_id =
      typeof body["run_id"] === "string" && body["run_id"].length > 0
        ? body["run_id"]
        : generateRunId();

    const started_at = new Date().toISOString();

    const runRecord = runRecordSchema.parse({
      run_id,
      workflow_id,
      project_id,
      project_name,
      status: "running",
      started_at,
      model_calls_count: 0,
      tool_calls_count: 0,
      evals_passed: 0,
      evals_failed: 0,
      artifact_refs: [],
      summary,
    } satisfies RunRecord);

    const result = await getRunStore().createRun(runRecord);

    if (!result.saved) {
      console.error(`[runs/start] Run persistence failed: ${result.warning}`);
      return NextResponse.json(
        {
          code: "persistence_unavailable",
          message: "Run could not be persisted. Check server storage configuration.",
          details: result.warning ?? "Unknown storage error",
        },
        { status: 503 },
      );
    }

    // Auto-emit a run_started trace event.
    const startedEvent: TraceEvent = traceEventSchema.parse({
      event_id: `${run_id}::run_started`,
      run_id,
      workflow_id,
      timestamp: started_at,
      event_type: "run_started",
      status: "running",
    });
    await getRunStore().appendTraceEvent(run_id, startedEvent);

    // Mark integration as receiving events (non-fatal).
    void touchIntegrationForProject(project_id, { runId: run_id });

    return NextResponse.json(runRecord, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
