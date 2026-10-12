/**
 * Eval Studio Contracts — Definitions, Suites, Datasets, and Evaluation Runs.
 *
 * Implements authoritative, versioned, immutable evaluation contracts.
 * Evaluator adapters evaluate agent artifacts against EvalDefinitions,
 * producing canonical EvalResults.
 */

import { z } from "zod";
import { evalFamilySchema, graderTypeSchema, evalSeveritySchema, evalResultSchema, type EvalFamily, type GraderType, type EvalSeverity, type EvalResult } from "./evals";
import { hashPayload } from "../capture/hashing";

export const CANONICAL_EVAL_DEFINITION_SCHEMA_VERSION = "1.0.0";

// ── Target Scopes ───────────────────────────────────────────────────────────

export const evalTargetScopeSchema = z.enum([
  "RUN",
  "STEP",
  "MODEL_CALL",
  "TOOL_CALL",
  "RETRIEVAL",
  "CONTEXT",
  "MEMORY",
  "ARTIFACT",
  "COMPARISON",
]);

export type EvalTargetScope = z.infer<typeof evalTargetScopeSchema>;

// ── Eval Definition ─────────────────────────────────────────────────────────

export const evalDefinitionSchema = z.object({
  eval_definition_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  family: evalFamilySchema,
  version: z.number().int().positive(),
  target_scope: evalTargetScopeSchema,
  grader_type: graderTypeSchema,
  metric: z.string().optional(),
  score_range: z.object({
    min: z.number(),
    max: z.number(),
  }).optional(),
  threshold: z.number().optional(),
  severity: evalSeveritySchema.default("fail"),
  required: z.boolean().default(true),
  grader_config: z.record(z.string(), z.unknown()).default({}),
  evidence_requirements: z.array(z.string()).default([]),
  created_at: z.string(),
  created_by: z.string().optional(),
  content_hash: z.string(),
  status: z.enum(["active", "deprecated", "draft"]).default("active"),
});

export type EvalDefinition = z.infer<typeof evalDefinitionSchema>;

/**
 * Computes deterministic content hash for an eval definition (excluding the hash itself).
 */
export function computeEvalDefinitionHash(
  def: Omit<EvalDefinition, "content_hash">
): string {
  return hashPayload({
    eval_definition_id: def.eval_definition_id,
    name: def.name,
    family: def.family,
    version: def.version,
    target_scope: def.target_scope,
    grader_type: def.grader_type,
    metric: def.metric,
    threshold: def.threshold,
    severity: def.severity,
    required: def.required,
    grader_config: def.grader_config,
    evidence_requirements: def.evidence_requirements,
  });
}

// ── Eval Suite Pass Policy ──────────────────────────────────────────────────

export const evalSuitePassPolicySchema = z.object({
  mode: z.enum(["ALL_REQUIRED_PASS", "WEIGHTED_SCORE"]).default("ALL_REQUIRED_PASS"),
  minimum_weighted_score: z.number().min(0).max(1).optional(),
  weights: z.record(z.string(), z.number()).optional(),
  critical_eval_ids: z.array(z.string()).default([]),
});

export type EvalSuitePassPolicy = z.infer<typeof evalSuitePassPolicySchema>;

// ── Eval Suite ──────────────────────────────────────────────────────────────

export const evalSuiteSchema = z.object({
  suite_id: z.string(),
  name: z.string(),
  version: z.number().int().positive(),
  description: z.string().optional(),
  definitions: z.array(evalDefinitionSchema).default([]),
  required_eval_ids: z.array(z.string()).default([]),
  optional_eval_ids: z.array(z.string()).default([]),
  pass_policy: evalSuitePassPolicySchema,
  created_at: z.string(),
  content_hash: z.string(),
});

export type EvalSuite = z.infer<typeof evalSuiteSchema>;

export function computeEvalSuiteHash(
  suite: Omit<EvalSuite, "content_hash">
): string {
  return hashPayload({
    suite_id: suite.suite_id,
    name: suite.name,
    version: suite.version,
    definition_hashes: suite.definitions.map((d) => d.content_hash),
    required_eval_ids: suite.required_eval_ids,
    optional_eval_ids: suite.optional_eval_ids,
    pass_policy: suite.pass_policy,
  });
}

// ── Eval Case ───────────────────────────────────────────────────────────────

export const evalCaseSchema = z.object({
  case_id: z.string(),
  name: z.string(),
  input: z.unknown(),
  input_ref: z.string().optional(),
  expected: z.unknown().optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
  source_run_id: z.string().optional(),
  source_checkpoint_id: z.string().optional(),
  artifact_refs: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type EvalCase = z.infer<typeof evalCaseSchema>;

// ── Eval Dataset ────────────────────────────────────────────────────────────

export const evalDatasetSchema = z.object({
  dataset_id: z.string(),
  name: z.string(),
  version: z.number().int().positive(),
  description: z.string().optional(),
  cases: z.array(evalCaseSchema).default([]),
  created_at: z.string(),
  source: z.string().optional(),
  content_hash: z.string(),
});

export type EvalDataset = z.infer<typeof evalDatasetSchema>;

export function computeEvalDatasetHash(
  dataset: Omit<EvalDataset, "content_hash">
): string {
  return hashPayload({
    dataset_id: dataset.dataset_id,
    name: dataset.name,
    version: dataset.version,
    cases: dataset.cases,
  });
}

// ── Evaluation Run ──────────────────────────────────────────────────────────

export const evaluationRunStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
  "BUDGET_EXCEEDED",
]);

export type EvaluationRunStatus = z.infer<typeof evaluationRunStatusSchema>;

export const evaluationSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  missing_evidence: z.number().int().nonnegative(),
  pass_rate: z.number().min(0).max(1),
  weighted_score: z.number().optional(),
  suite_verdict: z.enum(["PASSED", "FAILED"]),
  verdict_reason: z.string(),
  critical_failures: z.array(z.string()).default([]),
});

export type EvaluationSummary = z.infer<typeof evaluationSummarySchema>;

export const evaluationRunSchema = z.object({
  evaluation_run_id: z.string(),
  suite_id: z.string(),
  suite_version: z.number().int().positive(),
  dataset_id: z.string().optional(),
  dataset_version: z.number().int().positive().optional(),
  target_run_ids: z.array(z.string()),
  status: evaluationRunStatusSchema,
  started_at: z.string(),
  completed_at: z.string().optional(),
  results: z.array(evalResultSchema).default([]),
  summary: evaluationSummarySchema,
  cost_usd: z.number().nonnegative().default(0),
  duration_ms: z.number().nonnegative().default(0),
  errors: z.array(z.string()).default([]),
});

export type EvaluationRun = z.infer<typeof evaluationRunSchema>;
