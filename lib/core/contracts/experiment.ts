/**
 * Experiment Lab Contracts — Definitions, Arms, Trials, and Experiment Results.
 *
 * Implements bounded, controlled agent experiment orchestration without becoming
 * an uncontrolled general agent orchestrator.
 *
 * Guarantees:
 * - Hard gates before optimization.
 * - Separate candidate and grader cost accounting.
 * - Explicit repeatability metrics (n, pass_rate, std_dev).
 * - Single-trial repeatability warnings.
 * - No automatic production promotion.
 */

import { z } from "zod";
import { experimentMutationSchema, type ExperimentMutation } from "./lineage";
import { hashPayload } from "../capture/hashing";

export const CANONICAL_EXPERIMENT_SCHEMA_VERSION = "1.0.0";

// ── Experiment Statuses ──────────────────────────────────────────────────────

export const experimentStatusSchema = z.enum([
  "DRAFT",
  "READY",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "BUDGET_EXCEEDED",
  "CANCELLED",
]);

export type ExperimentStatus = z.infer<typeof experimentStatusSchema>;

// ── Supported Variables ─────────────────────────────────────────────────────

export const supportedVariableTypeSchema = z.enum([
  "prompt",
  "model",
  "model_parameters",
  "state_patch",
  "tool_result_override",
  "context_exclusion",
  "memory_exclusion",
]);

export type SupportedVariableType = z.infer<typeof supportedVariableTypeSchema>;

export const experimentVariableSchema = z.object({
  variable_id: z.string(),
  type: z.string(),
  target_identifier: z.string(),
  name: z.string(),
  values: z.array(z.unknown()),
  supported: z.boolean().default(true),
  unsupported_reason: z.string().optional(),
});

export type ExperimentVariable = z.infer<typeof experimentVariableSchema>;

// ── Experiment Arm ──────────────────────────────────────────────────────────

export const experimentArmSchema = z.object({
  arm_id: z.string(),
  name: z.string(),
  mutations: z.array(experimentMutationSchema).default([]),
  is_baseline: z.boolean().default(false),
  configuration_hash: z.string(),
  expected_change_summary: z.string(),
});

export type ExperimentArm = z.infer<typeof experimentArmSchema>;

// ── Budget Governor ─────────────────────────────────────────────────────────

export const experimentBudgetSchema = z.object({
  max_cost_usd: z.number().positive().default(5.0),
  max_trials: z.number().int().positive().default(20),
  max_model_calls: z.number().int().positive().default(100),
  max_duration_ms: z.number().positive().default(300_000), // 5 min
  max_concurrency: z.number().int().positive().default(2),
  allow_live_model_calls: z.boolean().default(false),
  timeout_ms: z.number().positive().default(30_000),
});

export type ExperimentBudget = z.infer<typeof experimentBudgetSchema>;

// ── Winner Policy ───────────────────────────────────────────────────────────

export const winnerOptimizationCriterionSchema = z.enum([
  "QUALITY_FIRST",
  "COST_FIRST",
  "LATENCY_FIRST",
  "BALANCED",
]);

export type WinnerOptimizationCriterion = z.infer<typeof winnerOptimizationCriterionSchema>;

export const winnerPolicySchema = z.object({
  required_eval_ids: z.array(z.string()).default([]),
  critical_eval_ids: z.array(z.string()).default([]),
  required_non_regression_eval_ids: z.array(z.string()).default([]),
  optimization_criterion: winnerOptimizationCriterionSchema.default("QUALITY_FIRST"),
  min_pass_rate: z.number().min(0).max(1).default(0.8),
  weights: z.object({
    quality: z.number().default(0.6),
    cost: z.number().default(0.2),
    latency: z.number().default(0.2),
  }).default({
    quality: 0.6,
    cost: 0.2,
    latency: 0.2,
  }),
});

export type WinnerPolicy = z.infer<typeof winnerPolicySchema>;

// ── Experiment Definition ───────────────────────────────────────────────────

