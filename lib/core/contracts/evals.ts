/**
 * Canonical Run-Linked Evaluation Contracts.
 *
 * Evals form the objective proof of agent execution quality and regression protection.
 * Every EvalResult is causally linked to a target run and optionally a target execution step.
 */

import { z } from "zod";

// ── Eval Families ───────────────────────────────────────────────────────────

export const evalFamilySchema = z.enum([
  "task_success",           // Did the agent achieve the user's primary goal?
  "output_validity",        // Syntactic and semantic correctness of final output
  "schema_validity",        // Adherence to strict JSON/Pydantic/Zod schemas
  "tool_selection",         // Did the agent invoke the right tool for the job?
  "argument_validity",      // Were tool arguments well-formed, minimal, and valid?
  "retrieval",              // Precision, recall, and relevance of retrieved documents
  "context",                // Context utilization, noise resistance, token efficiency
  "memory",                 // Correctness of memory extraction, recall, and consolidation
  "trajectory",             // Did the agent take an optimal or valid path across nodes?
  "safety",                 // Guardrails against jailbreaks, PII leakage, harmful instructions
  "approval_compliance",    // Did the agent observe human-in-the-loop permission gates?
  "regression",             // Repetition of historical failure test cases
  "cost",                   // Budget boundaries and financial efficiency
  "latency",                // Duration and SLA compliance
  "model_benchmark",        // Comparative model quality against standardized benchmarks
]);

export type EvalFamily = z.infer<typeof evalFamilySchema>;

// ── Grader Types ────────────────────────────────────────────────────────────

export const graderTypeSchema = z.enum([
  "deterministic",  // Code-based rule, regex, schema validator, or unit assertion
  "model_based",    // LLM-as-a-judge with structured grading rubric
  "human",          // Manual human reviewer rating or approval
]);

export type GraderType = z.infer<typeof graderTypeSchema>;

// ── Eval Severity ───────────────────────────────────────────────────────────

export const evalSeveritySchema = z.enum([
  "info",
  "warning",
  "fail",
  "critical",
]);

export type EvalSeverity = z.infer<typeof evalSeveritySchema>;

// ── Canonical Eval Result ───────────────────────────────────────────────────

export const graderStatusSchema = z.enum([
  "PASSED",
  "FAILED",
  "EVALUATOR_ERROR",
  "MISSING_EVIDENCE",
]);

export type GraderStatus = z.infer<typeof graderStatusSchema>;

export const graderModelProvenanceSchema = z.object({
  provider: z.string(),
  model: z.string(),
  revision: z.string().optional(),
  prompt_hash: z.string().optional(),
  config_hash: z.string().optional(),
  temperature: z.number().optional(),
});

export type GraderModelProvenance = z.infer<typeof graderModelProvenanceSchema>;

export const evalResultSchema = z.object({
  eval_id: z.string(),
  eval_type: evalFamilySchema,
  evaluator_id: z.string(),
  evaluator_version: z.string().optional(),
  target_run_id: z.string(),
  target_step_id: z.string().optional(),
  target_node_id: z.string().optional(),
  name: z.string(),
  score: z.number().optional(),                       // Numeric score (0.0 - 1.0 or custom scale)
  passed: z.boolean(),
  threshold: z.number().optional(),                  // Required threshold to pass
  metric: z.string().optional(),                      // Name of metric (e.g. "f1_score", "grounding_ratio")
  severity: evalSeveritySchema.default("fail"),
  evidence_references: z.array(z.string()).default([]), // Links to event_id, step_id, context_item_id, artifact_id
  grader_type: graderTypeSchema.default("deterministic"),
  dataset_id: z.string().optional(),
  dataset_version: z.string().optional(),
  findings: z.array(z.string()).default([]),
  recommendation: z.string().optional(),
  timestamp: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),

  // Sprint 8: Eval definition, suite, case, and experiment linkages
  eval_definition_id: z.string().optional(),
  eval_definition_version: z.union([z.number(), z.string()]).optional(),
  eval_suite_id: z.string().optional(),
  eval_suite_version: z.union([z.number(), z.string()]).optional(),
  eval_case_id: z.string().optional(),
  evaluation_run_id: z.string().optional(),
  experiment_id: z.string().optional(),
  experiment_arm_id: z.string().optional(),
  experiment_trial_id: z.string().optional(),
  grader_config_hash: z.string().optional(),
  rubric_version: z.string().optional(),
  source_artifact_hash: z.string().optional(),
  execution_duration_ms: z.number().optional(),
  grader_status: graderStatusSchema.optional(),
  grader_cost_usd: z.number().optional(),
  grader_tokens: z.object({
    prompt: z.number(),
    completion: z.number(),
    total: z.number(),
  }).optional(),
  grader_model_provenance: graderModelProvenanceSchema.optional(),
});

export type EvalResult = z.infer<typeof evalResultSchema>;
