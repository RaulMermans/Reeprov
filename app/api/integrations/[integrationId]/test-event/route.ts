/**
 * POST /api/integrations/[integrationId]/test-event
 *
 * Creates a small test run for this integration using server-side logic.
 * Purpose: confirm the AgentPulse dashboard/run pipeline works for the
 * project identity — without requiring the external project to be running.
 *
 * Auth:   x-agentpulse-key (AGENTPULSE_ACCESS_KEY — dashboard key only)
 * Body:   none
 * Returns: { ok: true, runId: string, redirectTo: string }
 *
 * Security:
 *   - Uses the dashboard access key, NOT the ingest key.
 *   - Does not expose or require the ingest key in the browser.
 *   - The test run is clearly labeled with a "test-" prefix.
 */

import { NextResponse } from "next/server";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { apiErrorResponse } from "@/lib/api/errors";
import { fileIntegrationStore } from "@/lib/integrations/integrationStore";
import { fileRunStore } from "@/lib/runs/runStore";
import { generateRunId } from "@/lib/runs/runId";
import { traceEventSchema, runRecordSchema, evalResultSchema } from "@/lib/proof-layer/schemas";
import type { TraceEvent, EvalResult, RunRecord } from "@/lib/proof-layer/schemas";

type RouteContext = { params: Promise<{ integrationId: string }> };

function ts(base: Date, offsetMs: number): string {
  return new Date(base.getTime() + offsetMs).toISOString();
}

export async function POST(request: Request, context: RouteContext) {
  try {
    requireAccessKey(request);

    const { integrationId } = await context.params;
    const integration = await fileIntegrationStore.getIntegration(integrationId);
    if (!integration) {
      return NextResponse.json(
        { error: "not_found", message: "Integration not found." },
        { status: 404 },
      );
    }

    const runId = `test-${generateRunId()}`;
    const workflowId = integration.defaultWorkflowId ?? `${integration.projectId}-workflow`;
    const projectId = integration.projectId;
    const projectName = integration.projectName;
    const startTime = new Date();

    // Build a small but complete test run.
    const events: TraceEvent[] = [
      traceEventSchema.parse({
        event_id: `${runId}::run_started`,
        run_id: runId,
        workflow_id: workflowId,
        timestamp: ts(startTime, 0),
        event_type: "run_started",
        status: "running",
        input_summary: `Test event for integration: ${projectName}`,
      }),
      traceEventSchema.parse({
        event_id: `${runId}::node::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "test-node",
        timestamp: ts(startTime, 50),
        event_type: "node_started",
        status: "running",
        input_summary: "AgentPulse connection test node",
      }),
      traceEventSchema.parse({
        event_id: `${runId}::model::started`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "test-node",
        timestamp: ts(startTime, 100),
        event_type: "model_call_started",
        status: "running",
        input_summary: "Test model call (simulated)",
        metadata: { model_provider: "anthropic", model_name: "claude-haiku-4-5" },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::model::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "test-node",
        timestamp: ts(startTime, 800),
        event_type: "model_call_completed",
        status: "completed",
        duration_ms: 700,
        cost_usd: 0.0001,
        input_summary: "Test model call (simulated)",
        output_summary: "AgentPulse connection verified. Integration is active.",
        metadata: {
          model_provider: "anthropic",
          model_name: "claude-haiku-4-5",
          input_tokens: 50,
          output_tokens: 20,
        },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::eval::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "test-node",
        timestamp: ts(startTime, 850),
        event_type: "eval_completed",
        status: "completed",
        duration_ms: 50,
        output_summary: "Connection test eval: passed.",
        metadata: {
          eval_id: `${runId}::ev1`,
          eval_name: "Connection Test",
          eval_type: "schema_validity",
          passed: true,
          severity: "info",
          score: 1.0,
          findings: [],
        },
      }),
      traceEventSchema.parse({
        event_id: `${runId}::node::completed`,
        run_id: runId,
        workflow_id: workflowId,
        node_id: "test-node",
        timestamp: ts(startTime, 900),
        event_type: "node_completed",
        status: "completed",
        duration_ms: 850,
        output_summary: "Connection test node completed successfully.",
      }),
      traceEventSchema.parse({
        event_id: `${runId}::run_completed`,
        run_id: runId,
        workflow_id: workflowId,
        timestamp: ts(startTime, 950),
        event_type: "run_completed",
        status: "completed",
        duration_ms: 950,
        output_summary: "Integration test run complete.",
      }),
    ];

    const evalResults: EvalResult[] = [
      evalResultSchema.parse({
        eval_id: `${runId}::ev1`,
        run_id: runId,
        node_id: "test-node",
        name: "Connection Test",
        type: "schema_validity",
        score: 1.0,
        passed: true,
        severity: "info",
        findings: [],
      }),
    ];

    const runRecord = runRecordSchema.parse({
      run_id: runId,
      workflow_id: workflowId,
      project_id: projectId,
      project_name: projectName,
      status: "completed" as RunRecord["status"],
      started_at: ts(startTime, 0),
      completed_at: ts(startTime, 950),
      total_duration_ms: 950,
      total_cost_usd: 0.0001,
      model_calls_count: 1,
      tool_calls_count: 0,
      evals_passed: 1,
      evals_failed: 0,
      artifact_refs: [],
      summary: `AgentPulse connection test for ${projectName} — all checks passed`,
    } satisfies RunRecord);

    const createResult = await fileRunStore.createRun(runRecord);
    if (!createResult.saved) {
      return NextResponse.json(
        {
          code: "persistence_unavailable",
          message: "Test run could not be persisted. Check server storage configuration.",
          details: createResult.warning ?? "Unknown storage error",
        },
        { status: 503 },
      );
    }

    for (const event of events) {
      await fileRunStore.appendTraceEvent(runId, event);
    }
    for (const evalResult of evalResults) {
      await fileRunStore.appendEvalResult(runId, evalResult);
    }
    await fileRunStore.completeRun(runId, {
      status: "completed",
      completed_at: ts(startTime, 950),
      total_duration_ms: 950,
      total_cost_usd: 0.0001,
      model_calls_count: 1,
      tool_calls_count: 0,
      evals_passed: 1,
      evals_failed: 0,
    });

    // Mark the integration as having received an event.
    await fileIntegrationStore.recordEventSeen(projectId, {
      runId,
      runStatus: "completed",
    });

    const redirectTo = `/dashboard/runs/${runId}`;
    return NextResponse.json({ ok: true, runId, redirectTo }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
