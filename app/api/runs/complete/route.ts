/**
 * POST /api/runs/complete
 *
 * Marks a run as completed. Optionally accepts final summary, artifact refs,
 * total cost, and total duration. Emits a run_completed trace event and runs
 * trace contract validation.
 *
 * Auth: x-reeprov-key (REEPROV_INGEST_KEY or REEPROV_ACCESS_KEY)
 *
 * Body:
 *   run_id            string    — required
 *   summary?          string
 *   total_cost_usd?   number
 *   total_duration_ms? number
 *   artifact_refs?    string[]
 */

import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";

import { traceEventSchema } from "@/lib/proof-layer/schemas";
import { assertTraceContract, summarizeRun } from "@/lib/proof-layer/index";
import type { TraceEvent } from "@/lib/proof-layer/schemas";
import { getRunStore, recordIngestDiagnostic, requireIngestAuth, touchIntegrationForProject } from "@/lib/db/getStores";
import { getCanonicalRun, saveCanonicalRun } from "@/lib/core/capture/persistence";
import { adaptLegacyRunToRunArtifact } from "@/lib/core/adapters/legacyRunAdapter";

export async function POST(request: Request) {
  try {
    const auth = await requireIngestAuth(request, "POST /api/runs/complete");

    const body = await request.json() as Record<string, unknown>;

    const run_id = body["run_id"];
    if (!run_id || typeof run_id !== "string") {
      throw invalidRequest("run_id is required.");
    }

    const saved = await getRunStore().getRun(run_id);
    // A scoped ingest key may only complete runs it owns. Treat a scope
    // mismatch identically to "not found" to avoid leaking other projects'
    // run existence to a scoped key.
    const ownedByScope = !auth.integration || saved?.runRecord.project_id === auth.integration.projectId;
    if (!saved || !ownedByScope) {
      await recordIngestDiagnostic({
        integrationId: auth.integration?.integrationId,
        runId: run_id,
        category: "run_not_found",
        errorCode: "404",
        message: `Run "${run_id}" not found on POST /api/runs/complete.`,
      });
      return NextResponse.json(
        { message: `Run "${run_id}" not found.` },
        { status: 404 },
      );
    }

    const completedAt = new Date().toISOString();

    // Emit run_completed trace event.
    const completedEvent: TraceEvent = traceEventSchema.parse({
      event_id: `${run_id}::run_completed`,
      run_id,
      workflow_id: saved.runRecord.workflow_id,
      timestamp: completedAt,
      event_type: "run_completed",
      status: "completed",
      ...(typeof body["total_cost_usd"] === "number" ? { cost_usd: body["total_cost_usd"] } : {}),
      ...(typeof body["total_duration_ms"] === "number" ? { duration_ms: body["total_duration_ms"] } : {}),
      ...(typeof body["summary"] === "string" ? { output_summary: body["summary"] } : {}),
    });
    await getRunStore().appendTraceEvent(run_id, completedEvent);

    // Re-read the updated saved run (with the new event).
    const updatedSaved = await getRunStore().getRun(run_id);
    const traceEvents = updatedSaved?.traceEvents ?? [];
    const evalResults = updatedSaved?.evalResults ?? [];

    // Run trace contract validation.
    const contractResult = assertTraceContract(traceEvents);
    const runSummary = summarizeRun(traceEvents, evalResults);

    // Build patch for the run record.
    const patch: Record<string, unknown> = {
      completed_at: completedAt,
      status: runSummary.status === "failed" ? "failed" : runSummary.status === "degraded" ? "degraded" : "completed",
    };
    if (typeof body["summary"] === "string") patch["summary"] = body["summary"];
    if (typeof body["total_cost_usd"] === "number") patch["total_cost_usd"] = body["total_cost_usd"];
    if (typeof body["total_duration_ms"] === "number") patch["total_duration_ms"] = body["total_duration_ms"];
    if (Array.isArray(body["artifact_refs"])) patch["artifact_refs"] = body["artifact_refs"];
    patch["model_calls_count"] = runSummary.modelCallsCount;
    patch["tool_calls_count"] = runSummary.toolCallsCount;
    patch["evals_passed"] = runSummary.evalsPassedCount;
    patch["evals_failed"] = runSummary.evalsFailedCount;

    await getRunStore().completeRun(run_id, patch as Partial<import("@/lib/proof-layer/schemas").RunRecord>);

    const finalRun = await getRunStore().getRun(run_id);
    const finalStatus = (patch["status"] as string | undefined) ?? "completed";

    // Mark integration as receiving events (non-fatal).
    if (saved.runRecord.project_id) {
      void touchIntegrationForProject(saved.runRecord.project_id, {
        runId: run_id,
        runStatus: finalStatus,
      });
    }

    // Update canonical run artifact if present
    try {
      const canonical = await getCanonicalRun(run_id);
      const existingBoundaries = canonical?.boundaries ?? [];
      const existingCheckpoints = canonical?.checkpoints ?? [];
      const existingState = canonical?.state ?? [];
      const incomingCheckpoints = Array.isArray(body["checkpoints"]) ? (body["checkpoints"] as any[]) : [];
      const incomingState = Array.isArray(body["state"]) ? (body["state"] as any[]) : [];
      if (finalRun) {
        const fullArtifact = adaptLegacyRunToRunArtifact(finalRun);
        fullArtifact.boundaries = existingBoundaries;
        fullArtifact.checkpoints = incomingCheckpoints.length > 0 ? incomingCheckpoints : existingCheckpoints;
        fullArtifact.state = incomingState.length > 0 ? incomingState : existingState;
        fullArtifact.execution.status = finalStatus === "failed" ? "failed" : "completed";
        fullArtifact.execution.completed_at = completedAt;
        if (typeof body["total_duration_ms"] === "number") {
          fullArtifact.execution.duration_ms = body["total_duration_ms"];
        }
        if (typeof body["total_cost_usd"] === "number") {
          fullArtifact.observability.total_cost_usd = body["total_cost_usd"] as number;
        }
        await saveCanonicalRun(fullArtifact);
      }
    } catch {
      // Non-fatal
    }

    return NextResponse.json({
      runRecord: finalRun?.runRecord,
      contractResult,
      runSummary,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
