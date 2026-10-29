/**
 * Canonical Run & Execution Boundary Persistence Layer.
 *
 * Implements dual-mode persistence (File + Postgres) for canonical RunArtifacts,
 * ExecutionBoundaries, ContextSnapshots, and content blobs.
 *
 * Backward Compatibility Guarantee:
 * Legacy runs that lack canonical records are seamlessly adapted via adaptLegacyRunToRunArtifact.
 */

import { access, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runArtifactSchema, type RunArtifact } from "../contracts/runArtifact";
import { executionBoundarySchema, type ExecutionBoundary } from "../contracts/replay";
import { adaptLegacyRunToRunArtifact } from "../adapters/legacyRunAdapter";
import { canonicalToLegacyEvalResult } from "../adapters/evalCompatibility";
import { getDb, hasDatabaseUrl } from "../../db/client";
import { ensureSchema } from "../../db/migrate";
import { getRunStore } from "../../db/getStores";
import { buildRunSummary } from "../../runs/runSummary";
import { globalCaptureMetrics } from "./metrics";
import { sanitizeCanonicalRecord } from "./redaction";
import { DEFAULT_CAPTURE_POLICY } from "./policy";
import { canonicalJsonStringify } from "./hashing";
import { traceEventTypeSchema, type TraceEvent } from "../../proof-layer/schemas";
import type { SavedRun, RunSummary } from "../../runs/runTypes";
import type { z } from "zod";

type TraceEventType = z.infer<typeof traceEventTypeSchema>;

import { getReeprovEnv } from "@/lib/config/env";
import { getReeprovHome } from "@/lib/storage/dataPath";
import { writeFileAtomic } from "@/lib/storage/runLock";
import { withRunWriteLock, upsertIndex } from "../../runs/runStore";
import type postgres from "postgres";

type SqlHandle = postgres.Sql | postgres.TransactionSql;

// ── File Path Helpers ───────────────────────────────────────────────────────

