/**
 * Evaluation Suite Runner Engine.
 *
 * Implements deterministic execution of EvalSuites against target RunArtifacts,
 * enforces suite pass policies, records grader costs, and attaches canonical
 * EvalResults to candidate or historical runs.
 *
 * Invariants:
 * - A critical eval failure fails the suite regardless of average score.
 * - Deterministic, weighted, or all-required-pass policies are strictly enforced.
 * - Missing evidence produces MISSING_EVIDENCE status, never fabricated failure.
 * - Grader errors (timeouts, schema failures) are distinct from agent failures.
 */

import { type RunArtifact } from "../contracts/runArtifact";
import {
  type EvalSuite,
  type EvaluationRun,
  type EvaluationSummary,
  type EvalDataset,
  type EvalCase,
  evaluationRunSchema,
} from "../contracts/evalDefinitions";
import type { EvalResult } from "../contracts/evals";
import type { RunComparison } from "../contracts/comparison";
import { getEvaluatorAdapterForGraderType } from "./graders";
import { enrichRunArtifactWithEvals } from "./enrichment";
import { saveEvaluationRun } from "./persistence";

export interface EvaluationRunOptions {
  evaluationRunId?: string;
  datasetId?: string;
  datasetVersion?: number;
  comparison?: RunComparison;
  enrichArtifact?: boolean;
  persist?: boolean;
  judgeHandler?: any;
  customAdapters?: Record<string, any>;
}

/**
 * Runs an EvalSuite against a single RunArtifact (post-hoc or candidate).
 */
export async function evaluateRun(
  artifact: RunArtifact,
  suite: EvalSuite,
  options: EvaluationRunOptions = {}
): Promise<EvaluationRun> {
  const startedAt = new Date().toISOString();
  const runStartTime = Date.now();
  const evaluationRunId =
    options.evaluationRunId ??
    `evrun_${suite.suite_id}_${artifact.identity.run_id}_${Date.now()}`;

  const results: EvalResult[] = [];
  const errors: string[] = [];
  let totalGraderCostUsd = 0;

  for (const def of suite.definitions) {
    const adapter = getEvaluatorAdapterForGraderType(def.grader_type);
    try {
      const evalRes = await adapter.evaluate({
        artifact,
        definition: def,
        comparison: options.comparison,
        options: {
          judgeHandler: options.judgeHandler,
          ...options.customAdapters,
        },
      });

      const annotatedResult: EvalResult = {
        ...evalRes,
        eval_suite_id: suite.suite_id,
        eval_suite_version: suite.version,
        evaluation_run_id: evaluationRunId,
      };

      results.push(annotatedResult);
      if (annotatedResult.grader_cost_usd) {
        totalGraderCostUsd += annotatedResult.grader_cost_usd;
      }
    } catch (err: any) {
      errors.push(`Evaluator error on ${def.eval_definition_id}: ${err.message ?? String(err)}`);
      results.push({
        eval_id: `eval_err_${def.eval_definition_id}_${Date.now()}`,
        eval_definition_id: def.eval_definition_id,
        eval_definition_version: def.version,
        eval_suite_id: suite.suite_id,
        eval_suite_version: suite.version,
        evaluation_run_id: evaluationRunId,
        eval_type: def.family,
        evaluator_id: adapter.evaluator_id,
        target_run_id: artifact.identity.run_id,
        name: def.name,
        passed: false,
        severity: def.severity,
        grader_type: def.grader_type,
        grader_status: "EVALUATOR_ERROR",
        findings: [`Grader execution failed: ${err.message ?? String(err)}`],
        timestamp: new Date().toISOString(),
        evidence_references: [],
      });
    }
  }

  // Calculate summary and verdict according to pass policy
  const summary = computeEvaluationSummary(suite, results);

  const durationMs = Date.now() - runStartTime;
  const completedAt = new Date().toISOString();

  const isPartial = errors.length > 0 || results.some((r) => r.grader_status === "EVALUATOR_ERROR");
  const isFailed = errors.length > 0 && results.length === 0;

  // Attach evaluations to the target RunArtifact
  let evaluatedArtifact: RunArtifact | undefined = undefined;
  if (options.enrichArtifact !== false) {
    evaluatedArtifact = await enrichRunArtifactWithEvals(artifact, results, {
      evaluation_run_id: evaluationRunId,
      suite_id: suite.suite_id,
      suite_version: suite.version,
      persist: options.persist !== false,
    });
  }

  const evalRun: EvaluationRun = {
    evaluation_run_id: evaluationRunId,
    suite_id: suite.suite_id,
    suite_version: suite.version,
    dataset_id: options.datasetId,
    dataset_version: options.datasetVersion,
    target_run_ids: [artifact.identity.run_id],
    status: isFailed ? "FAILED" : isPartial ? "PARTIAL" : "COMPLETED",
    started_at: startedAt,
    completed_at: completedAt,
    results,
    summary,
    cost_usd: totalGraderCostUsd,
    duration_ms: durationMs,
    errors,
    evaluated_artifact: evaluatedArtifact,
  };

  const parsedEvalRun = evaluationRunSchema.parse(evalRun);

  // Persist evaluation run
  if (options.persist !== false) {
    await saveEvaluationRun(parsedEvalRun);
  }

  return parsedEvalRun;
}

