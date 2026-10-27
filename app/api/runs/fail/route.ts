/**
 * POST /api/runs/fail
 *
 * Marks a run as failed. Requires an error_summary message.
 * Emits run_failed and error trace events.
 *
 * Auth: x-reeprov-key (REEPROV_INGEST_KEY or REEPROV_ACCESS_KEY)
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
import { mutateCanonicalRun } from "@/lib/core/capture/persistence";
import { finalizeCanonicalArtifact } from "@/lib/core/capture/runPolicy";
import { traceEventSchema } from "@/lib/proof-layer/schemas";
import { assertTraceContract, summarizeRun } from "@/lib/proof-layer/index";
import type { TraceEvent, RunRecord } from "@/lib/proof-layer/schemas";
import { sanitizeCanonicalRecord } from "@/lib/core/capture/redaction";
import { DEFAULT_CAPTURE_POLICY } from "@/lib/core/capture/policy";

export async function POST(request: Request) {
  try {
    const auth = await requireIngestAuth(request, "POST /api/runs/fail");

    const rawBody = await request.json() as Record<string, unknown>;
    const body = sanitizeCanonicalRecord(rawBody, DEFAULT_CAPTURE_POLICY);

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

    const savedAfterEvents = await getRunStore().getRun(run_id);
    const summary = summarizeRun(savedAfterEvents?.traceEvents ?? [], savedAfterEvents?.evalResults ?? []);
    const patch: Partial<RunRecord> = {
      completed_at: failedAt,
      summary: error_summary,
      model_calls_count: summary.modelCallsCount,
      tool_calls_count: summary.toolCallsCount,
      evals_passed: summary.evalsPassedCount,
      evals_failed: summary.evalsFailedCount,
      ...(typeof body["total_cost_usd"] === "number" ? { total_cost_usd: body["total_cost_usd"] as number } : {}),
      ...(typeof body["total_duration_ms"] === "number" ? { total_duration_ms: body["total_duration_ms"] as number } : {}),
    };

    await getRunStore().failRun(run_id, patch);

    const finalSaved = await getRunStore().getRun(run_id);

    // Update the canonical artifact under the run lock, preserving boundaries,
    // registered checkpoints, observations and capture policy.
    let canonicalWarning: string | undefined;
    if (Array.isArray(body["checkpoints"]) || Array.isArray(body["state"])) {
      canonicalWarning =
        "RAW_CHECKPOINTS_IGNORED: checkpoints/state sent at failed time are not trusted; register restorable checkpoints while the run executes.";
    }
    if (finalSaved) {
      await mutateCanonicalRun(run_id, (current) => ({
        artifact: finalizeCanonicalArtifact(current, finalSaved, {
          status: "failed",
          completedAt: failedAt,
          durationMs: typeof body["total_duration_ms"] === "number" ? body["total_duration_ms"] as number : undefined,
          costUsd: typeof body["total_cost_usd"] === "number" ? body["total_cost_usd"] as number : undefined,
          output: rawBody["output"],
          errorMessage: error_summary,
        }),
        value: undefined,
      }));
    }

    // Run contract validation on the final state.
    const contractResult = assertTraceContract(finalSaved?.traceEvents ?? []);

    return NextResponse.json({
      runRecord: finalSaved?.runRecord,
      contractResult,
      ...(canonicalWarning ? { warnings: [canonicalWarning] } : {}),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
