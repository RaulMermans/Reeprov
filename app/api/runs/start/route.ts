/**
 * POST /api/runs/start
 *
 * Creates a new run record and optionally emits a run_started trace event.
 *
 * Auth: x-reeprov-key (REEPROV_INGEST_KEY or REEPROV_ACCESS_KEY)
 *
 * Body:
 *   project_id    string   — stable project identifier
 *   project_name  string   — human-readable project name
 *   workflow_id   string   — workflow being run
 *   summary       string   — human-readable description of this run
 *   run_id?       string   — client-provided; generated if omitted
 */

import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { getRunStore, recordIngestDiagnostic, requireIngestAuth, touchIntegrationForProject } from "@/lib/db/getStores";
import { generateRunId } from "@/lib/runs/runId";
import { runRecordSchema, traceEventSchema } from "@/lib/proof-layer/schemas";
import type { RunRecord, TraceEvent } from "@/lib/proof-layer/schemas";
import { sanitizeCanonicalRecord } from "@/lib/core/capture/redaction";
import { DEFAULT_CAPTURE_POLICY } from "@/lib/core/capture/policy";

export async function POST(request: Request) {
  try {
    const auth = await requireIngestAuth(request, "POST /api/runs/start");

    const body = sanitizeCanonicalRecord(await request.json() as Record<string, unknown>, DEFAULT_CAPTURE_POLICY);

    const project_id = body["project_id"];
    const project_name = body["project_name"];
    const workflow_id = body["workflow_id"];
    const summary = body["summary"];

    if (!project_id || typeof project_id !== "string") {
      await recordIngestDiagnostic({
        category: "missing_project_id",
        errorCode: "400",
        message: "project_id is required on POST /api/runs/start.",
        schemaPath: "project_id",
      });
      throw invalidRequest("project_id is required.");
    }

    // A scoped ingest key may only start runs for its own project.
    if (auth.integration && auth.integration.projectId !== project_id) {
      await recordIngestDiagnostic({
        integrationId: auth.integration.integrationId,
        projectId: project_id,
        category: "invalid_ingest_key",
        errorCode: "403",
        message: `Scoped ingest key for project "${auth.integration.projectId}" cannot start a run for project "${project_id}".`,
      });
      throw new ApiError(403, "forbidden_scope", "This ingest key is not authorized for the given project_id.", true);
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
      await recordIngestDiagnostic({
        projectId: project_id,
        category: "persistence_unavailable",
        errorCode: "503",
        message: "Run could not be persisted on POST /api/runs/start.",
      });
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
