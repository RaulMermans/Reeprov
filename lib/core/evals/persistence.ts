/**
 * Eval Studio Persistence Engine.
 *
 * Implements dual-mode persistence (File + Postgres) for:
 * - EvalDefinitions (versioned, immutable)
 * - EvalSuites (versioned, immutable)
 * - EvalDatasets & EvalCases (versioned, immutable)
 * - EvaluationRuns (immutable once completed)
 *
 * Directory layout:
 * .reeprov/evals/definitions/
 * .reeprov/evals/suites/
 * .reeprov/evals/datasets/
 * .reeprov/evals/runs/
 */

import { access, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  evalDefinitionSchema,
  evalSuiteSchema,
  evalDatasetSchema,
  evalCaseSchema,
  evaluationRunSchema,
  type EvalDefinition,
  type EvalSuite,
  type EvalDataset,
  type EvalCase,
  type EvaluationRun,
} from "../contracts/evalDefinitions";
import { getDb, hasDatabaseUrl } from "../../db/client";
import { ensureSchema } from "../../db/migrate";
import { getCanonicalRun } from "../capture/persistence";

import { getReeprovEnv } from "@/lib/config/env";
import { getReeprovHome } from "@/lib/storage/dataPath";

function baseEvalsDir(): string {
  const base =
    getReeprovEnv("REEPROV_STORE_DIR") ??
    getReeprovEnv("REEPROV_HOME") ??
    getReeprovHome();
  return join(base, "evals");
}

function safeId(id: string): string {
  return id.replace(/[^a-z0-9_@-]/gi, "");
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await access(dirPath);
  } catch {
    await mkdir(dirPath, { recursive: true });
  }
}

// ── 1. Eval Definitions ──────────────────────────────────────────────────────

function definitionsDir(): string {
  return join(baseEvalsDir(), "definitions");
}

export async function saveEvalDefinition(definition: EvalDefinition): Promise<void> {
  const parsed = evalDefinitionSchema.parse(definition);
  await ensureDir(definitionsDir());
  const filePath = join(definitionsDir(), `${safeId(parsed.eval_definition_id)}@${parsed.version}.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_eval_definitions (
          eval_definition_id,
          version,
          name,
          family,
          target_scope,
          grader_type,
          severity,
          required,
          content_hash,
          definition_data,
          created_at
        ) VALUES (
          ${parsed.eval_definition_id},
          ${parsed.version},
          ${parsed.name},
          ${parsed.family},
          ${parsed.target_scope},
          ${parsed.grader_type},
          ${parsed.severity},
          ${parsed.required},
          ${parsed.content_hash},
          ${JSON.stringify(parsed)},
          ${parsed.created_at}
        )
        ON CONFLICT (eval_definition_id, version) DO NOTHING
      `;
    } catch {
      // Non-fatal if DB unavailable
    }
  }
}

