/**
 * Run store types.
 *
 * A "saved run" is the unit of persistence in the run store.
 * It contains the RunRecord plus all associated trace events,
 * tool calls, eval results, and artifact refs.
 *
 * The RunStore interface is the only thing callers depend on —
 * the default file-backed implementation can be swapped for DB/blob storage.
 */

import type { TraceEvent, ToolCallRecord, EvalResult, RunRecord } from "@/lib/proof-layer/schemas";

// ── Run summary (stored in index) ─────────────────────────────────────────────

/**
 * Lightweight summary stored in the run index — enough to render the runs list
 * without loading each full run file.
 */
export interface RunSummary {
  run_id: string;
  workflow_id: string;
  project_id: string;
  project_name: string;
  status: RunRecord["status"];
  started_at: string;
  completed_at?: string;
  total_duration_ms?: number;
  total_cost_usd?: number;
  model_calls_count: number;
  tool_calls_count: number;
  evals_passed: number;
  evals_failed: number;
  trace_event_count: number;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

// ── Full saved run ────────────────────────────────────────────────────────────

/**
 * A complete persisted run: RunRecord + all associated data.
 */
export interface SavedRun {
  runRecord: RunRecord;
  traceEvents: TraceEvent[];
  toolCalls: ToolCallRecord[];
  evalResults: EvalResult[];
  artifactRefs: string[];
  createdAt: string;
  updatedAt: string;
}

// ── Store operation results ───────────────────────────────────────────────────

export interface SaveRunResult {
  saved: boolean;
  run_id: string;
  warning?: string;
}

export interface AppendResult {
  appended: boolean;
  run_id: string;
  warning?: string;
}

// ── Store interface ───────────────────────────────────────────────────────────

/**
 * Minimal persistence interface for runs.
 * The default implementation is file-backed (fileRunStore).
 * A future version can swap in a DB/blob adapter without changing callers.
 */
export interface RunStore {
  createRun(runRecord: RunRecord): Promise<SaveRunResult>;
  appendTraceEvent(runId: string, event: TraceEvent): Promise<AppendResult>;
  appendToolCallRecord(runId: string, toolCall: ToolCallRecord): Promise<AppendResult>;
  appendEvalResult(runId: string, evalResult: EvalResult): Promise<AppendResult>;
  completeRun(runId: string, patch: Partial<RunRecord>): Promise<boolean>;
  failRun(runId: string, patch: Partial<RunRecord>): Promise<boolean>;
  getRun(runId: string): Promise<SavedRun | null>;
  listRuns(filters?: { projectId?: string; workflowId?: string; status?: string; limit?: number }): Promise<RunSummary[]>;
  deleteRun(runId: string): Promise<boolean>;
}
