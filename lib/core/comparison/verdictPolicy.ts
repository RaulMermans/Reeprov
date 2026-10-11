/**
 * Comparison Verdict Policy Engine.
 *
 * Deterministically evaluates whether candidate run is IMPROVED, REGRESSED,
 * NEUTRAL, MIXED, or INCONCLUSIVE relative to baseline.
 *
 * Rejects pseudo-scientific "AI judges": consumes explicit RunOutcome,
 * TestResult, ReviewResult, SecurityEvent, and metric deltas.
 */

import type {
  ComparisonVerdict,
  ComparisonPolicy,
  OutcomeDiff,
  EvidenceDiff,
  MetricsDiff,
  ComparisonDivergence,
} from "../contracts/comparison";

export interface VerdictEvaluationInput {
  outcomeDiff: OutcomeDiff;
  evidenceDiff: EvidenceDiff;
  metricsDiff: MetricsDiff;
  divergences: ComparisonDivergence[];
  policy?: ComparisonPolicy;
}

export function evaluateComparisonVerdict(input: VerdictEvaluationInput): ComparisonVerdict {
  const { outcomeDiff, evidenceDiff, metricsDiff, divergences } = input;

  // 1. Identical runs: no divergences
  if (divergences.length === 0) {
    return "NEUTRAL";
  }

  // 2. Critical regressions: Outcome Failure, Security Violations, Failed Tests
  const outcomeRegressed =
    (outcomeDiff.baseline_status === "SUCCESS" || outcomeDiff.baseline_status === "PASSED") &&
    (outcomeDiff.candidate_status === "FAILURE" || outcomeDiff.candidate_status === "FAILED" || outcomeDiff.candidate_status === "BLOCKED");

  const secViolationsDelta = metricsDiff.deltas["security_violations"]?.absolute_delta ?? 0;
  const securityRegressed = secViolationsDelta > 0;

  const testsFailedDelta = metricsDiff.deltas["tests_failed"]?.absolute_delta ?? 0;
  const testsRegressed =
    testsFailedDelta > 0 ||
    evidenceDiff.test_diffs.some((t) => t.before_status === "PASSED" && (t.after_status === "FAILED" || t.after_status === "FAILURE"));

  const evalsFailedDelta = metricsDiff.deltas["evals_failed"]?.absolute_delta ?? 0;
  const evalsRegressed = evalsFailedDelta > 0;

  const hasAnyRegression = outcomeRegressed || securityRegressed || testsRegressed || evalsRegressed;

  // 3. Significant improvements: Outcome Success, More Tests Passed, Fewer Security Violations
  const outcomeImproved =
    (outcomeDiff.baseline_status === "FAILURE" || outcomeDiff.baseline_status === "FAILED" || outcomeDiff.baseline_status === "BLOCKED") &&
    (outcomeDiff.candidate_status === "SUCCESS" || outcomeDiff.candidate_status === "PASSED");

  const testsPassedDelta = metricsDiff.deltas["tests_passed"]?.absolute_delta ?? 0;
  const testsImproved =
    testsPassedDelta > 0 ||
    evidenceDiff.test_diffs.some((t) => (t.before_status === "FAILED" || t.before_status === "FAILURE") && t.after_status === "PASSED");

  const securityImproved = secViolationsDelta < 0;

  const reviewsPassedDelta = metricsDiff.deltas["reviews_passed"]?.absolute_delta ?? 0;
  const reviewsImproved = reviewsPassedDelta > 0;

  const costDelta = metricsDiff.cost_delta_usd;
  const latencyDelta = metricsDiff.latency_delta_ms;
  const costImproved = costDelta < -0.001;
  const latencyImproved = latencyDelta < -100;

  const hasAnyImprovement =
    outcomeImproved || testsImproved || securityImproved || reviewsImproved || (costImproved && latencyImproved);

  // Verdict logic
  if (hasAnyRegression && hasAnyImprovement) {
    return "MIXED";
  }

  if (hasAnyRegression) {
    return "REGRESSED";
  }

  if (hasAnyImprovement) {
    return "IMPROVED";
  }

  // If cost and latency are identical or within tiny jitter, and no test/outcome change
  const costNeutral = Math.abs(costDelta) <= 0.001;
  const latencyNeutral = Math.abs(latencyDelta) <= 100;
  const noEvidenceDelta =
    evidenceDiff.test_diffs.length === 0 &&
    evidenceDiff.review_diffs.length === 0 &&
    evidenceDiff.security_diffs.length === 0;

  if (costNeutral && latencyNeutral && noEvidenceDelta && !outcomeDiff.status_changed) {
    return "NEUTRAL";
  }

  // Minor cost or latency improvement without task outcome change
  if (costImproved || latencyImproved) {
    return "IMPROVED";
  }

  // Minor cost or latency degradation
  if (costDelta > 0.001 || latencyDelta > 200) {
    return "REGRESSED";
  }

  return "INCONCLUSIVE";
}
