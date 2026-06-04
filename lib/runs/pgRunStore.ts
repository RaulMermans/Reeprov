/**
 * Postgres-backed run store.
 *
 * Implements the same RunStore interface as fileRunStore.
 * Used in production when DATABASE_URL is set.
 *
 * Schema:
 *   ap_runs          — one row per run (columns mirror RunRecord fields)
 *   ap_trace_events  — one row per event (FK → ap_runs)
 *   ap_tool_calls    — one row per tool call (FK → ap_runs)
 *   ap_eval_results  — one row per eval result (FK → ap_runs)
 */

import { getDb } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/migrate";
import type { TraceEvent, ToolCallRecord, EvalResult, RunRecord } from "@/lib/proof-layer/schemas";
import type { AppendResult, RunStore, RunSummary, SavedRun, SaveRunResult } from "./runTypes";

// ── Row → Domain mappers ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRunRecord(row: Record<string, any>): RunRecord {
  return {
    run_id: row["run_id"] as string,
    workflow_id: row["workflow_id"] as string,
    project_id: row["project_id"] as string,
    project_name: row["project_name"] as string,
    status: row["status"] as RunRecord["status"],
    summary: (row["summary"] as string) || "",
    started_at: (row["started_at"] as Date).toISOString(),
    completed_at: row["completed_at"] ? (row["completed_at"] as Date).toISOString() : undefined,
    total_cost_usd: row["total_cost_usd"] != null ? Number(row["total_cost_usd"]) : undefined,
    total_duration_ms: row["total_duration_ms"] != null ? Number(row["total_duration_ms"]) : undefined,
    model_calls_count: Number(row["model_calls_count"]),
    tool_calls_count: Number(row["tool_calls_count"]),
    evals_passed: Number(row["evals_passed"]),
    evals_failed: Number(row["evals_failed"]),
    approval_status: (row["approval_status"] as RunRecord["approval_status"]) ?? undefined,
    artifact_refs: (row["artifact_refs"] as string[]) ?? [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRunSummary(row: Record<string, any>, traceEventCount: number): RunSummary {
  const runRecord = rowToRunRecord(row);
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
    trace_event_count: traceEventCount,
    summary: runRecord.summary,
    createdAt: (row["created_at"] as Date).toISOString(),
    updatedAt: (row["updated_at"] as Date).toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTraceEvent(row: Record<string, any>): TraceEvent {
  return {
    event_id: row["event_id"] as string,
    run_id: row["run_id"] as string,
    workflow_id: row["workflow_id"] as string,
    event_type: row["event_type"] as TraceEvent["event_type"],
    status: (row["status"] as TraceEvent["status"]) ?? undefined,
    node_id: (row["node_id"] as string | null) ?? undefined,
    timestamp: (row["timestamp"] as Date).toISOString(),
    duration_ms: row["duration_ms"] != null ? Number(row["duration_ms"]) : undefined,
    cost_usd: row["cost_usd"] != null ? Number(row["cost_usd"]) : undefined,
    input_summary: (row["input_summary"] as string | null) ?? undefined,
    output_summary: (row["output_summary"] as string | null) ?? undefined,
    metadata: (row["metadata"] as Record<string, unknown> | null) ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToToolCall(row: Record<string, any>): ToolCallRecord {
  return {
    tool_call_id: row["tool_call_id"] as string,
    run_id: row["run_id"] as string,
    node_id: row["node_id"] as string,
    tool_name: row["tool_name"] as string,
    permission_class: (row["permission_class"] as ToolCallRecord["permission_class"]) ?? "read",
    input_summary: (row["input_summary"] as string | null) ?? undefined,
    output_summary: (row["output_summary"] as string | null) ?? undefined,
    status: row["status"] as ToolCallRecord["status"],
    error: (row["error"] as string | null) ?? undefined,
    started_at: row["started_at"] ? (row["started_at"] as Date).toISOString() : new Date().toISOString(),
    completed_at: row["completed_at"] ? (row["completed_at"] as Date).toISOString() : undefined,
    duration_ms: row["duration_ms"] != null ? Number(row["duration_ms"]) : undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToEvalResult(row: Record<string, any>): EvalResult {
  return {
    eval_id: row["eval_id"] as string,
    run_id: row["run_id"] as string,
    node_id: (row["node_id"] as string | null) ?? undefined,
    name: row["name"] as string,
    type: row["type"] as EvalResult["type"],
    score: row["score"] != null ? Number(row["score"]) : undefined,
    passed: row["passed"] as boolean,
    severity: row["severity"] as EvalResult["severity"],
    findings: (row["findings"] as string[]) ?? [],
    recommendation: (row["recommendation"] as string | null) ?? undefined,
  };
}

// ── Postgres implementation ───────────────────────────────────────────────────

export const pgRunStore: RunStore = {

  async createRun(runRecord: RunRecord): Promise<SaveRunResult> {
    try {
      await ensureSchema();
      const sql = getDb();
      const now = new Date();

      await sql`
        INSERT INTO ap_runs (
          run_id, project_id, workflow_id, project_name, status, summary,
          started_at, completed_at, total_cost_usd, total_duration_ms,
          model_calls_count, tool_calls_count, evals_passed, evals_failed,
          approval_status, artifact_refs, error_summary, created_at, updated_at
        ) VALUES (
          ${runRecord.run_id},
          ${runRecord.project_id},
          ${runRecord.workflow_id},
          ${runRecord.project_name},
          ${runRecord.status},
          ${runRecord.summary},
          ${new Date(runRecord.started_at)},
          ${runRecord.completed_at ? new Date(runRecord.completed_at) : null},
          ${runRecord.total_cost_usd ?? null},
          ${runRecord.total_duration_ms ?? null},
          ${runRecord.model_calls_count},
          ${runRecord.tool_calls_count},
          ${runRecord.evals_passed},
          ${runRecord.evals_failed},
          ${runRecord.approval_status ?? null},
          ${runRecord.artifact_refs},
          ${null},
          ${now},
          ${now}
        )
        ON CONFLICT (run_id) DO NOTHING
      `;

      return { saved: true, run_id: runRecord.run_id };
    } catch (err) {
      const warning = err instanceof Error ? err.message : "Unknown persistence error";
      return { saved: false, run_id: runRecord.run_id, warning };
    }
  },

  async appendTraceEvent(runId: string, event: TraceEvent): Promise<AppendResult> {
    try {
      await ensureSchema();
      const sql = getDb();

      await sql`
        INSERT INTO ap_trace_events (
          event_id, run_id, workflow_id, event_type, status, node_id,
          timestamp, duration_ms, cost_usd, input_summary, output_summary, metadata
        ) VALUES (
          ${event.event_id},
          ${runId},
          ${event.workflow_id},
          ${event.event_type},
          ${event.status ?? null},
          ${event.node_id ?? null},
          ${new Date(event.timestamp)},
          ${event.duration_ms ?? null},
          ${event.cost_usd ?? null},
          ${event.input_summary ?? null},
          ${event.output_summary ?? null},
          ${event.metadata ? JSON.stringify(event.metadata) : null}
        )
        ON CONFLICT (event_id, run_id) DO NOTHING
      `;

      // Update run's updated_at timestamp.
      await sql`UPDATE ap_runs SET updated_at = NOW() WHERE run_id = ${runId}`;

      return { appended: true, run_id: runId };
    } catch (err) {
      const warning = err instanceof Error ? err.message : "Unknown persistence error";
      return { appended: false, run_id: runId, warning };
    }
  },

  async appendToolCallRecord(runId: string, toolCall: ToolCallRecord): Promise<AppendResult> {
    try {
      await ensureSchema();
      const sql = getDb();

      await sql`
        INSERT INTO ap_tool_calls (
          tool_call_id, run_id, node_id, tool_name, permission_class,
          input_summary, output_summary, status, error,
          started_at, completed_at, duration_ms
        ) VALUES (
          ${toolCall.tool_call_id},
          ${runId},
          ${toolCall.node_id},
          ${toolCall.tool_name},
          ${toolCall.permission_class},
          ${toolCall.input_summary ?? null},
          ${toolCall.output_summary ?? null},
          ${toolCall.status},
          ${toolCall.error ?? null},
          ${toolCall.started_at ? new Date(toolCall.started_at) : null},
          ${toolCall.completed_at ? new Date(toolCall.completed_at) : null},
          ${toolCall.duration_ms ?? null}
        )
        ON CONFLICT (tool_call_id, run_id) DO NOTHING
      `;

      await sql`UPDATE ap_runs SET updated_at = NOW() WHERE run_id = ${runId}`;
      return { appended: true, run_id: runId };
    } catch (err) {
      const warning = err instanceof Error ? err.message : "Unknown persistence error";
      return { appended: false, run_id: runId, warning };
    }
  },

  async appendEvalResult(runId: string, evalResult: EvalResult): Promise<AppendResult> {
    try {
      await ensureSchema();
      const sql = getDb();

      await sql`
        INSERT INTO ap_eval_results (
          eval_id, run_id, node_id, name, type,
          score, passed, severity, findings, recommendation
        ) VALUES (
          ${evalResult.eval_id},
          ${runId},
          ${evalResult.node_id ?? null},
          ${evalResult.name},
          ${evalResult.type},
          ${evalResult.score ?? null},
          ${evalResult.passed},
          ${evalResult.severity},
          ${JSON.stringify(evalResult.findings)},
          ${evalResult.recommendation ?? null}
        )
        ON CONFLICT (eval_id, run_id) DO NOTHING
      `;

      await sql`UPDATE ap_runs SET updated_at = NOW() WHERE run_id = ${runId}`;
      return { appended: true, run_id: runId };
    } catch (err) {
      const warning = err instanceof Error ? err.message : "Unknown persistence error";
      return { appended: false, run_id: runId, warning };
    }
  },

  async completeRun(runId: string, patch: Partial<RunRecord>): Promise<boolean> {
    try {
      await ensureSchema();
      const sql = getDb();
      const now = new Date();

      const finalStatus =
        patch.status === "degraded" ? "degraded" : "completed";

      await sql`
        UPDATE ap_runs SET
          status            = ${finalStatus},
          completed_at      = ${patch.completed_at ? new Date(patch.completed_at) : now},
          total_cost_usd    = COALESCE(${patch.total_cost_usd ?? null}, total_cost_usd),
          total_duration_ms = COALESCE(${patch.total_duration_ms ?? null}, total_duration_ms),
          model_calls_count = COALESCE(${patch.model_calls_count ?? null}, model_calls_count),
          tool_calls_count  = COALESCE(${patch.tool_calls_count ?? null}, tool_calls_count),
          evals_passed      = COALESCE(${patch.evals_passed ?? null}, evals_passed),
          evals_failed      = COALESCE(${patch.evals_failed ?? null}, evals_failed),
          artifact_refs     = COALESCE(${patch.artifact_refs ?? null}, artifact_refs),
          summary           = COALESCE(${patch.summary ?? null}, summary),
          updated_at        = ${now}
        WHERE run_id = ${runId}
      `;
      return true;
    } catch {
      return false;
    }
  },

  async failRun(runId: string, patch: Partial<RunRecord>): Promise<boolean> {
    try {
      await ensureSchema();
      const sql = getDb();
      const now = new Date();

      await sql`
        UPDATE ap_runs SET
          status        = 'failed',
          completed_at  = ${patch.completed_at ? new Date(patch.completed_at) : now},
          error_summary = ${(patch as Record<string, unknown>)["error_summary"] as string ?? null},
          updated_at    = ${now}
        WHERE run_id = ${runId}
      `;
      return true;
    } catch {
      return false;
    }
  },

  async getRun(runId: string): Promise<SavedRun | null> {
    try {
      await ensureSchema();
      const sql = getDb();

      const runRows = await sql`
        SELECT * FROM ap_runs WHERE run_id = ${runId} LIMIT 1
      `;
      if (runRows.length === 0) return null;

      const runRow = runRows[0] as Record<string, unknown>;
      const runRecord = rowToRunRecord(runRow);

      const [eventRows, toolRows, evalRows] = await Promise.all([
        sql`SELECT * FROM ap_trace_events WHERE run_id = ${runId} ORDER BY timestamp ASC`,
        sql`SELECT * FROM ap_tool_calls WHERE run_id = ${runId} ORDER BY started_at ASC`,
        sql`SELECT * FROM ap_eval_results WHERE run_id = ${runId}`,
      ]);

      return {
        runRecord,
        traceEvents: eventRows.map((r) => rowToTraceEvent(r as Record<string, unknown>)),
        toolCalls: toolRows.map((r) => rowToToolCall(r as Record<string, unknown>)),
        evalResults: evalRows.map((r) => rowToEvalResult(r as Record<string, unknown>)),
        artifactRefs: runRecord.artifact_refs,
        createdAt: (runRow["created_at"] as Date).toISOString(),
        updatedAt: (runRow["updated_at"] as Date).toISOString(),
      };
    } catch {
      return null;
    }
  },

  async listRuns(
    filters?: { projectId?: string; workflowId?: string; status?: string; limit?: number },
  ): Promise<RunSummary[]> {
    try {
      await ensureSchema();
      const sql = getDb();
      const limit = filters?.limit && filters.limit > 0 ? filters.limit : 50;

      const rows = await sql`
        SELECT r.*,
          (SELECT COUNT(*) FROM ap_trace_events te WHERE te.run_id = r.run_id)::int AS trace_event_count
        FROM ap_runs r
        ORDER BY r.started_at DESC
        LIMIT ${limit * 5}
      `;

      let summaries = rows.map((r) => {
        const row = r as Record<string, unknown>;
        return rowToRunSummary(row, Number(row["trace_event_count"] ?? 0));
      });

      if (filters?.projectId) {
        summaries = summaries.filter((s) => s.project_id === filters.projectId);
      }
      if (filters?.workflowId) {
        summaries = summaries.filter((s) => s.workflow_id === filters.workflowId);
      }
      if (filters?.status) {
        summaries = summaries.filter((s) => s.status === filters.status);
      }

      return summaries.slice(0, limit);
    } catch {
      return [];
    }
  },

  async deleteRun(runId: string): Promise<boolean> {
    try {
      await ensureSchema();
      const sql = getDb();
      // ON DELETE CASCADE handles trace_events, tool_calls, eval_results.
      const result = await sql`DELETE FROM ap_runs WHERE run_id = ${runId}`;
      return (result.count ?? 0) > 0;
    } catch {
      return false;
    }
  },
};
