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
import { requireIngestKey } from "@/lib/auth/requireIngestKey";
import { getRunStore } from "@/lib/db/getStores";
import { traceEventSchema } from "@/lib/proof-layer/schemas";
import { assertTraceContract } from "@/lib/proof-layer/index";
import type { TraceEvent, RunRecord } from "@/lib/proof-layer/schemas";

export async function POST(request: Request) {
  try {
    requireIngestKey(request);

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
    if (!saved) {
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

    // Run contract validation on the final state.
    const finalSaved = await getRunStore().getRun(run_id);
    const contractResult = assertTraceContract(finalSaved?.traceEvents ?? []);

    return NextResponse.json({
      runRecord: finalSaved?.runRecord,
      contractResult,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
