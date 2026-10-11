/**
 * Canonical Run & Execution Boundary Persistence Layer.
 *
 * Implements dual-mode persistence (File + Postgres) for canonical RunArtifacts,
 * ExecutionBoundaries, ContextSnapshots, and content blobs.
 *
 * Backward Compatibility Guarantee:
 * Legacy runs that lack canonical records are seamlessly adapted via adaptLegacyRunToRunArtifact.
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runArtifactSchema, type RunArtifact } from "../contracts/runArtifact";
import { executionBoundarySchema, type ExecutionBoundary } from "../contracts/replay";
import { adaptLegacyRunToRunArtifact } from "../adapters/legacyRunAdapter";
import { getDb, hasDatabaseUrl } from "../../db/client";
import { ensureSchema } from "../../db/migrate";
import { getRunStore } from "../../db/getStores";
import type { SavedRun, RunSummary } from "../../runs/runTypes";
import { buildRunSummary } from "../../runs/runSummary";
import { globalCaptureMetrics } from "./metrics";

// ── File Path Helpers ───────────────────────────────────────────────────────

function storeDir(): string {
  const base =
    process.env["AGENTPULSE_STORE_DIR"] ??
    join(process.cwd(), ".agentpulse");
  return join(base, "runs");
}

function safeId(id: string): string {
  return id.replace(/[^a-z0-9_-]/gi, "");
}

function canonicalPath(runId: string): string {
  return join(storeDir(), `${safeId(runId)}.canonical.json`);
}

function legacyPath(runId: string): string {
  return join(storeDir(), `${safeId(runId)}.json`);
}

function indexPath(): string {
  return join(storeDir(), "index.json");
}

async function ensureStoreDir(): Promise<void> {
  const dir = storeDir();
  try {
    await access(dir);
  } catch {
    await mkdir(dir, { recursive: true });
  }
}

// ── Legacy Run Projection ───────────────────────────────────────────────────

function projectToSavedRun(artifact: RunArtifact): SavedRun {
  const now = new Date().toISOString();
  return {
    runRecord: {
      run_id: artifact.identity.run_id,
      workflow_id: artifact.identity.workflow_id,
      project_id: artifact.identity.project_id,
      project_name: artifact.identity.project_name ?? artifact.identity.project_id,
      status: artifact.execution.status === "cancelled" || artifact.execution.status === "timed_out"
        ? "failed"
        : artifact.execution.status,
      summary: artifact.execution.summary,
      started_at: artifact.execution.started_at,
      completed_at: artifact.execution.completed_at,
      total_cost_usd: artifact.observability.total_cost_usd,
      total_duration_ms: artifact.observability.total_duration_ms,
      model_calls_count: artifact.observability.model_calls_count,
      tool_calls_count: artifact.observability.tool_calls_count,
      evals_passed: artifact.observability.evals_passed,
      evals_failed: artifact.observability.evals_failed,
      approval_status: artifact.safety.approval_status === "not_required" ? undefined : artifact.safety.approval_status,
      artifact_refs: artifact.artifacts.map((a) => a.uri ?? ""),
    },
    traceEvents: artifact.trajectory.map((step) => ({
      event_id: step.step_id,
      run_id: artifact.identity.run_id,
      workflow_id: artifact.identity.workflow_id,
      event_type: "node_completed",
      timestamp: step.started_at,
      duration_ms: step.duration_ms,
      node_id: step.node_id,
      status: step.status === "failed" ? "failed" : "completed",
      input_summary: step.input_summary,
      output_summary: step.output_summary,
      metadata: step.metadata,
    })),
    toolCalls: artifact.tools.map((tc) => ({
      tool_call_id: tc.tool_call_id,
      run_id: artifact.identity.run_id,
      node_id: tc.node_id ?? "unknown",
      tool_name: tc.tool_name,
      permission_class: tc.permission_class,
      input_summary: tc.input_summary,
      output_summary: tc.output_summary,
      status: tc.status === "failed" ? "failed" : tc.status === "completed" ? "completed" : "pending",
      error: tc.error,
      started_at: tc.started_at,
      completed_at: tc.completed_at,
      duration_ms: tc.duration_ms,
    })),
    evalResults: artifact.evals.map((ev) => ({
      eval_id: ev.eval_id,
      run_id: ev.target_run_id,
      node_id: ev.target_node_id,
      name: ev.name,
      type: "schema_validity",
      score: ev.score,
      passed: ev.passed,
      severity: ev.severity,
      findings: ev.findings,
      recommendation: ev.recommendation,
    })),
    artifactRefs: artifact.artifacts.map((a) => a.uri ?? ""),
    createdAt: artifact.identity.created_at,
    updatedAt: now,
  };
}

async function upsertFileIndex(summary: RunSummary): Promise<void> {
  try {
    let existing: RunSummary[] = [];
    try {
      const raw = await readFile(indexPath(), "utf8");
      existing = JSON.parse(raw) as RunSummary[];
    } catch {
      existing = [];
    }
    const filtered = existing.filter((e) => e.run_id !== summary.run_id);
    await writeFile(indexPath(), JSON.stringify([summary, ...filtered], null, 2), "utf8");
  } catch {
    // Non-fatal
  }
}

// ── Public Persistence API ──────────────────────────────────────────────────

/**
 * Persists a canonical RunArtifact into active storage (File and/or Postgres).
 */
