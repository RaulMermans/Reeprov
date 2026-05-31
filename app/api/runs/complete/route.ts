/**
 * POST /api/runs/complete
 *
 * Marks a run as completed. Optionally accepts final summary, artifact refs,
 * total cost, and total duration. Emits a run_completed trace event and runs
 * trace contract validation.
 *
 * Auth: x-agentpulse-key (AGENTPULSE_INGEST_KEY or AGENTPULSE_ACCESS_KEY)
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
import { requireIngestKey } from "@/lib/auth/requireIngestKey";
import { fileRunStore } from "@/lib/runs/runStore";
import { traceEventSchema } from "@/lib/proof-layer/schemas";
import { assertTraceContract, summarizeRun } from "@/lib/proof-layer/index";
import type { TraceEvent } from "@/lib/proof-layer/schemas";
import { touchIntegrationForProject } from "@/lib/integrations/integrationStore";

export async function POST(request: Request) {
  try {
    requireIngestKey(request);

    const body = await request.json() as Record<string, unknown>;

    const run_id = body["run_id"];
    if (!run_id || typeof run_id !== "string") {
      throw invalidRequest("run_id is required.");
    }

    const saved = await fileRunStore.getRun(run_id);
    if (!saved) {
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
    await fileRunStore.appendTraceEvent(run_id, completedEvent);

    // Re-read the updated saved run (with the new event).
    const updatedSaved = await fileRunStore.getRun(run_id);
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

    await fileRunStore.completeRun(run_id, patch as Partial<import("@/lib/proof-layer/schemas").RunRecord>);

    const finalRun = await fileRunStore.getRun(run_id);
    const finalStatus = (patch["status"] as string | undefined) ?? "completed";

    // Mark integration as receiving events (non-fatal).
    if (saved.runRecord.project_id) {
      void touchIntegrationForProject(saved.runRecord.project_id, {
        runId: run_id,
        runStatus: finalStatus,
      });
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