export async function getEvalDefinition(id: string, version: number = 1): Promise<EvalDefinition | null> {
  const filePath = join(definitionsDir(), `${safeId(id)}@${version}.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    return evalDefinitionSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listEvalDefinitions(): Promise<EvalDefinition[]> {
  try {
    await ensureDir(definitionsDir());
    const files = await readdir(definitionsDir());
    const results: EvalDefinition[] = [];
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const raw = await readFile(join(definitionsDir(), f), "utf8");
          results.push(evalDefinitionSchema.parse(JSON.parse(raw)));
        } catch {
          // ignore corrupted files
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ── 2. Eval Suites ──────────────────────────────────────────────────────────

function suitesDir(): string {
  return join(baseEvalsDir(), "suites");
}

export async function saveEvalSuite(suite: EvalSuite): Promise<void> {
  const parsed = evalSuiteSchema.parse(suite);
  await ensureDir(suitesDir());
  const filePath = join(suitesDir(), `${safeId(parsed.suite_id)}@${parsed.version}.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_eval_suites (
          suite_id,
          version,
          name,
          content_hash,
          suite_data,
          created_at
        ) VALUES (
          ${parsed.suite_id},
          ${parsed.version},
          ${parsed.name},
          ${parsed.content_hash},
          ${JSON.stringify(parsed)},
          ${parsed.created_at}
        )
        ON CONFLICT (suite_id, version) DO NOTHING
      `;
    } catch {
      // Non-fatal
    }
  }
}

export async function getEvalSuite(id: string, version: number = 1): Promise<EvalSuite | null> {
  const filePath = join(suitesDir(), `${safeId(id)}@${version}.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    return evalSuiteSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listEvalSuites(): Promise<EvalSuite[]> {
  try {
    await ensureDir(suitesDir());
    const files = await readdir(suitesDir());
    const results: EvalSuite[] = [];
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const raw = await readFile(join(suitesDir(), f), "utf8");
          results.push(evalSuiteSchema.parse(JSON.parse(raw)));
        } catch {
          // ignore corrupted files
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ── 3. Eval Datasets & Cases ────────────────────────────────────────────────

function datasetsDir(): string {
  return join(baseEvalsDir(), "datasets");
}

export async function saveEvalDataset(dataset: EvalDataset): Promise<void> {
  const parsed = evalDatasetSchema.parse(dataset);
  await ensureDir(datasetsDir());
  const filePath = join(datasetsDir(), `${safeId(parsed.dataset_id)}@${parsed.version}.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_eval_datasets (
          dataset_id,
          version,
          name,
          content_hash,
          case_count,
          dataset_data,
          created_at
        ) VALUES (
          ${parsed.dataset_id},
          ${parsed.version},
          ${parsed.name},
          ${parsed.content_hash},
          ${parsed.cases.length},
          ${JSON.stringify(parsed)},
          ${parsed.created_at}
        )
        ON CONFLICT (dataset_id, version) DO NOTHING
      `;

      for (const c of parsed.cases) {
        await sql`
          INSERT INTO ap_eval_cases (
            case_id,
            dataset_id,
            dataset_version,
            name,
            source_run_id,
            case_data
          ) VALUES (
            ${c.case_id},
            ${parsed.dataset_id},
            ${parsed.version},
            ${c.name},
            ${c.source_run_id ?? null},
            ${JSON.stringify(c)}
          )
          ON CONFLICT (case_id, dataset_id, dataset_version) DO NOTHING
        `;
      }
    } catch {
      // Non-fatal
    }
  }
}

export async function getEvalDataset(id: string, version: number = 1): Promise<EvalDataset | null> {
  const filePath = join(datasetsDir(), `${safeId(id)}@${version}.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    return evalDatasetSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listEvalDatasets(): Promise<EvalDataset[]> {
  try {
    await ensureDir(datasetsDir());
    const files = await readdir(datasetsDir());
    const results: EvalDataset[] = [];
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const raw = await readFile(join(datasetsDir(), f), "utf8");
          results.push(evalDatasetSchema.parse(JSON.parse(raw)));
        } catch {
          // ignore
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function getEvalCase(
  datasetId: string,
  caseId: string,
  version: number = 1
): Promise<EvalCase | null> {
  const dataset = await getEvalDataset(datasetId, version);
  if (!dataset) return null;
  return dataset.cases.find((c) => c.case_id === caseId) ?? null;
}

/**
 * Curates a production failure or historical run into an explicit, reproducible EvalCase.
 * Does not curate automatically; requires explicit user action.
 */
export async function saveRunAsEvalCase(
  runId: string,
  options: {
    datasetId: string;
    datasetVersion?: number;
    caseName: string;
    checkpointId?: string;
    expected?: unknown;
    tags?: string[];
  }
): Promise<EvalCase> {
  const artifact = await getCanonicalRun(runId);
  if (!artifact) {
    throw new Error(`Run ${runId} not found; cannot create eval case`);
  }

  const caseId = `case_run_${safeId(runId)}_${Date.now()}`;
  const evalCase: EvalCase = evalCaseSchema.parse({
    case_id: caseId,
    name: options.caseName,
    input: artifact.trajectory[0]?.input_summary ?? { run_id: runId },
    expected: options.expected ?? artifact.evidence?.final_outcome?.payload,
    source_run_id: runId,
    source_checkpoint_id: options.checkpointId,
    artifact_refs: artifact.artifacts.map((a) => a.uri ?? a.artifact_id),
    tags: options.tags ?? ["production_regression", "curated"],
    metadata: {
      workflow_id: artifact.identity.workflow_id,
      original_outcome: artifact.evidence?.final_outcome?.status,
    },
  });

  const datasetVersion = options.datasetVersion ?? 1;
  let dataset = await getEvalDataset(options.datasetId, datasetVersion);
  if (!dataset) {
    dataset = {
      dataset_id: options.datasetId,
      name: `Dataset ${options.datasetId}`,
      version: datasetVersion,
      cases: [evalCase],
      created_at: new Date().toISOString(),
      content_hash: "initial",
    };
  } else {
    // Add case and update dataset
    dataset = {
      ...dataset,
      cases: [...dataset.cases.filter((c) => c.case_id !== evalCase.case_id), evalCase],
    };
  }

  await saveEvalDataset(dataset);
  return evalCase;
}

// ── 4. Evaluation Runs ──────────────────────────────────────────────────────

function runsDir(): string {
  return join(baseEvalsDir(), "runs");
}

export async function saveEvaluationRun(evalRun: EvaluationRun): Promise<void> {
  const parsed = evaluationRunSchema.parse(evalRun);
  await ensureDir(runsDir());
  const filePath = join(runsDir(), `${safeId(parsed.evaluation_run_id)}.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_evaluation_runs (
          evaluation_run_id,
          suite_id,
          suite_version,
          dataset_id,
          dataset_version,
          status,
          started_at,
          completed_at,
          verdict,
          pass_rate,
          total_evals,
          cost_usd,
          duration_ms,
          run_data
        ) VALUES (
          ${parsed.evaluation_run_id},
          ${parsed.suite_id},
          ${parsed.suite_version},
          ${parsed.dataset_id ?? null},
          ${parsed.dataset_version ?? null},
          ${parsed.status},
          ${parsed.started_at},
          ${parsed.completed_at ?? null},
          ${parsed.summary.suite_verdict},
          ${parsed.summary.pass_rate},
          ${parsed.summary.total},
          ${parsed.cost_usd},
          ${parsed.duration_ms},
          ${JSON.stringify(parsed)}
        )
        ON CONFLICT (evaluation_run_id) DO UPDATE SET
          status = EXCLUDED.status,
          completed_at = EXCLUDED.completed_at,
          run_data = EXCLUDED.run_data
      `;
    } catch {
      // Non-fatal
    }
  }
}

export async function getEvaluationRun(id: string): Promise<EvaluationRun | null> {
  const filePath = join(runsDir(), `${safeId(id)}.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    return evaluationRunSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listEvaluationRuns(): Promise<EvaluationRun[]> {
  try {
    await ensureDir(runsDir());
    const files = await readdir(runsDir());
    const results: EvaluationRun[] = [];
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const raw = await readFile(join(runsDir(), f), "utf8");
          results.push(evaluationRunSchema.parse(JSON.parse(raw)));
        } catch {
          // ignore
        }
      }
    }
    return results.sort((a, b) => b.started_at.localeCompare(a.started_at));
  } catch {
    return [];
  }
}
