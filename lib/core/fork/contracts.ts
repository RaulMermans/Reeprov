/**
 * Canonical Contracts & Schemas for Execution Fork Runtime.
 *
 * Defines versioned contracts for ForkPlan, ForkResult, ForkEvent,
 * DependencyPolicy, and Mutation Application Records.
 */

import { z } from "zod";
import { checkpointReferenceSchema, experimentMutationSchema, type ExperimentMutation, type CheckpointReference } from "../contracts/lineage";
import { type RunArtifact } from "../contracts/runArtifact";

export const CANONICAL_FORK_SCHEMA_VERSION = "1.0.0-alpha";

// ── Execution Modes & Verdicts ──────────────────────────────────────────────

export const forkExecutionModeSchema = z.enum([
  "SAFE_OFFLINE_FORK",       // 0 network, recorded/mocked dependencies, unsafe side effects blocked
  "BEST_EFFORT_FORK",        // Sandboxed execution with best-effort substitution
  "VALIDATION_ONLY",          // Pre-flight check and ForkPlan generation without execution
]);

export type ForkExecutionMode = z.infer<typeof forkExecutionModeSchema>;

export const forkStatusSchema = z.enum([
  "COMPLETED",
  "DIVERGED",
  "BLOCKED",
  "UNSUPPORTED",
  "FAILED",
]);

export type ForkStatus = z.infer<typeof forkStatusSchema>;

export const forkableVerdictSchema = z.enum([
  "FORKABLE",
  "PARTIALLY_FORKABLE",
  "NOT_FORKABLE",
]);

export type ForkableVerdict = z.infer<typeof forkableVerdictSchema>;

// ── Dependency Policy ───────────────────────────────────────────────────────

export const forkDependencyModeSchema = z.enum([
  "RECORDED",
  "OVERRIDE",
  "SANDBOXED_CANDIDATE",
  "DENY",
]);

export type ForkDependencyMode = z.infer<typeof forkDependencyModeSchema>;

export const forkDependencyPolicySchema = z.object({
  model: forkDependencyModeSchema.default("SANDBOXED_CANDIDATE"),
  retrieval: forkDependencyModeSchema.default("RECORDED"),
  read_only_tool: forkDependencyModeSchema.default("RECORDED"),
  external_side_effect: forkDependencyModeSchema.default("DENY"),
  destructive: forkDependencyModeSchema.default("DENY"),
});

export type ForkDependencyPolicy = z.infer<typeof forkDependencyPolicySchema>;

export const forkSideEffectPolicySchema = z.object({
  allow_live_side_effects: z.boolean().default(false),
  destructive_allowed: z.boolean().default(false),
  simulate_external_calls: z.boolean().default(true),
});

export type ForkSideEffectPolicy = z.infer<typeof forkSideEffectPolicySchema>;

// ── Applied Mutation Record ─────────────────────────────────────────────────

export const appliedMutationRecordSchema = z.object({
  mutation_id: z.string(),
  mutation_type: z.string(),
  target_identifier: z.string(),
  description: z.string(),
  original_value: z.unknown().optional(),
  original_hash: z.string().optional(),
  mutated_value: z.unknown(),
  mutated_hash: z.string(),
  status: z.enum(["APPLIED", "REJECTED", "SKIPPED"]),
  error: z.string().optional(),
});

export type AppliedMutationRecord = z.infer<typeof appliedMutationRecordSchema>;

// ── Fork Plan ───────────────────────────────────────────────────────────────

export const forkPlanSchema = z.object({
  fork_id: z.string(),
  parent_run_id: z.string(),
  root_run_id: z.string(),
  checkpoint_id: z.string(),
  fork_step_id: z.string(),
  resume_step_index: z.number().int().nonnegative(),
  boundary_cursor: z.number().int().nonnegative(),
  mutations: z.array(experimentMutationSchema).default([]),
  dependency_policy: forkDependencyPolicySchema,
  side_effect_policy: forkSideEffectPolicySchema,
  execution_mode: forkExecutionModeSchema.default("SAFE_OFFLINE_FORK"),
  host_requirements: z.record(z.string(), z.unknown()).default({}),
  validation: z.object({
    verdict: forkableVerdictSchema,
    reasons: z.array(z.string()).default([]),
  }),
  created_at: z.string(),
});

export type ForkPlan = z.infer<typeof forkPlanSchema>;

// ── Fork Events ─────────────────────────────────────────────────────────────

export const forkEventTypeSchema = z.enum([
  "fork.start",
  "fork.plan.created",
  "fork.checkpoint.validated",
  "fork.state.restored",
  "fork.mutation.applied",
  "fork.step.start",
  "fork.boundary.recorded",
  "fork.side_effect.blocked",
  "fork.complete",
  "fork.fail",
]);

export type ForkEventType = z.infer<typeof forkEventTypeSchema>;

export const forkEventSchema = z.object({
  event_id: z.string(),
  fork_id: z.string(),
  derived_run_id: z.string(),
  parent_run_id: z.string(),
  event_type: forkEventTypeSchema,
  timestamp: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type ForkEvent = z.infer<typeof forkEventSchema>;

// ── Fork Result ─────────────────────────────────────────────────────────────

export const forkResultSchema = z.object({
  fork_id: z.string(),
  derived_run_id: z.string(),
  parent_run_id: z.string(),
  root_run_id: z.string(),
  checkpoint_id: z.string(),
  status: forkStatusSchema,
  restored_state_hash: z.string(),
  mutations_applied: z.array(appliedMutationRecordSchema).default([]),
  steps_executed: z.number().int().nonnegative(),
  boundaries_recorded: z.number().int().nonnegative(),
  blocked_actions: z.number().int().nonnegative().default(0),
  final_output: z.unknown().optional(),
  errors: z.array(z.string()).default([]),
  created_at: z.string(),
  completed_at: z.string(),
});

export interface ForkResult extends z.infer<typeof forkResultSchema> {
  child_artifact?: RunArtifact;
  fork_events?: ForkEvent[];
}