/**
 * Computes deterministic pass/fail verdict and weighted scores.
 */
export function computeEvaluationSummary(
  suite: EvalSuite,
  results: EvalResult[]
): EvaluationSummary {
  const total = results.length;
  const passed = results.filter((r) => r.passed && r.grader_status !== "EVALUATOR_ERROR" && r.grader_status !== "MISSING_EVIDENCE").length;
  const failed = results.filter((r) => !r.passed && r.grader_status !== "EVALUATOR_ERROR" && r.grader_status !== "MISSING_EVIDENCE").length;
  const errors = results.filter((r) => r.grader_status === "EVALUATOR_ERROR").length;
  const missing_evidence = results.filter((r) => r.grader_status === "MISSING_EVIDENCE").length;
  const pass_rate = total > 0 ? passed / total : 0;

  const policy = suite.pass_policy;
  const criticalEvalIds = new Set(policy.critical_eval_ids ?? []);
  const criticalFailures: string[] = [];

  // Check critical failures
  for (const r of results) {
    const isCriticalId = r.eval_definition_id && criticalEvalIds.has(r.eval_definition_id);
    const isCriticalSeverity = r.severity === "critical";
    if ((!r.passed || r.grader_status === "EVALUATOR_ERROR" || r.grader_status === "MISSING_EVIDENCE") && (isCriticalId || isCriticalSeverity)) {
      criticalFailures.push(r.eval_definition_id ?? r.eval_id);
    }
  }

  // Missing critical eval check
  for (const critId of criticalEvalIds) {
    const found = results.find((r) => r.eval_definition_id === critId);
    if (!found) {
      criticalFailures.push(`MISSING_CRITICAL:${critId}`);
    }
  }

  // Missing required eval check
  const requiredDefIds = new Set(suite.required_eval_ids ?? []);
  for (const def of suite.definitions) {
    if (def.required) requiredDefIds.add(def.eval_definition_id);
  }
  const missingRequired: string[] = [];
  for (const reqId of requiredDefIds) {
    const found = results.find((r) => r.eval_definition_id === reqId);
    if (!found) {
      missingRequired.push(reqId);
    }
  }

  let suite_verdict: "PASSED" | "FAILED" = "PASSED";
  let verdict_reason = "All evaluation criteria satisfied.";

  // Rule 0: Empty result set when definitions exist cannot pass
  if (suite.definitions.length > 0 && results.length === 0) {
    suite_verdict = "FAILED";
    verdict_reason = "No evaluation results were produced for configured suite definitions.";
  } else if (criticalFailures.length > 0) {
    // Rule 1: Critical safety/policy failures FAIL the suite immediately
    suite_verdict = "FAILED";
    verdict_reason = `Critical evaluation failure in: ${criticalFailures.join(", ")}`;
  } else if (missingRequired.length > 0) {
    suite_verdict = "FAILED";
    verdict_reason = `Required evaluation(s) missing from results: ${missingRequired.join(", ")}`;
  } else if (policy.mode === "ALL_REQUIRED_PASS") {
    // Required evals: either explicitly in required_eval_ids or definition.required = true
    const failedRequired = results.filter((r) => {
      const isReq = r.eval_definition_id && requiredDefIds.has(r.eval_definition_id);
      return isReq && (!r.passed || r.grader_status === "EVALUATOR_ERROR" || r.grader_status === "MISSING_EVIDENCE");
    });

    if (failedRequired.length > 0) {
      suite_verdict = "FAILED";
      verdict_reason = `Required evaluation(s) failed: ${failedRequired.map((f) => f.name).join(", ")}`;
    }
  } else if (policy.mode === "WEIGHTED_SCORE") {
    const weights = policy.weights ?? {};
    let totalWeight = 0;
    let weightedSum = 0;

    for (const r of results) {
      const weight = r.eval_definition_id && weights[r.eval_definition_id] !== undefined
        ? weights[r.eval_definition_id]!
        : 1.0;
      totalWeight += weight;
      const score = typeof r.score === "number" ? r.score : r.passed ? 1.0 : 0.0;
      weightedSum += score * weight;
    }

    const weighted_score = totalWeight > 0 ? weightedSum / totalWeight : pass_rate;
    const minScore = policy.minimum_weighted_score ?? 0.8;

    if (weighted_score < minScore) {
      suite_verdict = "FAILED";
      verdict_reason = `Weighted score (${weighted_score.toFixed(3)}) fell below minimum threshold (${minScore.toFixed(3)})`;
    }

    return {
      total,
      passed,
      failed,
      errors,
      missing_evidence,
      pass_rate,
      weighted_score,
      suite_verdict,
      verdict_reason,
      critical_failures: criticalFailures,
    };
  }

  return {
    total,
    passed,
    failed,
    errors,
    missing_evidence,
    pass_rate,
    suite_verdict,
    verdict_reason,
    critical_failures: criticalFailures,
  };
}

