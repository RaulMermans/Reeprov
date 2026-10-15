/**
 * POST /api/runs/fail
 *
 * Marks a run as failed. Requires an error_summary message.
 * Emits run_failed and error trace events.
 *
 * Auth: x-agentpulse-key (AGENTPULSE_INGEST_KEY or AGENTPULSE_ACCESS_KEY)
 *
 * Body:
 *   run_id             string   — required
 *   error_summary      string   — required human-readable error description
 *   total_cost_usd?    number
 *   total_duration_ms? number
 */

import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { getRunStore, recordIngestDiagnostic, requireIngestAuth } from "@/lib/db/getStores";
import { getCanonicalRun, saveCanonicalRun } from "@/lib/core/capture/persistence";
import { adaptLegacyRunToRunArtifact } from "@/lib/core/adapters/legacyRunAdapter";
import { traceEventSchema } from "@/lib/proof-layer/schemas";
import { assertTraceContract } from "@/lib/proof-layer/index";
import type { TraceEvent, RunRecord } from "@/lib/proof-layer/schemas";

export async function POST(request: Request) {
  try {
    const auth = await requireIngestAuth(request, "POST /api/runs/fail");

    const body = await request.json() as Record<string, unknown>;

    const run_id = body["run_id"];
    if (!run_id || typeof run_id !== "string") {
      throw invalidRequest("run_id is required.");
    }

    const error_summary = body["error_summary"];
    if (!error_summary || typeof error_summary !== "string") {
      throw invalidRequest("error_summary is required.");
    }

    const saved = await getRunStore().getRun(run_id);
    // A scoped ingest key may only fail runs it owns. Treat a scope mismatch
    // identically to "not found" to avoid leaking other projects' runs.
    const ownedByScope = !auth.integration || saved?.runRecord.project_id === auth.integration.projectId;
    if (!saved || !ownedByScope) {
      await recordIngestDiagnostic({
        integrationId: auth.integration?.integrationId,
        runId: run_id,
        category: "run_not_found",
        errorCode: "404",
        message: `Run "${run_id}" not found on POST /api/runs/fail.`,
      });
      return NextResponse.json(
        { message: `Run "${run_id}" not found.` },
        { status: 404 },
      );
    }

    const failedAt = new Date().toISOString();
    const workflow_id = saved.runRecord.workflow_id;

    // Emit an error event followed by a run_failed event.
    const errorEvent: TraceEvent = traceEventSchema.parse({
      event_id: `${run_id}::error`,
      run_id,
      workflow_id,
      timestamp: failedAt,
      event_type: "error",
      status: "failed",
      output_summary: error_summary,
      metadata: { error_summary },
    });
    await getRunStore().appendTraceEvent(run_id, errorEvent);

    const failedEvent: TraceEvent = traceEventSchema.parse({
      event_id: `${run_id}::run_failed`,
      run_id,
      workflow_id,
      timestamp: failedAt,
      event_type: "run_failed",
      status: "failed",
      output_summary: error_summary,
      ...(typeof body["total_cost_usd"] === "number" ? { cost_usd: body["total_cost_usd"] } : {}),
      ...(typeof body["total_duration_ms"] === "number" ? { duration_ms: body["total_duration_ms"] } : {}),
    });
    await getRunStore().appendTraceEvent(run_id, failedEvent);

    const patch: Partial<RunRecord> = {
      completed_at: failedAt,
      summary: error_summary,
      ...(typeof body["total_cost_usd"] === "number" ? { total_cost_usd: body["total_cost_usd"] as number } : {}),
      ...(typeof body["total_duration_ms"] === "number" ? { total_duration_ms: body["total_duration_ms"] as number } : {}),
    };

    await getRunStore().failRun(run_id, patch);

    const finalSaved = await getRunStore().getRun(run_id);

    // Update canonical run artifact if present
    try {
      const canonical = await getCanonicalRun(run_id);
      const existingBoundaries = canonical?.boundaries ?? [];
      const existingCheckpoints = canonical?.checkpoints ?? [];
      const existingState = canonical?.state ?? [];
      const incomingCheckpoints = Array.isArray(body["checkpoints"]) ? (body["checkpoints"] as any[]) : [];
      const incomingState = Array.isArray(body["state"]) ? (body["state"] as any[]) : [];
      if (finalSaved) {
        const fullArtifact = adaptLegacyRunToRunArtifact(finalSaved);
        fullArtifact.boundaries = existingBoundaries;
        fullArtifact.checkpoints = incomingCheckpoints.length > 0 ? incomingCheckpoints : existingCheckpoints;
        fullArtifact.state = incomingState.length > 0 ? incomingState : existingState;
        fullArtifact.execution.status = "failed";
        fullArtifact.execution.completed_at = failedAt;
        fullArtifact.execution.exit_reason = error_summary;
        fullArtifact.execution.error = { message: error_summary };
        await saveCanonicalRun(fullArtifact);
      }
    } catch {
      // Non-fatal
    }

    // Run contract validation on the final state.
    const contractResult = assertTraceContract(finalSaved?.traceEvents ?? []);

    return NextResponse.json({
      runRecord: finalSaved?.runRecord,
      contractResult,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