export const experimentDefinitionSchema = z.object({
  experiment_id: z.string(),
  name: z.string(),
  hypothesis: z.string().optional(),
  baseline_run_id: z.string(),
  checkpoint_id: z.string().optional(),
  dataset_id: z.string().optional(),
  eval_suite_id: z.string(),
  eval_suite_version: z.number().int().positive().optional(),
  variables: z.array(experimentVariableSchema).default([]),
  arms: z.array(experimentArmSchema).default([]),
  repetitions: z.number().int().positive().default(1),
  budget: experimentBudgetSchema.default({
    max_cost_usd: 5.0,
    max_trials: 20,
    max_model_calls: 100,
    max_duration_ms: 300_000,
    max_concurrency: 2,
    allow_live_model_calls: false,
    timeout_ms: 30_000,
  }),
  winner_policy: winnerPolicySchema.default({
    required_eval_ids: [],
    critical_eval_ids: [],
    required_non_regression_eval_ids: [],
    optimization_criterion: "QUALITY_FIRST",
    min_pass_rate: 0.8,
    weights: { quality: 0.6, cost: 0.2, latency: 0.2 },
  }),
  created_at: z.string(),
  status: experimentStatusSchema.default("READY"),
});

export type ExperimentDefinition = z.infer<typeof experimentDefinitionSchema>;

// ── Experiment Trial ────────────────────────────────────────────────────────

export const experimentTrialStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export type ExperimentTrialStatus = z.infer<typeof experimentTrialStatusSchema>;

export const experimentTrialSchema = z.object({
  trial_id: z.string(),
  experiment_id: z.string(),
  arm_id: z.string(),
  repetition_index: z.number().int().nonnegative(),
  derived_run_id: z.string(),
  status: experimentTrialStatusSchema,
  eval_run_id: z.string().optional(),
  comparison_id: z.string().optional(),
  candidate_cost_usd: z.number().nonnegative().default(0),
  grader_cost_usd: z.number().nonnegative().default(0),
  duration_ms: z.number().nonnegative().default(0),
  started_at: z.string(),
  completed_at: z.string().optional(),
  errors: z.array(z.string()).default([]),
});

export type ExperimentTrial = z.infer<typeof experimentTrialSchema>;

// ── Arm Aggregates ──────────────────────────────────────────────────────────

export const armAggregateSchema = z.object({
  arm_id: z.string(),
  arm_name: z.string(),
  is_baseline: z.boolean(),
  n: z.number().int().positive(),
  pass_rate: z.number().min(0).max(1),
  mean_score: z.number(),
  median_score: z.number(),
  min_score: z.number(),
  max_score: z.number(),
  std_dev_score: z.number().optional(),
  mean_candidate_cost: z.number(),
  mean_grader_cost: z.number(),
  mean_total_cost: z.number(),
  mean_latency_ms: z.number(),
  safety_pass: z.boolean(),
  approval_pass: z.boolean(),
  required_gates_pass: z.boolean(),
  critical_violations: z.number().int().nonnegative(),
  repeatability_note: z.string().optional(),
});

export type ArmAggregate = z.infer<typeof armAggregateSchema>;

// ── Candidate Ranking ───────────────────────────────────────────────────────

export const candidateRankingEntrySchema = z.object({
  rank: z.number().int().positive(),
  arm_id: z.string(),
  arm_name: z.string(),
  score: z.number(),
  eligible_for_recommendation: z.boolean(),
  gate_failure_reasons: z.array(z.string()).default([]),
  summary: z.string(),
});

export type CandidateRankingEntry = z.infer<typeof candidateRankingEntrySchema>;

// ── Experiment Result ───────────────────────────────────────────────────────

export const experimentResultSchema = z.object({
  experiment_id: z.string(),
  status: z.enum(["COMPLETED", "BUDGET_EXCEEDED", "FAILED", "CANCELLED"]),
  baseline_arm_id: z.string(),
  arms: z.array(experimentArmSchema),
  trial_summaries: z.array(experimentTrialSchema),
  aggregates: z.array(armAggregateSchema),
  eval_summary: z.record(z.string(), z.unknown()).default({}),
  comparison_refs: z.array(z.string()).default([]),
  budget_consumed: z.object({
    cost_usd: z.number(),
    candidate_cost_usd: z.number(),
    grader_cost_usd: z.number(),
    trials_executed: z.number(),
    duration_ms: z.number(),
  }),
  candidate_ranking: z.array(candidateRankingEntrySchema),
  recommended_candidate: z.string().optional(),
  recommendation_basis: z.string(),
  limitations: z.array(z.string()).default([]),
  created_at: z.string(),
  completed_at: z.string(),
});

export type ExperimentResult = z.infer<typeof experimentResultSchema>;
