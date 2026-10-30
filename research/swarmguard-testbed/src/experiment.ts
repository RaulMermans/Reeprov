/**
 * Single documented experiment interface for Sprint P3.
 *
 * Lists cases, runs offline controls and injections, runs both baselines,
 * scores independently, exports results, and records reproducibility metadata.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runArtifactSchema } from "../../../lib/core/contracts/runArtifact";
import { exportRunEvidenceBundle } from "../../../lib/core/evidence/exportBundle";
import { FROZEN_BASELINES, runBaseline, type MonitorResult } from "./baselines";
import { BENCHMARK_VERSION, getBenchmarkCase, listBenchmarkCases, type Partition } from "./benchmark";
import { evaluateMonitor, evaluationToRow, type EvaluationReport } from "./evaluate";
import { investigationDomain } from "../domains/investigation";
import { softwareEngineeringDomain } from "../domains/softwareEngineering";
import { runExperiment, type ExperimentalRunResult, type HarnessOptions } from "./harness";
import type { DomainModule } from "./domain";
import { commitSha } from "./gitmeta";
import type { ExecutionMode } from "./contracts";

const DOMAINS: Record<string, DomainModule> = {
  "software-engineering": softwareEngineeringDomain,
  investigation: investigationDomain,
};

const DOMAIN_VARIANTS = new Set(["alt_gold", "incomplete", "sudo_focus"]);

export interface ExperimentRunOptions {
  caseId: string;
  mode?: ExecutionMode | string;
  outputDir: string;
  persist?: boolean;
  runId?: string;
}

export async function listScenarios(partition?: Partition) {
  return listBenchmarkCases(partition).map((item) => ({
    case_id: item.case_id,
    partition: item.partition,
    domain_id: item.domain_id,
    content_variant: item.content_variant,
    scenario_id: item.scenario_id,
    notes: item.notes,
  }));
}

export async function runBenchmarkCase(options: ExperimentRunOptions): Promise<ExperimentalRunResult> {
  const spec = getBenchmarkCase(options.caseId);
  const domain = DOMAINS[spec.domain_id];
  if (!domain) throw new Error(`Unknown domain ${spec.domain_id}`);
  const variant = DOMAIN_VARIANTS.has(spec.content_variant) ? spec.content_variant : "default";
  const harness: HarnessOptions = {
    mode: options.mode ?? "offline_fixture",
    injection: spec.injection,
    seed: spec.seed,
    variant,
    caseId: spec.case_id,
    mockTurns: spec.fixtureTurns,
    persist: options.persist ?? true,
    outputDir: options.outputDir,
    runId: options.runId,
    oracleTemplates: spec.oracle,
  };
  return runExperiment(domain, harness);
}

export function runBaselinesOnArtifact(
  result: ExperimentalRunResult,
  caseId?: string
): MonitorResult[] {
  const detectorArtifact = result.artifact;
  return FROZEN_BASELINES.map((id) =>
    runBaseline(id, detectorArtifact, { caseId: caseId ?? result.ground_truth.case_id, domainId: result.domain_id })
  );
}

export function scorePredictions(
  predictions: MonitorResult[],
  result: ExperimentalRunResult
): EvaluationReport[] {
  return predictions.map((prediction) =>
    evaluateMonitor({
      prediction,
      groundTruth: result.ground_truth,
      domainId: result.domain_id,
    })
  );
}

export async function exportExperimentBundle(input: {
  outputDir: string;
  result: ExperimentalRunResult;
  predictions: MonitorResult[];
  evaluations: EvaluationReport[];
}): Promise<{ dir: string }> {
  const dir = join(input.outputDir, "results", input.result.run_id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "reproducibility.json"),
    JSON.stringify(
      {
        format: "reeprov.swarmguard_testbed.reproducibility.v1",
        benchmark_version: BENCHMARK_VERSION,
        case_id: input.result.ground_truth.case_id,
        run_id: input.result.run_id,
        domain_id: input.result.domain_id,
        execution_mode: input.result.execution_mode,
        requested_mode: input.result.requested_mode,
        commit_sha: commitSha(),
        scenario_id: input.result.scenario_id,
        status: input.result.status,
        live_blocked: input.result.live_blocked,
        artifact_paths: {
          detector: input.result.persisted?.summary.detector_dir,
          evaluator: input.result.persisted?.summary.evaluator_dir,
        },
        exit_status: input.result.status,
      },
      null,
      2
    )
  );
  await writeFile(join(dir, "predictions.json"), JSON.stringify(input.predictions, null, 2));
  await writeFile(join(dir, "evaluations.json"), JSON.stringify(input.evaluations, null, 2));
  await writeFile(
    join(dir, "metrics-table.json"),
    JSON.stringify(input.evaluations.map(evaluationToRow), null, 2)
  );
  return { dir };
}

export function validateArtifactSchema(result: ExperimentalRunResult): { ok: boolean; issues: string[] } {
  const parsed = runArtifactSchema.safeParse(result.artifact);
  const issues: string[] = [];
  if (!parsed.success) {
    issues.push(...parsed.error.issues.map((issue) => issue.message));
  }
  try {
    exportRunEvidenceBundle(result.artifact);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  return { ok: issues.length === 0, issues };
}

export async function runAndEvaluate(options: ExperimentRunOptions): Promise<{
  result: ExperimentalRunResult;
  predictions: MonitorResult[];
  evaluations: EvaluationReport[];
}> {
  const result = await runBenchmarkCase(options);
  const predictions = runBaselinesOnArtifact(result, options.caseId);
  const evaluations = scorePredictions(predictions, result);
  if (options.persist !== false) {
    await exportExperimentBundle({
      outputDir: options.outputDir,
      result,
      predictions,
      evaluations,
    });
  }
  return { result, predictions, evaluations };
}

