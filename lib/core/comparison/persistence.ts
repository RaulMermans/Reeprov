/**
 * Run Comparison Persistence Engine.
 *
 * Implements dual-mode persistence (File + Postgres) for canonical RunComparison
 * artifacts and their associated divergences.
 *
 * Comparisons are persisted independently as derived artifacts;
 * Run A and Run B are strictly immutable.
 */

import { access, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { runComparisonSchema, type RunComparison } from "../contracts/comparison";
import { getDb, hasDatabaseUrl } from "../../db/client";
import { ensureSchema } from "../../db/migrate";

import { getReeprovEnv } from "@/lib/config/env";
import { getReeprovHome } from "@/lib/storage/dataPath";

function comparisonsDir(): string {
  const base =
    getReeprovEnv("REEPROV_STORE_DIR") ??
    getReeprovEnv("REEPROV_HOME") ??
    getReeprovHome();
  return join(base, "comparisons");
}

function safeId(id: string): string {
  return id.replace(/[^a-z0-9_-]/gi, "");
}

function comparisonFilePath(comparisonId: string): string {
  return join(comparisonsDir(), `${safeId(comparisonId)}.json`);
}

async function ensureComparisonsDir(): Promise<void> {
  const dir = comparisonsDir();
  try {
    await access(dir);
  } catch {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Saves a canonical RunComparison artifact to storage.
 */
export async function saveRunComparison(comparison: RunComparison): Promise<void> {
  const parsed = runComparisonSchema.parse(comparison);

  // 1. File persistence
  await ensureComparisonsDir();
  const filePath = comparisonFilePath(parsed.comparison_id);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  // 2. Postgres persistence (when DATABASE_URL is configured)
  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_run_comparisons (
          comparison_id,
          baseline_run_id,
          candidate_run_id,
          project_id,
          relationship,
          verdict,
          schema_version,
          comparison_data,
          created_at
        ) VALUES (
          ${parsed.comparison_id},
          ${parsed.baseline_run_id},
          ${parsed.candidate_run_id},
          ${parsed.project_id ?? null},
          ${parsed.relationship},
          ${parsed.verdict},
          ${parsed.schema_version},
          ${JSON.stringify(parsed)},
          ${parsed.created_at}
        )
        ON CONFLICT (comparison_id) DO UPDATE SET
          verdict = EXCLUDED.verdict,
          comparison_data = EXCLUDED.comparison_data
      `;

      // Persist divergences
      for (const div of parsed.divergences) {
        await sql`
          INSERT INTO ap_comparison_divergences (
            divergence_id,
            comparison_id,
            dimension,
            severity,
            deterministic,
            causal_status,
            description,
            divergence_data,
            created_at
          ) VALUES (
            ${div.divergence_id},
            ${parsed.comparison_id},
            ${div.dimension},
            ${div.severity ?? "info"},
            ${div.deterministic ?? true},
            ${div.causal_status ?? "OBSERVED_DIFFERENCE"},
            ${div.description},
            ${JSON.stringify(div)},
            ${parsed.created_at}
          )
          ON CONFLICT (divergence_id) DO NOTHING
        `;
      }
    } catch {
      // Postgres error degrades gracefully to file storage
    }
  }
}

/**
 * Retrieves a RunComparison artifact by ID.
 */
export async function getRunComparison(comparisonId: string): Promise<RunComparison | null> {
  // 1. Try Postgres if available
  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      const rows = await sql`
        SELECT comparison_data
        FROM ap_run_comparisons
        WHERE comparison_id = ${comparisonId}
      `;
      if (rows.length > 0) {
        const raw = typeof rows[0].comparison_data === "string"
          ? JSON.parse(rows[0].comparison_data)
          : rows[0].comparison_data;
        return runComparisonSchema.parse(raw);
      }
    } catch {
      // Fall through to filesystem
    }
  }

  // 2. Try file store
  try {
    const raw = await readFile(comparisonFilePath(comparisonId), "utf8");
    return runComparisonSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Lists RunComparison artifacts with optional filtering.
 */
export async function listRunComparisons(filter?: {
  baseline_run_id?: string;
  candidate_run_id?: string;
  project_id?: string;
}): Promise<RunComparison[]> {
  const comparisons: RunComparison[] = [];

  // 1. Try Postgres
  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      let query;
      if (filter?.baseline_run_id) {
        query = await sql`SELECT comparison_data FROM ap_run_comparisons WHERE baseline_run_id = ${filter.baseline_run_id} ORDER BY created_at DESC`;
      } else if (filter?.candidate_run_id) {
        query = await sql`SELECT comparison_data FROM ap_run_comparisons WHERE candidate_run_id = ${filter.candidate_run_id} ORDER BY created_at DESC`;
      } else if (filter?.project_id) {
        query = await sql`SELECT comparison_data FROM ap_run_comparisons WHERE project_id = ${filter.project_id} ORDER BY created_at DESC`;
      } else {
        query = await sql`SELECT comparison_data FROM ap_run_comparisons ORDER BY created_at DESC`;
      }

      for (const row of query) {
        const raw = typeof row.comparison_data === "string" ? JSON.parse(row.comparison_data) : row.comparison_data;
        comparisons.push(runComparisonSchema.parse(raw));
      }
      return comparisons;
    } catch {
      // Fall through to file store
    }
  }

  // 2. File store
  try {
    const dir = comparisonsDir();
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(dir, file), "utf8");
        const parsed = runComparisonSchema.parse(JSON.parse(raw));
        if (filter?.baseline_run_id && parsed.baseline_run_id !== filter.baseline_run_id) continue;
        if (filter?.candidate_run_id && parsed.candidate_run_id !== filter.candidate_run_id) continue;
        if (filter?.project_id && parsed.project_id !== filter.project_id) continue;
        comparisons.push(parsed);
      } catch {
        // Skip unparseable files
      }
    }
  } catch {
    // Directory may not exist yet
  }

  return comparisons;
}
