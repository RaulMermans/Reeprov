/**
 * Builds a RunSummary from a SavedRun.
 * Used when writing to the run index.
 */

import type { SavedRun, RunSummary } from "./runTypes";

export function buildRunSummary(saved: SavedRun): RunSummary {
  const { runRecord, traceEvents } = saved;
  return {
    run_id: runRecord.run_id,
    workflow_id: runRecord.workflow_id,
    project_id: runRecord.project_id,
    project_name: runRecord.project_name,
    status: runRecord.status,
    started_at: runRecord.started_at,
    completed_at: runRecord.completed_at,
    total_duration_ms: runRecord.total_duration_ms,
    total_cost_usd: runRecord.total_cost_usd,
    model_calls_count: runRecord.model_calls_count,
    tool_calls_count: runRecord.tool_calls_count,
    evals_passed: runRecord.evals_passed,
    evals_failed: runRecord.evals_failed,
    trace_event_count: traceEvents.length,
    summary: runRecord.summary,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
  };
}
