/**
 * Regression Engine Contracts — Baselines, Comparability, Findings, Policies, and Gates.
 *
 * Implements deterministic detection of regressions across agent versions under
 * explicit baselines and comparable evaluation conditions.
 *
 * Guarantees:
 * - Explicit baselines only (never "latest successful run" implicitly).
 * - Immutability of approved baselines.
 * - Comparability assessment before regression detection (no apples-to-oranges).
 * - Paired dataset case matrix with clear taxonomy (NEW_REGRESSION vs EXISTING_FAILURE vs RECOVERED).
 * - Hard zero-tolerance safety and approval compliance gates.
 * - Minimum trials required for stochastic claims (no fake "statistical significance").
 * - Automatic check != automatic promotion (evidence supports gates, does not deploy).
 */

import { z } from "zod";
import { hashPayload } from "../capture/hashing";

export const CANONICAL_REGRESSION_SCHEMA_VERSION = "1.0.0";

// ── 1. Regression Baseline ───────────────────────────────────────────────────

export const regressionBaselineStatusSchema = z.enum(["ACTIVE", "SUPERSEDED", "REVOKED"]);
export type RegressionBaselineStatus = z.infer<typeof regressionBaselineStatusSchema>;

export const regressionBaselineSchema = z.object({
  baseline_id: z.string(),
  project_id: z.string(),
  agent_id: z.string().optional(),
  run_id: z.string().optional(),
  configuration_hash: z.string(),
  eval_suite_id: z.string(),
  eval_suite_version: z.number().int().positive(),
  dataset_id: z.string().optional(),
  dataset_version: z.number().int().positive().optional(),
  approved_at: z.string(),
  approved_by: z.string().optional(),
  label: z.string().optional(),
  release_version: z.string().optional(),
  evidence_hash: z.string(),
  status: regressionBaselineStatusSchema.default("ACTIVE"),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type RegressionBaseline = z.infer<typeof regressionBaselineSchema>;

export function computeBaselineEvidenceHash(payload: Omit<RegressionBaseline, "evidence_hash" | "status">): string {
  return hashPayload({
    baseline_id: payload.baseline_id,
    project_id: payload.project_id,
    agent_id: payload.agent_id,
    run_id: payload.run_id,
    configuration_hash: payload.configuration_hash,
    eval_suite_id: payload.eval_suite_id,
    eval_suite_version: payload.eval_suite_version,
    dataset_id: payload.dataset_id,
    dataset_version: payload.dataset_version,
    approved_at: payload.approved_at,
    release_version: payload.release_version,
  });
}

// ── 2. Comparability Assessment ─────────────────────────────────────────────

export const comparabilityVerdictSchema = z.enum([
  "COMPARABLE",
  "COMPARABLE_WITH_WARNINGS",
  "NOT_COMPARABLE",
]);
export type ComparabilityVerdict = z.infer<typeof comparabilityVerdictSchema>;

export const comparabilityAssessmentSchema = z.object({
  verdict: comparabilityVerdictSchema,
  dimensions: z.object({
    eval_suite: z.object({ match: z.boolean(), details: z.string() }),
    eval_definition_versions: z.object({ match: z.boolean(), details: z.string() }),
    dataset: z.object({ match: z.boolean(), details: z.string() }),
    case_coverage: z.object({
      coverage_ratio: z.number().min(0).max(1),
      missing_cases: z.array(z.string()).default([]),
      details: z.string(),
    }),
    grader_versions: z.object({ match: z.boolean(), details: z.string() }),
    target_scope: z.object({ match: z.boolean(), details: z.string() }),
    required_evidence: z.object({ match: z.boolean(), details: z.string() }),
    runtime_mode: z.object({ match: z.boolean(), details: z.string() }),
    candidate_execution_policy: z.object({ match: z.boolean(), details: z.string() }),
  }),
  warnings: z.array(z.string()).default([]),
  reasons: z.array(z.string()).default([]),
  suggested_bridge_eval: z.string().optional(),
  suggested_re_evaluation: z
    .object({
      suite_id: z.string(),
      suite_version: z.number().int(),
      dataset_id: z.string().optional(),
      dataset_version: z.number().int().optional(),
    })
    .optional(),
});

export type ComparabilityAssessment = z.infer<typeof comparabilityAssessmentSchema>;

// ── 3. Regression Taxonomy & Findings ───────────────────────────────────────

export const regressionCategorySchema = z.enum([
  "CASE_REGRESSION",
  "TASK_SUCCESS_REGRESSION",
  "QUALITY_REGRESSION",
  "SAFETY_REGRESSION",
  "APPROVAL_REGRESSION",
  "POLICY_REGRESSION",
  "TOOL_BEHAVIOR_REGRESSION",
  "RETRIEVAL_REGRESSION",
  "CONTEXT_REGRESSION",
  "MEMORY_REGRESSION",
  "COST_REGRESSION",
  "LATENCY_REGRESSION",
  "RELIABILITY_REGRESSION",
  "FLAKINESS_INCREASE",
  "EVIDENCE_REGRESSION",
]);
export type RegressionCategory = z.infer<typeof regressionCategorySchema>;

export const regressionSeveritySchema = z.enum(["INFO", "WARNING", "FAIL", "CRITICAL"]);
export type RegressionSeverity = z.infer<typeof regressionSeveritySchema>;

export const regressionFindingSchema = z.object({
  finding_id: z.string(),
  category: regressionCategorySchema,
  severity: regressionSeveritySchema,
  baseline_evidence: z.object({
    run_id: z.string().optional(),
    case_id: z.string().optional(),
    eval_id: z.string().optional(),
    value: z.unknown(),
    summary: z.string(),
  }),
  candidate_evidence: z.object({
    run_id: z.string().optional(),
    case_id: z.string().optional(),
    eval_id: z.string().optional(),
    value: z.unknown(),
    summary: z.string(),
  }),
  delta: z.union([z.number(), z.string()]),
  threshold: z.union([z.number(), z.string()]),
  description: z.string().optional(),
  eval_references: z.array(z.string()).default([]),
  case_references: z.array(z.string()).default([]),
  configuration_differences: z.array(z.string()).default([]),
  first_meaningful_divergence: z.string().optional(),
  causal_status: z.enum([
    "ASSOCIATED_CHANGE",
    "CAUSALLY_SUPPORTED_WITHIN_EXPERIMENT",
    "UNATTRIBUTED",
  ]).default("ASSOCIATED_CHANGE"),
  recommendation: z.string().optional(),
  status: z.enum(["ACTIVE", "ACKNOWLEDGED", "RESOLVED"]).default("ACTIVE"),
});

export type RegressionFinding = z.infer<typeof regressionFindingSchema>;

// ── 4. Case Matrix Results ──────────────────────────────────────────────────

export const regressionCaseComparisonStatusSchema = z.enum([
  "NEW_REGRESSION",
  "EXISTING_FAILURE",
  "RECOVERED",
  "UNCHANGED_PASS",
  "UNCHANGED_FAIL",
]);
export type RegressionCaseComparisonStatus = z.infer<typeof regressionCaseComparisonStatusSchema>;

export const regressionCaseResultSchema = z.object({
  case_id: z.string(),
  case_name: z.string(),
  baseline_status: z.enum(["PASS", "FAIL", "MISSING", "ERROR"]),
  candidate_status: z.enum(["PASS", "FAIL", "MISSING", "ERROR"]),
  classification: regressionCaseComparisonStatusSchema,
  status_transition: regressionCaseComparisonStatusSchema.optional(),
  baseline_score: z.number().optional(),
  candidate_score: z.number().optional(),
  score_delta: z.number().optional(),
  divergence_step_index: z.number().int().optional(),
  evidence_refs: z.array(z.string()).default([]),
});

export type RegressionCaseResult = z.infer<typeof regressionCaseResultSchema>;

// ── 5. Regression Gate Policy ───────────────────────────────────────────────

export const regressionGatePolicySchema = z.object({
  policy_id: z.string(),
  version: z.number().int().positive().default(1),
  name: z.string(),
  critical: z.array(z.string()).default(["safety", "approval_compliance"]),
  required_non_regression: z.array(z.string()).default(["task_success"]),
  thresholds: z.object({
    task_success: z.object({
      max_drop: z.number().default(0.02),
      max_relative_drop: z.number().optional(),
    }).default({ max_drop: 0.02 }),
    cost: z.object({
      max_relative_increase: z.number().default(0.15),
      max_absolute_increase: z.number().optional(),
    }).default({ max_relative_increase: 0.15 }),
    latency: z.object({
      max_p95_increase: z.number().default(0.20),
      max_relative_increase: z.number().default(0.20),
    }).default({ max_p95_increase: 0.20, max_relative_increase: 0.20 }),
    quality: z.object({
      max_absolute_drop: z.number().default(0.03),
      max_relative_drop: z.number().optional(),
    }).default({ max_absolute_drop: 0.03 }),
  }).default({
    task_success: { max_drop: 0.02 },
    cost: { max_relative_increase: 0.15 },
    latency: { max_p95_increase: 0.20, max_relative_increase: 0.20 },
    quality: { max_absolute_drop: 0.03 },
  }),
  minimum_case_coverage: z.number().min(0).max(1).default(1.0),
  minimum_trials: z.number().int().positive().default(1),
  missing_evidence: z.enum(["FAIL_CLOSED", "WARN", "ALLOW"]).default("FAIL_CLOSED"),
  statistical_language_mode: z.enum(["DETERMINISTIC", "DESCRIPTIVE"]).default("DETERMINISTIC"),
});

export type RegressionGatePolicy = z.infer<typeof regressionGatePolicySchema>;

// ── 6. Regression Gate Result ───────────────────────────────────────────────

export const regressionGateStatusSchema = z.enum([
  "PASS",
  "WARN",
  "FAIL",
  "INCONCLUSIVE",
  "NOT_COMPARABLE",
]);
export type RegressionGateStatus = z.infer<typeof regressionGateStatusSchema>;

export const regressionGateResultSchema = z.object({
  gate_id: z.string(),
  policy_id: z.string(),
  policy_version: z.number().int().positive(),
  baseline_id: z.string(),
  candidate_run_id: z.string(),
  candidate_config_hash: z.string(),
  status: regressionGateStatusSchema,
  findings: z.array(regressionFindingSchema).default([]),
  critical_failures: z.array(z.string()).default([]),
  failure_reasons: z.array(z.string()).default([]),
  critical_failure_count: z.number().int().default(0),
  new_regression_count: z.number().int().default(0),
  existing_failure_count: z.number().int().default(0),
  recovered_count: z.number().int().default(0),
  warnings: z.array(z.string()).default([]),
  comparability: comparabilityAssessmentSchema,
  case_matrix: z.array(regressionCaseResultSchema).default([]),
  summary: z.string(),
  evidence_refs: z.array(z.string()).default([]),
  created_at: z.string(),
});

export type RegressionGateResult = z.infer<typeof regressionGateResultSchema>;

// ── 7. Regression Report ────────────────────────────────────────────────────

export const regressionReportSchema = z.object({
  report_id: z.string(),
  project_id: z.string(),
  baseline: regressionBaselineSchema,
  candidate_run_id: z.string(),
  candidate_config_hash: z.string(),
  policy: regressionGatePolicySchema,
  gate_result: regressionGateResultSchema,
  comparability: comparabilityAssessmentSchema,
  findings: z.array(regressionFindingSchema),
  case_matrix: z.array(regressionCaseResultSchema),
  statistical_evidence: z.object({
    n_baseline: z.number().int().nonnegative(),
    n_candidate: z.number().int().nonnegative(),
    baseline_pass_rate: z.number().min(0).max(1),
    candidate_pass_rate: z.number().min(0).max(1),
    baseline_mean_score: z.number(),
    candidate_mean_score: z.number(),
    baseline_std_dev: z.number().optional(),
    candidate_std_dev: z.number().optional(),
    observed_movement: z.string(),
  }),
  limitations: z.array(z.string()).default([]),
  regression_detected: z.boolean().default(false),
  summary: z.string().optional(),
  created_at: z.string(),
});

export type RegressionReport = z.infer<typeof regressionReportSchema>;

// ── 8. CI Compact Artifact ──────────────────────────────────────────────────

export const regressionGateArtifactSchema = z.object({
  schema_version: z.string().default(CANONICAL_REGRESSION_SCHEMA_VERSION),
  status: regressionGateStatusSchema,
  exit_code: z.number().int(), // 0 = PASS, 1 = FAIL, 2 = INCONCLUSIVE / NOT_COMPARABLE
  gate_id: z.string(),
  policy_id: z.string(),
  baseline_id: z.string(),
  candidate_run_id: z.string(),
  critical_regressions: z.number().int().nonnegative(),
  case_regressions: z.number().int().nonnegative(),
  metric_deltas: z.record(z.string(), z.unknown()),
  summary: z.string(),
  timestamp: z.string(),
});

export type RegressionGateArtifact = z.infer<typeof regressionGateArtifactSchema>;
