/**
 * Experiment Lab Persistence Engine.
 *
 * Implements dual-mode persistence (File + Postgres) for:
 * - ExperimentDefinitions
 * - ExperimentTrials
 * - ExperimentResults
 *
 * File layout:
 * .reeprov/experiments/${id}.definition.json
 * .reeprov/experiments/${id}.result.json
 */

import { access, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  experimentDefinitionSchema,
  experimentResultSchema,
  type ExperimentDefinition,
  type ExperimentResult,
} from "../contracts/experiment";
import { getDb, hasDatabaseUrl } from "../../db/client";
import { ensureSchema } from "../../db/migrate";

import { getReeprovEnv } from "@/lib/config/env";
import { getReeprovHome } from "@/lib/storage/dataPath";

function experimentsDir(): string {
  const base =
    getReeprovEnv("REEPROV_STORE_DIR") ??
    getReeprovEnv("REEPROV_HOME") ??
    getReeprovHome();
  return join(base, "experiments");
}

function safeId(id: string): string {
  return id.replace(/[^a-z0-9_-]/gi, "");
}

async function ensureExperimentsDir(): Promise<void> {
  const dir = experimentsDir();
  try {
    await access(dir);
  } catch {
    await mkdir(dir, { recursive: true });
  }
}

export async function saveExperimentDefinition(
  definition: ExperimentDefinition
): Promise<void> {
  const parsed = experimentDefinitionSchema.parse(definition);
  await ensureExperimentsDir();
  const filePath = join(experimentsDir(), `${safeId(parsed.experiment_id)}.definition.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_experiments (
          experiment_id,
          name,
          hypothesis,
          baseline_run_id,
          eval_suite_id,
          status,
          arms_count,
          repetitions,
          experiment_data,
          created_at
        ) VALUES (
          ${parsed.experiment_id},
          ${parsed.name},
          ${parsed.hypothesis ?? null},
          ${parsed.baseline_run_id},
          ${parsed.eval_suite_id},
          ${parsed.status},
          ${parsed.arms.length},
          ${parsed.repetitions},
          ${JSON.stringify(parsed)},
          ${parsed.created_at}
        )
        ON CONFLICT (experiment_id) DO UPDATE SET
          status = EXCLUDED.status,
          experiment_data = EXCLUDED.experiment_data
      `;
    } catch {
      // Non-fatal
    }
  }
}

export async function getExperimentDefinition(
  experimentId: string
): Promise<ExperimentDefinition | null> {
  const filePath = join(experimentsDir(), `${safeId(experimentId)}.definition.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    return experimentDefinitionSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listExperimentDefinitions(): Promise<ExperimentDefinition[]> {
  try {
    await ensureExperimentsDir();
    const files = await readdir(experimentsDir());
    const results: ExperimentDefinition[] = [];
    for (const f of files) {
      if (f.endsWith(".definition.json")) {
        try {
          const raw = await readFile(join(experimentsDir(), f), "utf8");
          results.push(experimentDefinitionSchema.parse(JSON.parse(raw)));
        } catch {
          // ignore corrupted files
        }
      }
    }
    return results.sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch {
    return [];
  }
}

export async function saveExperimentResult(
  result: ExperimentResult
): Promise<void> {
  const parsed = experimentResultSchema.parse(result);
  await ensureExperimentsDir();
  const filePath = join(experimentsDir(), `${safeId(parsed.experiment_id)}.result.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_experiment_results (
          experiment_id,
          status,
          baseline_arm_id,
          recommended_candidate,
          recommendation_basis,
          trials_executed,
          total_cost_usd,
          result_data,
          created_at,
          completed_at
        ) VALUES (
          ${parsed.experiment_id},
          ${parsed.status},
          ${parsed.baseline_arm_id},
          ${parsed.recommended_candidate ?? null},
          ${parsed.recommendation_basis},
          ${parsed.trial_summaries.length},
          ${parsed.budget_consumed.cost_usd},
          ${JSON.stringify(parsed)},
          ${parsed.created_at},
          ${parsed.completed_at}
        )
        ON CONFLICT (experiment_id) DO UPDATE SET
          status = EXCLUDED.status,
          recommended_candidate = EXCLUDED.recommended_candidate,
          recommendation_basis = EXCLUDED.recommendation_basis,
          result_data = EXCLUDED.result_data,
          completed_at = EXCLUDED.completed_at
      `;

      // Persist individual trials
      for (const t of parsed.trial_summaries) {
        await sql`
          INSERT INTO ap_experiment_trials (
            trial_id,
            experiment_id,
            arm_id,
            repetition_index,
            derived_run_id,
            status,
            candidate_cost_usd,
            grader_cost_usd,
            duration_ms,
            trial_data,
            started_at,
            completed_at
          ) VALUES (
            ${t.trial_id},
            ${parsed.experiment_id},
            ${t.arm_id},
            ${t.repetition_index},
            ${t.derived_run_id},
            ${t.status},
            ${t.candidate_cost_usd},
            ${t.grader_cost_usd},
            ${t.duration_ms},
            ${JSON.stringify(t)},
            ${t.started_at},
            ${t.completed_at ?? null}
          )
          ON CONFLICT (trial_id) DO NOTHING
        `;
      }
    } catch {
      // Non-fatal
    }
  }
}

export async function getExperimentResult(
  experimentId: string
): Promise<ExperimentResult | null> {
  const filePath = join(experimentsDir(), `${safeId(experimentId)}.result.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    return experimentResultSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listExperimentResults(): Promise<ExperimentResult[]> {
  try {
    await ensureExperimentsDir();
    const files = await readdir(experimentsDir());
    const results: ExperimentResult[] = [];
    for (const f of files) {
      if (f.endsWith(".result.json")) {
        try {
          const raw = await readFile(join(experimentsDir(), f), "utf8");
          results.push(experimentResultSchema.parse(JSON.parse(raw)));
        } catch {
          // ignore
        }
      }
    }
    return results.sort((a, b) => b.completed_at.localeCompare(a.completed_at));
  } catch {
    return [];
  }
}
