/**
 * File-backed run store.
 *
 * Layout:
 *   .reeprov/runs/
 *     index.json         — array of RunSummary, newest first
 *     {runId}.json       — full SavedRun
 *
 * This implementation is swappable: callers depend only on RunStore.
 * Fails gracefully if the filesystem is read-only (e.g. Vercel production).
 *
 * Safety:
 * - Run IDs are sanitized before use as file names (path traversal prevention).
 * - Duplicate trace event IDs (event_id) are deduplicated on append.
 */

import { access, mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { TraceEvent, ToolCallRecord, EvalResult, RunRecord } from "@/lib/proof-layer/schemas";
import type { AppendResult, RunStore, RunSummary, SavedRun, SaveRunResult } from "./runTypes";
import { buildRunSummary } from "./runSummary";

import { getReeprovEnv } from "@/lib/config/env";
import { getReeprovHome } from "@/lib/storage/dataPath";
import { withRunLock, writeFileAtomic } from "@/lib/storage/runLock";

// ── Store directory ───────────────────────────────────────────────────────────

function storeDir(): string {
  const base =
    getReeprovEnv("REEPROV_STORE_DIR") ??
    getReeprovEnv("REEPROV_HOME") ??
    getReeprovHome();
  return join(base, "runs");
}

function indexPath(): string {
  return join(storeDir(), "index.json");
}

function safeId(id: string): string {
  // Only allow safe ID characters to prevent path traversal.
  return id.replace(/[^a-z0-9_-]/gi, "");
}

function runPath(runId: string): string {
  return join(storeDir(), `${safeId(runId)}.json`);
}

/**
 * Serializes every read-modify-write of one run's files (legacy SavedRun and
 * canonical artifact share this lock). Re-entrant within one call chain.
 */
export function withRunWriteLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  return withRunLock(join(storeDir(), ".locks"), `run_${safeId(runId)}`, fn);
}

/** Like withRunWriteLock, but a lock failure becomes the method's failure result. */
async function lockedOr<T>(runId: string, onError: (warning: string) => T, fn: () => Promise<T>): Promise<T> {
  try {
    return await withRunWriteLock(runId, fn);
  } catch (err) {
    return onError(err instanceof Error ? err.message : "Unknown persistence error");
  }
}

/** The run index is shared by all runs and has its own lock. */
export function withRunIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  return withRunLock(join(storeDir(), ".locks"), "run_index", fn);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ensureStoreDir(): Promise<void> {
  const dir = storeDir();
  try {
    await access(dir);
  } catch {
    await mkdir(dir, { recursive: true });
  }
}

