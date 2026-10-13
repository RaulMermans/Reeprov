/**
 * Regression Release Gate Engine.
 *
 * Implements deterministic policy evaluation for CI and release progression:
 * - Deterministic exit codes: 0 = PASS, 1 = FAIL, 2 = INCONCLUSIVE / NOT_COMPARABLE.
 * - Enforces zero-tolerance safety guardrails.
 * - Generates machine-readable RegressionGateArtifact for CI/CD pipelines.
 * - Does not perform automated deployment: determines only whether evidence supports progression.
 */

import {
  type RegressionBaseline,
  type RegressionGatePolicy,
  type RegressionGateResult,
  type RegressionReport,
  type RegressionGateArtifact,
  type ComparabilityAssessment,
  regressionGateResultSchema,
  regressionReportSchema,
  regressionGateArtifactSchema,
  CANONICAL_REGRESSION_SCHEMA_VERSION,
} from "../contracts/regression";
import { ComparabilityEngine, type CandidateEvaluationContext } from "./comparability";
import { RegressionDetector, type DetectionInput } from "./detector";
import type { EvaluationRun } from "../contracts/evalDefinitions";
import type { RunArtifact } from "../contracts/runArtifact";
import type { RunComparison } from "../contracts/comparison";
import { saveRegressionGateResult, saveRegressionReport } from "./persistence";

export interface RunGateOptions {
  baseline: RegressionBaseline;
  candidateRunId: string;
  candidateConfigHash: string;
  candidateContext: CandidateEvaluationContext;
  baselineEvalRun?: EvaluationRun;
  candidateEvalRun: EvaluationRun;
  baselineArtifact?: RunArtifact;
  candidateArtifact?: RunArtifact;
  comparison?: RunComparison;
  baselineCaseIds?: string[];
  policy: RegressionGatePolicy;
  persist?: boolean;
}