export async function saveCanonicalRun(artifact: RunArtifact): Promise<{ success: boolean; runId: string }> {
  const startMs = Date.now();
  const runId = artifact.identity.run_id;

  try {
    // 1. Persist to Postgres if configured
    if (hasDatabaseUrl()) {
      await ensureSchema();
      const sql = getDb();
      const now = new Date().toISOString();

      const artifactRefs: string[] = artifact.artifacts
        .map((a) => a.uri ?? "")
        .filter((u) => u.length > 0);

      // Upsert ap_runs
      await sql`
        INSERT INTO ap_runs (
          run_id, project_id, workflow_id, project_name, status, summary,
          started_at, completed_at, total_cost_usd, total_duration_ms,
          model_calls_count, tool_calls_count, evals_passed, evals_failed,
          approval_status, artifact_refs, error_summary,
          parent_run_id, root_run_id, fork_checkpoint_id, experiment_id,
          updated_at
        ) VALUES (
          ${runId},
          ${artifact.identity.project_id},
          ${artifact.identity.workflow_id},
          ${artifact.identity.project_name ?? artifact.identity.project_id},
          ${artifact.execution.status},
          ${artifact.execution.summary},
          ${artifact.execution.started_at},
          ${artifact.execution.completed_at ?? null},
          ${artifact.observability.total_cost_usd ?? null},
          ${artifact.observability.total_duration_ms ?? null},
          ${artifact.observability.model_calls_count},
          ${artifact.observability.tool_calls_count},
          ${artifact.observability.evals_passed},
          ${artifact.observability.evals_failed},
          ${artifact.safety.approval_status === "not_required" ? null : artifact.safety.approval_status},
          ${artifactRefs},
          ${artifact.execution.error?.message ?? null},
          ${artifact.lineage?.parent_run_id ?? null},
          ${artifact.lineage?.root_run_id ?? null},
          ${artifact.lineage?.fork_checkpoint_id ?? null},
          ${artifact.lineage?.experiment_id ?? null},
          ${now}
        )
        ON CONFLICT (run_id) DO UPDATE SET
          status = EXCLUDED.status,
          summary = EXCLUDED.summary,
          completed_at = EXCLUDED.completed_at,
          total_cost_usd = EXCLUDED.total_cost_usd,
          total_duration_ms = EXCLUDED.total_duration_ms,
          model_calls_count = EXCLUDED.model_calls_count,
          tool_calls_count = EXCLUDED.tool_calls_count,
          evals_passed = EXCLUDED.evals_passed,
          evals_failed = EXCLUDED.evals_failed,
          approval_status = EXCLUDED.approval_status,
          artifact_refs = EXCLUDED.artifact_refs,
          error_summary = EXCLUDED.error_summary,
          parent_run_id = EXCLUDED.parent_run_id,
          root_run_id = EXCLUDED.root_run_id,
          fork_checkpoint_id = EXCLUDED.fork_checkpoint_id,
          experiment_id = EXCLUDED.experiment_id,
          updated_at = EXCLUDED.updated_at
      `;

      // Upsert ap_canonical_runs
      await sql`
        INSERT INTO ap_canonical_runs (
          run_id, schema_version, artifact_data, updated_at
        ) VALUES (
          ${runId},
          ${artifact.schema_version},
          ${JSON.stringify(artifact)},
          ${now}
        )
        ON CONFLICT (run_id) DO UPDATE SET
          schema_version = EXCLUDED.schema_version,
          artifact_data = EXCLUDED.artifact_data,
          updated_at = EXCLUDED.updated_at
      `;

      // Upsert ap_execution_boundaries
      for (const b of artifact.boundaries) {
        await sql`
          INSERT INTO ap_execution_boundaries (
            boundary_id, run_id, step_id, sequence_index, boundary_type,
            name, replayability, side_effect_class, input_hash, output_hash,
            boundary_data
          ) VALUES (
            ${b.boundary_id},
            ${runId},
            ${b.step_id ?? null},
            ${b.sequence_index ?? 0},
            ${b.boundary_type},
            ${b.name},
            ${b.replayability},
            ${b.side_effect_class},
            ${b.content_hashes?.input_hash ?? b.input.hash ?? null},
            ${b.content_hashes?.output_hash ?? b.output?.hash ?? null},
            ${JSON.stringify(b)}
          )
          ON CONFLICT (boundary_id, run_id) DO UPDATE SET
            step_id = EXCLUDED.step_id,
            sequence_index = EXCLUDED.sequence_index,
            replayability = EXCLUDED.replayability,
            side_effect_class = EXCLUDED.side_effect_class,
            input_hash = EXCLUDED.input_hash,
            output_hash = EXCLUDED.output_hash,
            boundary_data = EXCLUDED.boundary_data
        `;
      }

      // Upsert ap_context_snapshots
      for (const ctx of artifact.context) {
        await sql`
          INSERT INTO ap_context_snapshots (
            snapshot_id, run_id, step_id, model_invocation_id,
            total_token_estimate, snapshot_data
          ) VALUES (
            ${ctx.snapshot_id},
            ${runId},
            ${ctx.step_id ?? null},
            ${ctx.model_invocation_id ?? null},
            ${ctx.total_token_estimate ?? null},
            ${JSON.stringify(ctx)}
          )
          ON CONFLICT (snapshot_id, run_id) DO UPDATE SET
            step_id = EXCLUDED.step_id,
            model_invocation_id = EXCLUDED.model_invocation_id,
            total_token_estimate = EXCLUDED.total_token_estimate,
            snapshot_data = EXCLUDED.snapshot_data
        `;
      }
    }

    // 2. Persist to file store
    await ensureStoreDir();
    await writeFile(canonicalPath(runId), JSON.stringify(artifact, null, 2), "utf8");

    // Also persist legacy representation so existing UI / run list stays green
    const saved = projectToSavedRun(artifact);
    await writeFile(legacyPath(runId), JSON.stringify(saved, null, 2), "utf8");
    await upsertFileIndex(buildRunSummary(saved));

    const latencyMs = Date.now() - startMs;
    globalCaptureMetrics.recordPersistenceLatency(latencyMs);

    return { success: true, runId };
  } catch (err) {
    globalCaptureMetrics.recordFailure();
    throw err;
  }
}

/**
 * Retrieves a canonical RunArtifact by runId.
 * Falls back to adapting legacy runs if no canonical record exists.
 */
export async function getCanonicalRun(runId: string): Promise<RunArtifact | null> {
  // 1. Try Postgres canonical table if configured
  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      const rows = await sql`
        SELECT artifact_data
        FROM ap_canonical_runs
        WHERE run_id = ${runId}
      `;
      if (rows.length > 0 && rows[0]?.["artifact_data"]) {
        const raw = rows[0]["artifact_data"];
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return runArtifactSchema.parse(parsed);
      }
    } catch {
      // Fall through to file / legacy
    }
  }

  // 2. Try file canonical store
  try {
    const raw = await readFile(canonicalPath(runId), "utf8");
    const parsed = JSON.parse(raw);
    return runArtifactSchema.parse(parsed);
  } catch {
    // Fall through to legacy adaptation
  }

  // 3. Fallback: adapt legacy run
  try {
    const runStore = getRunStore();
    const legacy = await runStore.getRun(runId);
    if (legacy) {
      return adaptLegacyRunToRunArtifact(legacy);
    }
  } catch {
    // Not found
  }

  return null;
}