async function readIndex(): Promise<RunSummary[]> {
  try {
    const raw = await readFile(indexPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as RunSummary[];
    return [];
  } catch {
    return [];
  }
}

async function writeIndex(entries: RunSummary[]): Promise<void> {
  await writeFileAtomic(indexPath(), JSON.stringify(entries, null, 2));
}

async function readSavedRun(runId: string): Promise<SavedRun | null> {
  try {
    const raw = await readFile(runPath(runId), "utf8");
    return JSON.parse(raw) as SavedRun;
  } catch {
    return null;
  }
}

async function writeSavedRun(saved: SavedRun): Promise<void> {
  await writeFileAtomic(runPath(saved.runRecord.run_id), JSON.stringify(saved, null, 2));
}

export async function upsertIndex(summary: RunSummary): Promise<void> {
  await withRunIndexLock(async () => {
    const existing = await readIndex();
    const filtered = existing.filter((e) => e.run_id !== summary.run_id);
    // Prepend so newest/most-recently-updated is first.
    await writeIndex([summary, ...filtered]);
  });
}

// ── File-backed implementation ────────────────────────────────────────────────

export const fileRunStore: RunStore = {

  async createRun(runRecord: RunRecord): Promise<SaveRunResult> {
    const run_id = runRecord.run_id;
    return lockedOr(run_id, (warning) => ({ saved: false, run_id, warning }), async () => {

      try {
        await ensureStoreDir();

        const now = new Date().toISOString();
        const saved: SavedRun = {
          runRecord,
          traceEvents: [],
          toolCalls: [],
          evalResults: [],
          artifactRefs: runRecord.artifact_refs ?? [],
          createdAt: now,
          updatedAt: now,
        };

        await writeSavedRun(saved);
        await upsertIndex(buildRunSummary(saved));

        return { saved: true, run_id };
      } catch (err) {
        const warning = err instanceof Error ? err.message : "Unknown persistence error";
        return { saved: false, run_id, warning };
      }
    });
  },

  async appendTraceEvent(runId: string, event: TraceEvent): Promise<AppendResult> {
    return lockedOr(runId, (warning) => ({ appended: false, run_id: runId, warning }), async () => {
      try {
        const saved = await readSavedRun(runId);
        if (!saved) {
          return { appended: false, run_id: runId, warning: `Run ${runId} not found.` };
        }

        // Idempotency: skip duplicate event_ids.
        const exists = saved.traceEvents.some((e) => e.event_id === event.event_id);
        if (!exists) {
          saved.traceEvents.push(event);
        }

        saved.updatedAt = new Date().toISOString();
        await writeSavedRun(saved);
        await upsertIndex(buildRunSummary(saved));

        return { appended: !exists, run_id: runId };
      } catch (err) {
        const warning = err instanceof Error ? err.message : "Unknown persistence error";
        return { appended: false, run_id: runId, warning };
      }
    });
  },

  async appendToolCallRecord(runId: string, toolCall: ToolCallRecord): Promise<AppendResult> {
    return lockedOr(runId, (warning) => ({ appended: false, run_id: runId, warning }), async () => {
      try {
        const saved = await readSavedRun(runId);
        if (!saved) {
          return { appended: false, run_id: runId, warning: `Run ${runId} not found.` };
        }

        // Idempotency: skip duplicate tool_call_ids.
        const exists = saved.toolCalls.some((tc) => tc.tool_call_id === toolCall.tool_call_id);
        if (!exists) {
          saved.toolCalls.push(toolCall);
        }

        saved.updatedAt = new Date().toISOString();
        await writeSavedRun(saved);
        await upsertIndex(buildRunSummary(saved));

        return { appended: !exists, run_id: runId };
      } catch (err) {
        const warning = err instanceof Error ? err.message : "Unknown persistence error";
        return { appended: false, run_id: runId, warning };
      }
    });
  },

  async appendEvalResult(runId: string, evalResult: EvalResult): Promise<AppendResult> {
    return lockedOr(runId, (warning) => ({ appended: false, run_id: runId, warning }), async () => {
      try {
        const saved = await readSavedRun(runId);
        if (!saved) {
          return { appended: false, run_id: runId, warning: `Run ${runId} not found.` };
        }

        // Idempotency: skip duplicate eval_ids.
        const exists = saved.evalResults.some((e) => e.eval_id === evalResult.eval_id);
        if (!exists) {
          saved.evalResults.push(evalResult);
        }

        saved.updatedAt = new Date().toISOString();
        await writeSavedRun(saved);
        await upsertIndex(buildRunSummary(saved));

        return { appended: !exists, run_id: runId };
      } catch (err) {
        const warning = err instanceof Error ? err.message : "Unknown persistence error";
        return { appended: false, run_id: runId, warning };
      }
    });
  },

  async completeRun(runId: string, patch: Partial<RunRecord>): Promise<boolean> {
    return lockedOr(runId, () => false, async () => {
      try {
        const saved = await readSavedRun(runId);
        if (!saved) return false;

        // Allow "degraded" status to pass through — a run that completed but has
        // failing evals is "degraded", not "completed". Any other status provided
        // (e.g. null, "running") defaults to "completed".
        const finalStatus =
          patch.status === "degraded" ? "degraded" : "completed";

        saved.runRecord = {
          ...saved.runRecord,
          ...patch,
          status: finalStatus,
          completed_at: patch.completed_at ?? new Date().toISOString(),
        };
        saved.updatedAt = new Date().toISOString();

        await writeSavedRun(saved);
        await upsertIndex(buildRunSummary(saved));

        return true;
      } catch {
        return false;
      }
    });
  },

  async failRun(runId: string, patch: Partial<RunRecord>): Promise<boolean> {
    return lockedOr(runId, () => false, async () => {
      try {
        const saved = await readSavedRun(runId);
        if (!saved) return false;

        saved.runRecord = {
          ...saved.runRecord,
          ...patch,
          status: "failed",
          completed_at: patch.completed_at ?? new Date().toISOString(),
        };
        saved.updatedAt = new Date().toISOString();

        await writeSavedRun(saved);
        await upsertIndex(buildRunSummary(saved));

        return true;
      } catch {
        return false;
      }
    });
  },

  async getRun(runId: string): Promise<SavedRun | null> {
    return readSavedRun(runId);
  },

  async listRuns(filters?: { projectId?: string; workflowId?: string; status?: string; limit?: number }): Promise<RunSummary[]> {
    try {
      let entries = await readIndex();
      if (filters?.projectId) {
        entries = entries.filter((e) => e.project_id === filters.projectId);
      }
      if (filters?.workflowId) {
        entries = entries.filter((e) => e.workflow_id === filters.workflowId);
      }
      if (filters?.status) {
        entries = entries.filter((e) => e.status === filters.status);
      }
      if (filters?.limit && filters.limit > 0) {
        entries = entries.slice(0, filters.limit);
      }
      return entries;
    } catch {
      return [];
    }
  },

  async deleteRun(runId: string): Promise<boolean> {
    try {
      await withRunWriteLock(runId, () => unlink(runPath(runId)));
      await withRunIndexLock(async () => {
        const existing = await readIndex();
        await writeIndex(existing.filter((e) => e.run_id !== runId));
      });
      return true;
    } catch {
      return false;
    }
  },
};
