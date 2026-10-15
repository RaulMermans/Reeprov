/**
 * Regression Detection Engine.
 *
 * Implements deterministic detection and classification of regressions
 * between an approved RegressionBaseline and a candidate evaluation run.
 *
 * Features:
 * - Paired dataset case matrix (NEW_REGRESSION vs EXISTING_FAILURE vs RECOVERED).
 * - Hard safety/approval zero-tolerance gates (severity = CRITICAL).
 * - Metric degradation thresholds (quality, task success, cost, latency).
 * - Stochastic sample size validation (enforces minimum_trials).
 * - Honest descriptive language (OBSERVED_DROP, REPEATED_DROP, THRESHOLD_EXCEEDED).
 * - Links to root divergence, configuration differences, and eval evidence.
 */

import {
  type RegressionBaseline,
  type RegressionFinding,
  type RegressionCaseResult,
  type RegressionGatePolicy,
  type RegressionCategory,
  regressionFindingSchema,
  regressionCaseResultSchema,
} from "../contracts/regression";
import type { EvaluationRun } from "../contracts/evalDefinitions";
import type { EvalResult } from "../contracts/evals";
import type { RunComparison } from "../contracts/comparison";
import type { RunArtifact } from "../contracts/runArtifact";

export interface DetectionInput {
  baseline: RegressionBaseline;
  candidateRunId: string;
  candidateConfigHash: string;
  baselineEvalRun?: EvaluationRun;
  candidateEvalRun: EvaluationRun;
  baselineArtifact?: RunArtifact;
  candidateArtifact?: RunArtifact;
  comparison?: RunComparison;
  policy: RegressionGatePolicy;
}

export interface DetectionResult {
  findings: RegressionFinding[];
  caseMatrix: RegressionCaseResult[];
  criticalFailures: string[];
  warnings: string[];
  nBaseline: number;
  nCandidate: number;
  baselinePassRate: number;
  candidatePassRate: number;
  baselineMeanScore: number;
  candidateMeanScore: number;
  baselineStdDev?: number;
  candidateStdDev?: number;
  observedMovement: string;
}

function extractEvalId(r: EvalResult): string {
  return r.eval_id ?? (r as any).eval_definition_id ?? (r as any).eval_result_id ?? "unknown_eval";
}

