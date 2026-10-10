/**
 * Replay Persistence Layer.
 *
 * Implements dual-mode persistence (File + Postgres) for ReplayResult,
 * ReplayPlan, ReplayEvents, and ReplayDivergences with file-mode parity.
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ReplayResult,
  type ReplayPlan,
  replayResultSchema,
} from "./contracts";
import { getDb, hasDatabaseUrl } from "../../db/client";
import { ensureSchema } from "../../db/migrate";

function storeDir(): string {
  const base =
    process.env["AGENTPULSE_STORE_DIR"] ??
    join(process.cwd(), ".agentpulse");
  return join(base, "replays");
}

function safeId(id: string): string {
  return id.replace(/[^a-z0-9_-]/gi, "");
}

function replayFilePath(replayId: string): string {
  return join(storeDir(), `${safeId(replayId)}.json`);
}

function indexFilePath(): string {
  return join(storeDir(), "index.json");
}

async function ensureDir(): Promise<void> {
  const dir = storeDir();
  try {
    await access(dir);
  } catch {
    await mkdir(dir, { recursive: true });
  }
}

export interface ReplaySummary {
  replay_id: string;
  source_run_id: string;
  status: string;
  mode: string;
  deterministic_match: boolean;
  boundaries_substituted: number;
  divergence_count: number;
  completed_at: string;
}

/**
 * Saves a ReplayResult (and optional ReplayPlan) to storage.
 */
export async function saveReplayResult(
  result: ReplayResult,
  plan?: ReplayPlan
): Promise<void> {
  // Validate schema
  const validated = replayResultSchema.parse(result);

  // 1. File Store
  await ensureDir();
  const payload = {
    plan,
    result: validated,
  };
  await writeFile(replayFilePath(validated.replay_id), JSON.stringify(payload, null, 2), "utf8");

  // Update file index
  try {
    let index: ReplaySummary[] = [];
    try {
      const raw = await readFile(indexFilePath(), "utf8");
      index = JSON.parse(raw);
    } catch {
      index = [];
    }
    const summary: ReplaySummary = {
      replay_id: validated.replay_id,
      source_run_id: validated.source_run_id,
      status: validated.status,
      mode: validated.mode,
      deterministic_match: validated.deterministic_match,
      boundaries_substituted: validated.boundaries_substituted,
      divergence_count: validated.divergences.length,
      completed_at: validated.completed_at,
    };
    index = [summary, ...index.filter((r) => r.replay_id !== summary.replay_id)];
    await writeFile(indexFilePath(), JSON.stringify(index, null, 2), "utf8");
  } catch {
    // Non-fatal
  }

  // 2. Postgres Store (if available)
  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();

      // Upsert into ap_replay_runs
      await sql.unsafe(
        `INSERT INTO ap_replay_runs (
          replay_id, source_run_id, status, mode, deterministic_match,
          steps_expected, steps_executed, boundaries_expected, boundaries_substituted,
          live_calls_attempted, live_calls_blocked, started_at, completed_at,
          plan_data, result_data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (replay_id) DO UPDATE SET
          status = EXCLUDED.status,
          deterministic_match = EXCLUDED.deterministic_match,
          result_data = EXCLUDED.result_data,
          completed_at = EXCLUDED.completed_at`,
        [
          validated.replay_id,
          validated.source_run_id,
          validated.status,
          validated.mode,
          validated.deterministic_match,
          validated.steps_expected,
          validated.steps_executed,
          validated.boundaries_expected,
          validated.boundaries_substituted,
          validated.live_calls_attempted,
          validated.live_calls_blocked,
          validated.started_at,
          validated.completed_at,
          plan ? JSON.stringify(plan) : null,
          JSON.stringify(validated),
        ]
      );

      // Insert events
      for (const evt of validated.replay_events) {
        await sql.unsafe(
          `INSERT INTO ap_replay_events (
            event_id, replay_id, source_run_id, event_type, step_id, boundary_id, timestamp, data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (event_id) DO NOTHING`,
          [
            evt.event_id,
            evt.replay_id,
            evt.source_run_id,
            evt.event_type,
            evt.step_id ?? null,
            evt.boundary_id ?? null,
            evt.timestamp,
            evt.data ? JSON.stringify(evt.data) : null,
          ]
        );
      }

      // Insert divergences
      for (const div of validated.divergences) {
        await sql.unsafe(
          `INSERT INTO ap_replay_divergences (
            divergence_id, replay_id, source_run_id, divergence_type, step_index,
            boundary_sequence, severity, message, expected, actual, timestamp
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (divergence_id) DO NOTHING`,
          [
            div.divergence_id,
            div.replay_id,
            div.source_run_id,
            div.divergence_type,
            div.step_index ?? null,
            div.boundary_sequence ?? null,
            div.severity,
            div.message,
            JSON.stringify(div.expected),
            JSON.stringify(div.actual),
            div.timestamp,
          ]
        );
      }
    } catch (err) {
      console.warn("[AgentPulse Replay Postgres Warning]", err);
    }
  }
}

/**
 * Loads a ReplayResult by replay_id.
 */
export async function getReplayResult(replayId: string): Promise<ReplayResult | null> {
  // Check file store
  try {
    const raw = await readFile(replayFilePath(replayId), "utf8");
    const parsed = JSON.parse(raw);
    return replayResultSchema.parse(parsed.result ?? parsed);
  } catch {
    // Continue to DB
  }

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      const rows = (await sql.unsafe(
        `SELECT result_data FROM ap_replay_runs WHERE replay_id = $1 LIMIT 1`,
        [replayId]
      )) as Array<{ result_data: unknown }>;
      if (rows[0]?.result_data) {
        return replayResultSchema.parse(rows[0].result_data);
      }
    } catch {
      // Fallback
    }
  }

  return null;
}

/**
 * Lists all replays executed for a given source_run_id.
 */
export async function listReplaysForRun(sourceRunId: string): Promise<ReplayResult[]> {
  const results: ReplayResult[] = [];

  // From file index
  try {
    const raw = await readFile(indexFilePath(), "utf8");
    const index = JSON.parse(raw) as ReplaySummary[];
    const matching = index.filter((r) => r.source_run_id === sourceRunId);
    for (const item of matching) {
      const res = await getReplayResult(item.replay_id);
      if (res) results.push(res);
    }
    return results;
  } catch {
    // Continue
  }

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      const rows = (await sql.unsafe(
        `SELECT result_data FROM ap_replay_runs WHERE source_run_id = $1 ORDER BY created_at DESC`,
        [sourceRunId]
      )) as Array<{ result_data: unknown }>;
      for (const row of rows) {
        try {
          results.push(replayResultSchema.parse(row.result_data));
        } catch {
          // Skip invalid
        }
      }
    } catch {
      // Ignore
    }
  }

  return results;
}