export class RegressionGateEngine {
  /**
   * Executes a complete regression check against policy, producing an authoritative gate result.
   */
  static async evaluateGate(options: RunGateOptions): Promise<{
    gateResult: RegressionGateResult;
    report: RegressionReport;
    artifact: RegressionGateArtifact;
  }> {
    const {
      baseline,
      candidateRunId,
      candidateConfigHash,
      candidateContext,
      baselineEvalRun,
      candidateEvalRun,
      baselineArtifact,
      candidateArtifact,
      comparison,
      baselineCaseIds,
      policy,
      persist,
    } = options;

    const gateId = `gate_${baseline.baseline_id}_${candidateRunId}_${Date.now()}`;
    const reportId = `rep_${baseline.baseline_id}_${candidateRunId}_${Date.now()}`;

    // 1. Comparability assessment (apples-to-oranges guard)
    const comparability = ComparabilityEngine.assess(
      baseline,
      candidateContext,
      baselineCaseIds
    );

    // If NOT_COMPARABLE: return immediately with NOT_COMPARABLE status
    if (comparability.verdict === "NOT_COMPARABLE") {
      const summary = `NOT_COMPARABLE: Candidate and baseline use incompatible evaluation dimensions. ${comparability.reasons.join("; ")}. ${comparability.suggested_bridge_eval ?? ""}`;
      const failureReasons = [
        `Apples-to-oranges comparison rejected: Candidate and baseline use incompatible evaluation dimensions.`,
        ...comparability.reasons,
      ];
      const gateResult: RegressionGateResult = regressionGateResultSchema.parse({
        gate_id: gateId,
        policy_id: policy.policy_id,
        policy_version: policy.version,
        baseline_id: baseline.baseline_id,
        candidate_run_id: candidateRunId,
        candidate_config_hash: candidateConfigHash,
        status: "NOT_COMPARABLE",
        findings: [],
        critical_failures: [],
        failure_reasons: failureReasons,
        critical_failure_count: 0,
        new_regression_count: 0,
        existing_failure_count: 0,
        recovered_count: 0,
        warnings: comparability.warnings,
        comparability,
        case_matrix: [],
        summary,
        evidence_refs: [],
        created_at: new Date().toISOString(),
      });

      const report: RegressionReport = regressionReportSchema.parse({
        report_id: reportId,
        project_id: baseline.project_id,
        baseline,
        candidate_run_id: candidateRunId,
        candidate_config_hash: candidateConfigHash,
        policy,
        gate_result: gateResult,
        comparability,
        findings: [],
        case_matrix: [],
        statistical_evidence: {
          n_baseline: 0,
          n_candidate: 0,
          baseline_pass_rate: 0,
          candidate_pass_rate: 0,
          baseline_mean_score: 0,
          candidate_mean_score: 0,
          observed_movement: "NOT_COMPARABLE",
        },
        limitations: [
          "Candidate and baseline could not be meaningfully compared due to evaluation definition or dataset mismatches.",
        ],
        created_at: new Date().toISOString(),
      });

      const artifact = this.buildArtifact(gateResult, report, 2);

      if (persist !== false) {
        await saveRegressionGateResult(gateResult);
        await saveRegressionReport(report);
      }

      return { gateResult, report, artifact };
    }

    // 2. Run regression detection
    const detection = RegressionDetector.detect({
      baseline,
      candidateRunId,
      candidateConfigHash,
      baselineEvalRun,
      candidateEvalRun,
      baselineArtifact,
      candidateArtifact,
      comparison,
      policy,
    });

    // 3. Determine gate status
    const criticalFindings = detection.findings.filter((f) => f.severity === "CRITICAL");
    const failFindings = detection.findings.filter((f) => f.severity === "FAIL");
    const warnFindings = detection.findings.filter((f) => f.severity === "WARNING");

    let gateStatus: RegressionGateResult["status"] = "PASS";
    let exitCode = 0;

    // Check stochastic minimum trials
    const minTrials = policy.minimum_trials ?? 1;
    const trialsSufficient = detection.nCandidate >= minTrials;

    if (criticalFindings.length > 0 || detection.criticalFailures.length > 0) {
      gateStatus = "FAIL";
      exitCode = 1;
    } else if (failFindings.length > 0) {
      gateStatus = "FAIL";
      exitCode = 1;
    } else if (!trialsSufficient && minTrials > 1) {
      gateStatus = "INCONCLUSIVE";
      exitCode = 2;
    } else if (warnFindings.length > 0 || comparability.verdict === "COMPARABLE_WITH_WARNINGS") {
      gateStatus = "WARN";
      exitCode = 0;
    }

    let summary = "";
    if (gateStatus === "FAIL") {
      summary = `REGRESSION_GATE_FAILED: ${criticalFindings.length} critical and ${failFindings.length} standard regression(s) detected.`;
    } else if (gateStatus === "WARN") {
      summary = `REGRESSION_GATE_WARN: Passed with ${warnFindings.length} non-blocking warning(s).`;
    } else if (gateStatus === "INCONCLUSIVE") {
      summary = `INCONCLUSIVE: Insufficient sample size under stochastic minimum_trials policy (required ${minTrials}).`;
    } else {
      summary = `REGRESSION_GATE_PASSED: Zero regressions detected under policy "${policy.name}@v${policy.version}".`;
    }

    const newRegressions = detection.caseMatrix.filter((c) => c.status_transition === "NEW_REGRESSION").length;
    const existingFailures = detection.caseMatrix.filter((c) => c.status_transition === "EXISTING_FAILURE").length;
    const recoveredCount = detection.caseMatrix.filter((c) => c.status_transition === "RECOVERED").length;
    const criticalFailureCount = criticalFindings.length + detection.criticalFailures.length;

    const failureReasons: string[] = [];
    if (criticalFailureCount > 0) {
      failureReasons.push(
        `CRITICAL failure: ${criticalFindings.length} critical finding(s) and ${detection.criticalFailures.length} hard gate violation(s).`
      );
      failureReasons.push(...criticalFindings.map((f) => `CRITICAL: ${f.description || f.category}`));
      failureReasons.push(...detection.criticalFailures.map((cf) => `CRITICAL: ${cf}`));
    }
    if (failFindings.length > 0) {
      failureReasons.push(...failFindings.map((f) => `FAIL: ${f.description || f.category}`));
    }

    const gateResult: RegressionGateResult = regressionGateResultSchema.parse({
      gate_id: gateId,
      policy_id: policy.policy_id,
      policy_version: policy.version,
      baseline_id: baseline.baseline_id,
      candidate_run_id: candidateRunId,
      candidate_config_hash: candidateConfigHash,
      status: gateStatus,
      findings: detection.findings,
      critical_failures: detection.criticalFailures,
      failure_reasons: failureReasons,
      critical_failure_count: criticalFailureCount,
      new_regression_count: newRegressions,
      existing_failure_count: existingFailures,
      recovered_count: recoveredCount,
      warnings: [...detection.warnings, ...comparability.warnings],
      comparability,
      case_matrix: detection.caseMatrix,
      summary,
      evidence_refs: detection.caseMatrix.flatMap((c) => c.evidence_refs),
      created_at: new Date().toISOString(),
    });

    const report: RegressionReport = regressionReportSchema.parse({
      report_id: reportId,
      project_id: baseline.project_id,
      baseline,
      candidate_run_id: candidateRunId,
      candidate_config_hash: candidateConfigHash,
      policy,
      gate_result: gateResult,
      comparability,
      findings: detection.findings,
      case_matrix: detection.caseMatrix,
      statistical_evidence: {
        n_baseline: detection.nBaseline,
        n_candidate: detection.nCandidate,
        baseline_pass_rate: detection.baselinePassRate,
        candidate_pass_rate: detection.candidatePassRate,
        baseline_mean_score: detection.baselineMeanScore,
        candidate_mean_score: detection.candidateMeanScore,
        baseline_std_dev: detection.baselineStdDev,
        candidate_std_dev: detection.candidateStdDev,
        observed_movement: detection.observedMovement,
      },
      limitations: detection.warnings,
      regression_detected: gateStatus === "FAIL" || newRegressions > 0 || criticalFailureCount > 0,
      summary,
      created_at: new Date().toISOString(),
    });

    const artifact = this.buildArtifact(gateResult, report, exitCode);

    if (persist !== false) {
      await saveRegressionGateResult(gateResult);
      await saveRegressionReport(report);
    }

    return { gateResult, report, artifact };
  }

  private static buildArtifact(
    gateResult: RegressionGateResult,
    report: RegressionReport,
    exitCode: number
  ): RegressionGateArtifact {
    const caseRegs = gateResult.case_matrix.filter((c) => c.classification === "NEW_REGRESSION").length;
    const critRegs = gateResult.findings.filter((f) => f.severity === "CRITICAL").length;

    return regressionGateArtifactSchema.parse({
      schema_version: CANONICAL_REGRESSION_SCHEMA_VERSION,
      status: gateResult.status,
      exit_code: exitCode,
      gate_id: gateResult.gate_id,
      policy_id: gateResult.policy_id,
      baseline_id: gateResult.baseline_id,
      candidate_run_id: gateResult.candidate_run_id,
      critical_regressions: critRegs,
      case_regressions: caseRegs,
      metric_deltas: {
        pass_rate_delta: report.statistical_evidence.candidate_pass_rate - report.statistical_evidence.baseline_pass_rate,
        score_delta: report.statistical_evidence.candidate_mean_score - report.statistical_evidence.baseline_mean_score,
      },
      summary: gateResult.summary,
      timestamp: gateResult.created_at,
    });
  }
}
