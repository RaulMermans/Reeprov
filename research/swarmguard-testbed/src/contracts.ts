/**
 * Research-only contracts for the SwarmGuard multi-agent testbed.
 *
 * Isolated from Reeprov's public SDK. These types describe experimental
 * agents, scenarios, budgets, and evaluator-only ground truth. Detector-visible
 * evidence continues to use canonical Reeprov contracts.
 */

import { z } from "zod";

export const EXECUTION_MODES = ["live_llm", "offline_fixture", "mocked"] as const;
export const executionModeSchema = z.enum(EXECUTION_MODES);
export type ExecutionMode = z.infer<typeof executionModeSchema>;

export const agentRoleSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  description: z.string().min(1),
  allowed_tools: z.array(z.string()).default([]),
  max_steps: z.number().int().positive().default(4),
  timeout_ms: z.number().int().positive().default(45_000),
});
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const agentAssertionSchema = z.object({
  claim: z.string().min(1),
  evidence_refs: z.array(z.string()).default([]),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});
export type AgentAssertion = z.infer<typeof agentAssertionSchema>;

export const toolRequestSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
});
export type ToolRequest = z.infer<typeof toolRequestSchema>;

export const agentTurnSchema = z.object({
  summary: z.string().min(1),
  assertions: z.array(agentAssertionSchema).default([]),
  tool_requests: z.array(toolRequestSchema).default([]),
  output: z.record(z.string(), z.unknown()).default({}),
  ready_for_handoff: z.boolean().default(true),
});
export type AgentTurn = z.infer<typeof agentTurnSchema>;

export const executionStatusSchema = z.enum([
  "completed",
  "failed",
  "degraded",
  "blocked",
  "budget_exceeded",
  "timeout",
  "partial",
]);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

export const executionErrorSchema = z.object({
  code: z.enum([
    "schema_invalid",
    "provider_error",
    "timeout",
    "budget_exceeded",
    "tool_denied",
    "tool_failed",
    "live_blocked",
    "incomplete",
    "internal",
  ]),
  message: z.string(),
  agent_id: z.string().optional(),
  retryable: z.boolean().default(false),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ExecutionError = z.infer<typeof executionErrorSchema>;

export const budgetSchema = z.object({
  max_cost_usd: z.number().nonnegative().default(0.15),
  max_tokens: z.number().int().positive().default(12_000),
  max_model_calls: z.number().int().positive().default(12),
  max_steps_per_agent: z.number().int().positive().default(4),
  agent_timeout_ms: z.number().int().positive().default(45_000),
  run_timeout_ms: z.number().int().positive().default(180_000),
  max_retries: z.number().int().nonnegative().default(2),
  max_tokens_per_call: z.number().int().positive().default(800),
});
export type ExperimentBudget = z.infer<typeof budgetSchema>;

export const injectionTypeSchema = z.enum([
  "incorrect_assertion",
  "missing_evidence",
  "stale_evidence",
  "cross_run_evidence",
  "modified_handoff",
  "skipped_validation",
]);
export type InjectionType = z.infer<typeof injectionTypeSchema>;

export const injectionBoundarySchema = z.enum([
  "agent_output",
  "handoff_payload",
  "evidence_refs",
  "validation_step",
  "artifact_ref",
]);
export type InjectionBoundary = z.infer<typeof injectionBoundarySchema>;

export const injectionPlanSchema = z.object({
  enabled: z.boolean().default(false),
  type: injectionTypeSchema.optional(),
  target_agent_id: z.string().optional(),
  target_boundary: injectionBoundarySchema.optional(),
  expected_observable_violation: z.string().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type InjectionPlan = z.infer<typeof injectionPlanSchema>;

export const DEFAULT_BUDGET: ExperimentBudget = budgetSchema.parse({});
export const NO_INJECTION: InjectionPlan = injectionPlanSchema.parse({ enabled: false });

export const scenarioSchema = z.object({
  id: z.string().min(1),
  domain_id: z.string().min(1),
  title: z.string().min(1),
  task: z.string().min(1),
  seed: z.string().min(1),
  agents: z.array(agentRoleSchema).min(2),
  workflow: z.array(z.object({ agent_id: z.string().min(1) })).min(2),
});
export type Scenario = z.infer<typeof scenarioSchema>;

export const GROUND_TRUTH_LEAK_KEYS = [
  "injection_type",
  "injectionType",
  "ground_truth",
  "groundTruth",
  "evaluator_only",
  "evaluatorOnly",
  "expected_observable_violation",
  "expected_violation",
  "intended_failure",
  "intendedFailure",
  "actual_modification",
  "scoring_metadata",
  "experimental_seed",
  "injection_config",
] as const;

export const LEAK_SUBSTRINGS = [
  "injection_type",
  "ground_truth",
  "evaluator_only",
  "expected_observable_violation",
  "intended_failure",
  "scoring_metadata",
  "experimental_seed",
] as const;