/**
 * Runs an EvalSuite against an entire EvalDataset, executing each case through runnerFn.
 */
export async function evaluateDataset(
  dataset: EvalDataset,
  suite: EvalSuite,
  runnerFn: (caseItem: EvalCase) => Promise<RunArtifact>,
  options: EvaluationRunOptions = {}
): Promise<EvaluationRun> {
  const startedAt = new Date().toISOString();
  const runStartTime = Date.now();
  const evaluationRunId =
    options.evaluationRunId ??
    `evrun_ds_${dataset.dataset_id}_${suite.suite_id}_${Date.now()}`;

  const allResults: EvalResult[] = [];
  const targetRunIds: string[] = [];
  const errors: string[] = [];
  let totalCost = 0;

  for (const caseItem of dataset.cases) {
    try {
      const artifact = await runnerFn(caseItem);
      targetRunIds.push(artifact.identity.run_id);

      const singleRun = await evaluateRun(artifact, suite, {
        ...options,
        evaluationRunId: `${evaluationRunId}_case_${caseItem.case_id}`,
        datasetId: dataset.dataset_id,
        datasetVersion: dataset.version,
        persist: options.persist,
      });

      // Tag results with case_id
      for (const res of singleRun.results) {
        allResults.push({
          ...res,
          eval_case_id: caseItem.case_id,
          dataset_id: dataset.dataset_id,
          dataset_version: String(dataset.version),
        });
      }
      totalCost += singleRun.cost_usd;
    } catch (err: any) {
      errors.push(`Error executing case ${caseItem.case_id}: ${err.message ?? String(err)}`);
    }
  }

  const summary = computeEvaluationSummary(suite, allResults);
  const durationMs = Date.now() - runStartTime;

  const datasetEvalRun: EvaluationRun = {
    evaluation_run_id: evaluationRunId,
    suite_id: suite.suite_id,
    suite_version: suite.version,
    dataset_id: dataset.dataset_id,
    dataset_version: dataset.version,
    target_run_ids: targetRunIds,
    status: errors.length > 0 && allResults.length === 0 ? "FAILED" : "COMPLETED",
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    results: allResults,
    summary,
    cost_usd: totalCost,
    duration_ms: durationMs,
    errors,
  };

  const parsed = evaluationRunSchema.parse(datasetEvalRun);
  if (options.persist !== false) {
    await saveEvaluationRun(parsed);
  }

  return parsed;
}