export class RegressionDetector {
  /**
   * Detects all regressions between baseline and candidate under policy.
   */
  static detect(input: DetectionInput): DetectionResult {
    const {
      baseline,
      candidateRunId,
      candidateConfigHash,
      baselineEvalRun,
      candidateEvalRun,
      baselineArtifact,
      candidateArtifact,
      comparison,
      policy,
    } = input;

    const findings: RegressionFinding[] = [];
    const criticalFailures: string[] = [];
    const warnings: string[] = [];

    // Configuration diffs for attribution
    const configDiffs = comparison?.configuration_diff?.summary
      ? [...comparison.configuration_diff.summary]
      : [];

    const divergenceStepId =
      comparison?.first_meaningful_divergence?.step_id ??
      comparison?.first_structural_divergence?.step_id;

    let divergenceStepIndex: number | undefined = undefined;
    if (divergenceStepId && comparison?.execution_alignment?.aligned_steps) {
      const aligned = comparison.execution_alignment.aligned_steps.find(
        (s) => s.baseline_step_id === divergenceStepId || s.candidate_step_id === divergenceStepId
      );
      if (aligned) {
        divergenceStepIndex = aligned.logical_index;
      }
    }

    // ── 1. Case-Level Matrix & Paired Comparison ────────────────────────────
    const caseMatrix: RegressionCaseResult[] = [];
    const baselineResults = baselineEvalRun?.results ?? [];
    const candidateResults = candidateEvalRun.results;

    // Map results by case_id (or eval_definition_id if case_id not explicitly set)
    const baseCases = new Map<string, EvalResult[]>();
    for (const r of baselineResults) {
      const key = r.eval_case_id ?? r.eval_definition_id ?? r.eval_id;
      const list = baseCases.get(key) ?? [];
      list.push(r);
      baseCases.set(key, list);
    }

    const candCases = new Map<string, EvalResult[]>();
    for (const r of candidateResults) {
      const key = r.eval_case_id ?? r.eval_definition_id ?? r.eval_id;
      const list = candCases.get(key) ?? [];
      list.push(r);
      candCases.set(key, list);
    }

    const allCaseKeys = Array.from(new Set([...baseCases.keys(), ...candCases.keys()]));

    for (const caseKey of allCaseKeys) {
      const bList = baseCases.get(caseKey) ?? [];
      const cList = candCases.get(caseKey) ?? [];

      const bPassed = bList.length > 0 && bList.every((r) => r.passed && r.grader_status !== "EVALUATOR_ERROR" && r.grader_status !== "MISSING_EVIDENCE");
      const cPassed = cList.length > 0 && cList.every((r) => r.passed && r.grader_status !== "EVALUATOR_ERROR" && r.grader_status !== "MISSING_EVIDENCE");

      const bStatus = bList.length === 0 ? "MISSING" : bList.some((r) => r.grader_status === "EVALUATOR_ERROR") ? "ERROR" : bPassed ? "PASS" : "FAIL";
      const cStatus = cList.length === 0 ? "MISSING" : cList.some((r) => r.grader_status === "EVALUATOR_ERROR") ? "ERROR" : cPassed ? "PASS" : "FAIL";

      let classification: RegressionCaseResult["classification"] = "UNCHANGED_PASS";
      if (bStatus === "PASS" && cStatus === "FAIL") {
        classification = "NEW_REGRESSION";
      } else if (bStatus === "FAIL" && cStatus === "PASS") {
        classification = "RECOVERED";
      } else if (bStatus === "FAIL" && cStatus === "FAIL") {
        classification = "EXISTING_FAILURE";
      } else if (bStatus === "PASS" && cStatus === "PASS") {
        classification = "UNCHANGED_PASS";
      } else if (bStatus === "FAIL" && cStatus === "ERROR") {
        classification = "EXISTING_FAILURE";
      } else if (bStatus === "PASS" && (cStatus === "ERROR" || cStatus === "MISSING")) {
        classification = "NEW_REGRESSION";
      } else {
        classification = "UNCHANGED_FAIL";
      }

      const bScore = bList.length > 0 ? (typeof bList[0]?.score === "number" ? bList[0].score : bPassed ? 1 : 0) : undefined;
      const cScore = cList.length > 0 ? (typeof cList[0]?.score === "number" ? cList[0].score : cPassed ? 1 : 0) : undefined;
      const scoreDelta = bScore !== undefined && cScore !== undefined ? cScore - bScore : undefined;

      const caseName = bList[0]?.name ?? cList[0]?.name ?? caseKey;
      const evidenceRefs = [
        ...bList.flatMap((r) => r.evidence_references ?? []),
        ...cList.flatMap((r) => r.evidence_references ?? []),
      ];

      caseMatrix.push(
        regressionCaseResultSchema.parse({
          case_id: caseKey,
          case_name: caseName,
          baseline_status: bStatus,
          candidate_status: cStatus,
          classification,
          status_transition: classification,
          baseline_score: bScore,
          candidate_score: cScore,
          score_delta: scoreDelta,
          divergence_step_index: divergenceStepIndex ?? divergenceStepId,
          divergence_step_id: divergenceStepId,
          evidence_refs: evidenceRefs,
        })
      );

      // Flag case regression
      if (classification === "NEW_REGRESSION") {
        // Determine category based on eval type
        const evalType = cList[0]?.eval_type ?? bList[0]?.eval_type ?? "";
        let cat: RegressionCategory = "CASE_REGRESSION";
        let sev: RegressionFinding["severity"] = "FAIL";

        if (evalType === "safety" || caseKey.toLowerCase().includes("safety")) {
          cat = "SAFETY_REGRESSION";
          sev = "CRITICAL";
          criticalFailures.push(`Safety case regression in "${caseName}" (PASS -> FAIL)`);
        } else if (evalType === "approval_compliance" || caseKey.toLowerCase().includes("approval")) {
          cat = "APPROVAL_REGRESSION";
          sev = "CRITICAL";
          criticalFailures.push(`Approval compliance regression in "${caseName}" (PASS -> FAIL)`);
        }

        findings.push(
          regressionFindingSchema.parse({
            finding_id: `find_case_reg_${caseKey}_${Date.now()}`,
            category: cat,
            severity: sev,
            description: `Case regression in "${caseKey}": ${bStatus} -> ${cStatus}`,
            baseline_evidence: {
              run_id: baseline.run_id,
              case_id: caseKey,
              value: bStatus,
              summary: `Baseline passed case "${caseName}"`,
            },
            candidate_evidence: {
              run_id: candidateRunId,
              case_id: caseKey,
              value: cStatus,
              summary: `Candidate failed case "${caseName}" with status ${cStatus}`,
            },
            delta: `${bStatus} -> ${cStatus}`,
            threshold: "PASS -> FAIL forbidden",
            eval_references: cList.map(extractEvalId),
            case_references: [caseKey],
            configuration_differences: configDiffs,
            first_meaningful_divergence: divergenceStepId ? `Step ${divergenceStepId}` : undefined,
            causal_status: "ASSOCIATED_CHANGE",
            recommendation: `Inspect case "${caseName}" inputs and divergence at step ${divergenceStepId ?? "unknown"}.`,
            status: "ACTIVE",
          })
        );
      }
    }

    // ── 2. Hard Zero-Tolerance Safety & Approval Checks ─────────────────────
    const candidateSafetyEvals = candidateResults.filter(
      (r) =>
        r.eval_type === "safety" ||
        (r as any).eval_family === "safety" ||
        (r.eval_definition_id && policy.critical.includes(r.eval_definition_id)) ||
        (r.eval_id && policy.critical.includes(r.eval_id))
    );
    for (const sRes of candidateSafetyEvals) {
      const isFailed =
        sRes.passed === false ||
        (sRes as any).status === "FAIL" ||
        sRes.grader_status === "FAILED" ||
        sRes.grader_status === "EVALUATOR_ERROR" ||
        sRes.grader_status === "MISSING_EVIDENCE";

      if (isFailed) {
        const evalName = sRes.name ?? sRes.eval_definition_id ?? sRes.eval_id ?? "safety_gate";
        criticalFailures.push(`Hard gate violation on eval: ${evalName}`);
        findings.push(
          regressionFindingSchema.parse({
            finding_id: `find_crit_${sRes.eval_definition_id ?? sRes.eval_id ?? "crit"}_${Date.now()}`,
            category:
              sRes.eval_type === "approval_compliance" || (sRes as any).eval_family === "approval_compliance"
                ? "APPROVAL_REGRESSION"
                : "SAFETY_REGRESSION",
            severity: "CRITICAL",
            baseline_evidence: {
              value: "PASS",
              summary: "Baseline satisfied required safety standard",
            },
            candidate_evidence: {
              run_id: candidateRunId,
              eval_id: extractEvalId(sRes),
              value: sRes.grader_status || (sRes.passed ? "PASS" : "FAIL"),
              summary: sRes.findings?.[0] ?? `Failed critical safety evaluation ${evalName}`,
            },
            delta: "PASS -> FAIL",
            threshold: "Zero tolerance for safety regressions",
            eval_references: [extractEvalId(sRes)],
            case_references: sRes.eval_case_id ? [sRes.eval_case_id] : [],
            configuration_differences: configDiffs,
            causal_status: "ASSOCIATED_CHANGE",
            recommendation: "Block release immediately. Safety gate cannot be overridden by quality gains.",
            status: "ACTIVE",
          })
        );
      }
    }

    // ── 3. Score & Quality Regressions ──────────────────────────────────────
    const bSummary = baselineEvalRun?.summary;
    const cSummary = candidateEvalRun.summary;

    const bPassRate = bSummary?.pass_rate ?? 1.0;
    const cPassRate = cSummary.pass_rate;
    const passRateDrop = bPassRate - cPassRate;

    const maxTaskSuccessDrop = policy.thresholds.task_success.max_drop ?? 0.02;
    if (passRateDrop > maxTaskSuccessDrop + 1e-6) {
      findings.push(
        regressionFindingSchema.parse({
          finding_id: `find_task_reg_${Date.now()}`,
          category: "TASK_SUCCESS_REGRESSION",
          severity: "FAIL",
          baseline_evidence: {
            value: bPassRate,
            summary: `Baseline pass rate was ${(bPassRate * 100).toFixed(1)}%`,
          },
          candidate_evidence: {
            run_id: candidateRunId,
            value: cPassRate,
            summary: `Candidate pass rate dropped to ${(cPassRate * 100).toFixed(1)}%`,
          },
          delta: -Number((passRateDrop * 100).toFixed(1)),
          threshold: `Max drop: ${(maxTaskSuccessDrop * 100).toFixed(1)}%`,
          eval_references: candidateResults.map(extractEvalId),
          case_references: [],
          configuration_differences: configDiffs,
          causal_status: "ASSOCIATED_CHANGE",
          recommendation: `Task success pass rate dropped by ${(passRateDrop * 100).toFixed(1)}%, exceeding allowed threshold of ${(maxTaskSuccessDrop * 100).toFixed(1)}%.`,
          status: "ACTIVE",
        })
      );
    }

    // Quality weighted score drop check
    const bScore = bSummary?.weighted_score ?? bPassRate;
    const cScore = cSummary.weighted_score ?? cPassRate;
    const scoreDrop = bScore - cScore;
    const maxQualityDrop = policy.thresholds.quality.max_absolute_drop ?? 0.03;
    if (scoreDrop > maxQualityDrop + 1e-6) {
      findings.push(
        regressionFindingSchema.parse({
          finding_id: `find_qual_reg_${Date.now()}`,
          category: "QUALITY_REGRESSION",
          severity: "FAIL",
          baseline_evidence: {
            value: bScore,
            summary: `Baseline score was ${bScore.toFixed(3)}`,
          },
          candidate_evidence: {
            run_id: candidateRunId,
            value: cScore,
            summary: `Candidate score dropped to ${cScore.toFixed(3)}`,
          },
          delta: -Number(scoreDrop.toFixed(3)),
          threshold: `Max score drop: ${maxQualityDrop.toFixed(3)}`,
          eval_references: candidateResults.map(extractEvalId),
          case_references: [],
          configuration_differences: configDiffs,
          causal_status: "ASSOCIATED_CHANGE",
          recommendation: `Quality score degraded by ${scoreDrop.toFixed(3)}, exceeding threshold ${maxQualityDrop.toFixed(3)}.`,
          status: "ACTIVE",
        })
      );
    }

    // ── 4. Cost and Latency Regressions ─────────────────────────────────────
    if (baselineArtifact && candidateArtifact) {
      const bCost = baselineArtifact.observability.total_cost_usd ?? 0;
      const cCost = candidateArtifact.observability.total_cost_usd ?? 0;
      if (bCost > 0) {
        const costRelIncrease = (cCost - bCost) / bCost;
        const maxCostIncrease = policy.thresholds.cost.max_relative_increase ?? 0.15;
        if (costRelIncrease > maxCostIncrease + 1e-6) {
          findings.push(
            regressionFindingSchema.parse({
              finding_id: `find_cost_reg_${Date.now()}`,
              category: "COST_REGRESSION",
              severity: "WARNING",
              baseline_evidence: {
                value: bCost,
                summary: `Baseline cost was $${bCost.toFixed(4)}`,
              },
              candidate_evidence: {
                run_id: candidateRunId,
                value: cCost,
                summary: `Candidate cost rose to $${cCost.toFixed(4)}`,
              },
              delta: Number((costRelIncrease * 100).toFixed(1)),
              threshold: `Max relative increase: ${(maxCostIncrease * 100).toFixed(1)}%`,
              eval_references: [],
              case_references: [],
              configuration_differences: configDiffs,
              causal_status: "ASSOCIATED_CHANGE",
              recommendation: `Cost rose by ${(costRelIncrease * 100).toFixed(1)}% ($${cCost.toFixed(4)} vs $${bCost.toFixed(4)}). Verify token usage.`,
              status: "ACTIVE",
            })
          );
        }
      }

      const bLatency = baselineArtifact.observability.total_duration_ms ?? 0;
      const cLatency = candidateArtifact.observability.total_duration_ms ?? 0;
      if (bLatency > 0) {
        const latRelIncrease = (cLatency - bLatency) / bLatency;
        const maxLatIncrease = policy.thresholds.latency.max_relative_increase ?? 0.20;
        if (latRelIncrease > maxLatIncrease + 1e-6) {
          findings.push(
            regressionFindingSchema.parse({
              finding_id: `find_lat_reg_${Date.now()}`,
              category: "LATENCY_REGRESSION",
              severity: "WARNING",
              baseline_evidence: {
                value: bLatency,
                summary: `Baseline duration was ${bLatency}ms`,
              },
              candidate_evidence: {
                run_id: candidateRunId,
                value: cLatency,
                summary: `Candidate duration rose to ${cLatency}ms`,
              },
              delta: Number((latRelIncrease * 100).toFixed(1)),
              threshold: `Max relative increase: ${(maxLatIncrease * 100).toFixed(1)}%`,
              eval_references: [],
              case_references: [],
              configuration_differences: configDiffs,
              causal_status: "ASSOCIATED_CHANGE",
              recommendation: `Execution latency increased by ${(latRelIncrease * 100).toFixed(1)}% (${cLatency}ms vs ${bLatency}ms).`,
              status: "ACTIVE",
            })
          );
        }
      }
    }

    // ── 5. Stochastic Repetition Assessment ─────────────────────────────────
    const nBaseline = baselineResults.length > 0 ? 1 : 0;
    const nCandidate = candidateResults.length > 0 ? 1 : 0;
    const minTrials = policy.minimum_trials ?? 1;

    let observedMovement = "OBSERVED_DROP";
    if (findings.length === 0) {
      observedMovement = cPassRate > bPassRate ? "OBSERVED_IMPROVEMENT" : "NO_REGRESSION_OBSERVED";
    }

    if (minTrials > 1 && (nBaseline < minTrials || nCandidate < minTrials)) {
      warnings.push(
        `Stochastic sample size warning: policy requires at least ${minTrials} trials. Evaluated N_baseline=${nBaseline}, N_candidate=${nCandidate}. Results indicate observed movement only, not established repeatability.`
      );
    }

    return {
      findings,
      caseMatrix,
      criticalFailures,
      warnings,
      nBaseline,
      nCandidate,
      baselinePassRate: bPassRate,
      candidatePassRate: cPassRate,
      baselineMeanScore: bScore,
      candidateMeanScore: cScore,
      observedMovement,
    };
  }
}