function storeDir(): string {
  const base =
    getReeprovEnv("REEPROV_STORE_DIR") ??
    getReeprovEnv("REEPROV_HOME") ??
    getReeprovHome();
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

function projectToSavedRun(artifact: RunArtifact, existingSaved?: SavedRun | null): SavedRun {
  const now = new Date().toISOString();
  const existingEventsMap = new Map((existingSaved?.traceEvents ?? []).map((e) => [e.event_id, e]));

  const projectedEvents = artifact.trajectory.map((step) => {
    const existing = existingEventsMap.get(step.step_id);
    if (existing) {
      return existing;
    }
    const origType = (step.metadata?.["original_event_type"] as string) || (step.metadata?.["event_type"] as string);
    let event_type: TraceEventType = "node_completed";
    if (origType && (traceEventTypeSchema.options as readonly string[]).includes(origType)) {
      event_type = origType as TraceEventType;
    } else if (step.name.endsWith("run_started") || step.step_id.endsWith("run_started")) {
      event_type = "run_started";
    } else if (step.name.endsWith("run_completed") || step.step_id.endsWith("run_completed")) {
      event_type = "run_completed";
    } else if (step.name.endsWith("run_failed") || step.step_id.endsWith("run_failed")) {
      event_type = "run_failed";
    }
    if (step.step_type === "handoff") {
      event_type = "agent_handoff";
    }
    return {
      event_id: step.step_id,
      run_id: artifact.identity.run_id,
      workflow_id: artifact.identity.workflow_id,
      event_type,
      timestamp: step.started_at,
      duration_ms: step.duration_ms,
      node_id: step.node_id,
      agent_id: step.agent_id,
      parent_event_id: step.parent_step_id,
      status: step.status === "failed" ? "failed" : "completed",
      input_summary: step.input_summary,
      output_summary: step.output_summary,
      metadata: step.metadata,
    } satisfies TraceEvent;
  });

  // Include any existing events that weren't in trajectory
  for (const existing of (existingSaved?.traceEvents ?? [])) {
    if (!projectedEvents.some((e) => e.event_id === existing.event_id)) {
      projectedEvents.push(existing);
    }
  }

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
      approval_status: artifact.safety?.approval_status === "not_required" ? undefined : artifact.safety?.approval_status,
      artifact_refs: (artifact.artifacts ?? []).map((a) => a.uri ?? ""),
    },
    traceEvents: projectedEvents,
    toolCalls: (artifact.tools ?? []).map((tc) => ({
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
    evalResults: (artifact.evals ?? []).map(canonicalToLegacyEvalResult),
    artifactRefs: (artifact.artifacts ?? []).map((a) => a.uri ?? ""),
    createdAt: artifact.identity.created_at,
    updatedAt: now,
  };
}

// ── Public Persistence API ──────────────────────────────────────────────────

/**
 * Persists a canonical RunArtifact into active storage (File and/or Postgres).
 */
export async function saveCanonicalRun(artifact: RunArtifact): Promise<{ success: boolean; runId: string }> {
  const runId = artifact.identity.run_id;
  if (hasDatabaseUrl()) {
    await ensureSchema();
    return getDb().begin(async (tx) => {
      await lockCanonicalRow(tx, runId);
      return withRunWriteLock(runId, () => persistCanonicalRun(artifact, tx));
    }) as Promise<{ success: boolean; runId: string }>;
  }
  return withRunWriteLock(runId, () => persistCanonicalRun(artifact));
}

async function lockCanonicalRow(sql: SqlHandle, runId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`reeprov:run:${runId}`}))`;
}

async function persistCanonicalRun(
  artifact: RunArtifact,
  tx?: SqlHandle,
): Promise<{ success: boolean; runId: string }> {
  const startMs = Date.now();
  const runId = artifact.identity.run_id;

  try {
    // Validate before either storage backend writes a byte. Existing unsafe
    // artifacts remain untouched and must be remediated explicitly.
    if (canonicalJsonStringify(sanitizeCanonicalRecord(artifact, DEFAULT_CAPTURE_POLICY)) !==
        canonicalJsonStringify(artifact)) {
      throw new Error("PRIVACY_VALIDATION_FAILED: canonical run contains unsanitized sensitive content; remediate the artifact before persistence.");
    }
    // 1. Persist to Postgres if configured
    if (tx) {
      const sql = tx;
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

      // Upsert ap_agent_config_snapshots
      if (artifact.configuration_snapshot) {
        const cfg = artifact.configuration_snapshot;
        await sql`
          INSERT INTO ap_agent_config_snapshots (
            snapshot_id, run_id, config_hash, declaration_type,
            agent_id, agent_version, model_id, captured_at,
            snapshot_data
          ) VALUES (
            ${cfg.snapshot_id},
            ${runId},
            ${cfg.config_hash},
            ${cfg.declaration_type ?? "EFFECTIVE"},
            ${cfg.agent.id},
            ${cfg.agent.version},
            ${cfg.model.model_id},
            ${cfg.captured_at},
            ${JSON.stringify(cfg)}
          )
          ON CONFLICT (snapshot_id) DO UPDATE SET
            config_hash = EXCLUDED.config_hash,
            declaration_type = EXCLUDED.declaration_type,
            snapshot_data = EXCLUDED.snapshot_data
        `;
      }

      // Upsert ap_verification_events, ap_test_results, ap_review_results, ap_security_events, ap_run_outcomes
      if (artifact.evidence) {
        for (const vevt of artifact.evidence.verification_events ?? []) {
          await sql`
            INSERT INTO ap_verification_events (
              event_id, run_id, step_id, sequence_index, event_type,
              target_type, target_id, status, actor, started_at,
              completed_at, duration_ms, event_data
            ) VALUES (
              ${vevt.event_id},
              ${runId},
              ${vevt.step_id ?? null},
              ${vevt.sequence_index},
              ${vevt.event_type},
              ${vevt.target_type},
              ${vevt.target_id ?? null},
              ${vevt.status},
              ${vevt.actor},
              ${vevt.started_at ?? null},
              ${vevt.completed_at ?? null},
              ${vevt.duration_ms ?? null},
              ${JSON.stringify(vevt)}
            )
            ON CONFLICT (event_id, run_id) DO UPDATE SET
              status = EXCLUDED.status,
              completed_at = EXCLUDED.completed_at,
              duration_ms = EXCLUDED.duration_ms,
              event_data = EXCLUDED.event_data
          `;
        }

        for (const tr of artifact.evidence.test_results ?? []) {
          await sql`
            INSERT INTO ap_test_results (
              test_id, run_id, step_id, suite, name, status,
              duration_ms, attempt, failure_message, result_data
            ) VALUES (
              ${tr.test_id},
              ${runId},
              ${tr.step_id ?? null},
              ${tr.suite},
              ${tr.name},
              ${tr.status},
              ${tr.duration_ms ?? null},
              ${tr.attempt ?? 1},
              ${tr.failure_message ?? null},
              ${JSON.stringify(tr)}
            )
            ON CONFLICT (test_id, run_id) DO UPDATE SET
              status = EXCLUDED.status,
              duration_ms = EXCLUDED.duration_ms,
              failure_message = EXCLUDED.failure_message,
              result_data = EXCLUDED.result_data
          `;
        }

        for (const rr of artifact.evidence.review_results ?? []) {
          await sql`
            INSERT INTO ap_review_results (
              review_id, run_id, step_id, review_type, reviewer,
              status, findings_count, result_data
            ) VALUES (
              ${rr.review_id},
              ${runId},
              ${rr.step_id ?? null},
              ${rr.review_type},
              ${rr.reviewer},
              ${rr.status},
              ${rr.findings?.length ?? 0},
              ${JSON.stringify(rr)}
            )
            ON CONFLICT (review_id, run_id) DO UPDATE SET
              status = EXCLUDED.status,
              findings_count = EXCLUDED.findings_count,
              result_data = EXCLUDED.result_data
          `;
        }

        for (const se of artifact.evidence.security_events ?? []) {
          await sql`
            INSERT INTO ap_security_events (
              event_id, run_id, step_id, action_id, tool_id,
              event_type, decision, reason_code, approval_id,
              timestamp, event_data
            ) VALUES (
              ${se.event_id},
              ${runId},
              ${se.step_id ?? null},
              ${se.action_id ?? null},
              ${se.tool_id ?? null},
              ${se.event_type},
              ${se.decision},
              ${se.reason_code ?? null},
              ${se.approval_id ?? null},
              ${se.timestamp},
              ${JSON.stringify(se)}
            )
            ON CONFLICT (event_id, run_id) DO UPDATE SET
              decision = EXCLUDED.decision,
              reason_code = EXCLUDED.reason_code,
              event_data = EXCLUDED.event_data
          `;
        }

        if (artifact.evidence.final_outcome) {
          const fo = artifact.evidence.final_outcome;
          await sql`
            INSERT INTO ap_run_outcomes (
              run_id, status, verification_status, outcome_data,
              completed_at
            ) VALUES (
              ${runId},
              ${fo.status},
              ${fo.verification_status},
              ${JSON.stringify(fo)},
              ${fo.completed_at}
            )
            ON CONFLICT (run_id) DO UPDATE SET
              status = EXCLUDED.status,
              verification_status = EXCLUDED.verification_status,
              outcome_data = EXCLUDED.outcome_data,
              completed_at = EXCLUDED.completed_at
          `;
        }
      }
    }

    // 2. Persist to file store
    await ensureStoreDir();
    await writeFileAtomic(canonicalPath(runId), JSON.stringify(artifact, null, 2));

    let existingSaved: SavedRun | null = null;
    try {
      const raw = await readFile(legacyPath(runId), "utf8");
      existingSaved = JSON.parse(raw);
    } catch {
      // No existing legacy file
    }
    const saved = projectToSavedRun(artifact, existingSaved);
    await writeFileAtomic(legacyPath(runId), JSON.stringify(saved, null, 2));
    await upsertIndex(buildRunSummary(saved));

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
  return readCanonicalRun(runId);
}

async function readCanonicalRun(runId: string, tx?: SqlHandle): Promise<RunArtifact | null> {
  // 1. Try Postgres canonical table if configured
  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = tx ?? getDb();
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

export interface CanonicalMutation<T> {
  /** The artifact to persist; omit to leave storage unchanged. */
  artifact?: RunArtifact;
  value: T;
}

/**
 * Authoritative read-modify-write for one canonical run.
 *
 * The mutator sees the latest persisted artifact (or the legacy adaptation)
 * while holding the run's write lock: an in-process mutex plus lock file for
 * the file store, and additionally a transaction-scoped advisory lock with
 * the Postgres store. Concurrent ingestion therefore cannot lose updates.
 */
export async function mutateCanonicalRun<T>(
  runId: string,
  mutator: (current: RunArtifact | null) => Promise<CanonicalMutation<T>> | CanonicalMutation<T>,
): Promise<T> {
  if (hasDatabaseUrl()) {
    await ensureSchema();
    return getDb().begin(async (tx) => {
      await lockCanonicalRow(tx, runId);
      return withRunWriteLock(runId, async () => {
        const result = await mutator(await readCanonicalRun(runId, tx));
        if (result.artifact) await persistCanonicalRun(result.artifact, tx);
        return result.value;
      });
    }) as Promise<T>;
  }
  return withRunWriteLock(runId, async () => {
    const result = await mutator(await readCanonicalRun(runId));
    if (result.artifact) await persistCanonicalRun(result.artifact);
    return result.value;
  });
}
