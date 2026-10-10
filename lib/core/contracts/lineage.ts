/**
 * Canonical Experiment, Lineage, and Fork Contracts.
 *
 * Captures how runs relate to baselines, parent runs, checkpoints, and controlled experiments.
 * A mutation describes what was intentionally changed — it does not itself execute anything.
 */

import { z } from "zod";

// ── Experiment Mutation Types ───────────────────────────────────────────────

export const experimentMutationTypeSchema = z.enum([
  "model",                     // e.g. "gpt-4o" -> "claude-3-5-sonnet"
  "model_parameters",          // e.g. temperature, top_p, max_tokens
  "prompt",                    // e.g. prompt template version or system instruction change
  "context_inclusion",         // Explicit addition of context sources or items
  "context_exclusion",         // Explicit ablation/removal of context items
  "memory_inclusion",          // Addition of pre-seeded memories
  "memory_exclusion",          // Ablation/removal of memories
  "retrieval_configuration",   // e.g. top_k, embedding model, search filter, reranker
  "tool_exposure",             // Adding, removing, or re-ordering available tools
  "tool_result_override",      // Mocking or overriding a specific tool boundary output
  "workflow_configuration",    // Branching or stage timeout/retry parameter change
  "agent_configuration",       // Subagent role, permissions, or topology mutation
]);

export type ExperimentMutationType = z.infer<typeof experimentMutationTypeSchema>;

// ── Experiment Mutation ─────────────────────────────────────────────────────

export const experimentMutationSchema = z.object({
  mutation_id: z.string(),
  mutation_type: experimentMutationTypeSchema,
  target_identifier: z.string(),         // e.g. node_id, tool_name, parameter_name
  description: z.string(),
  original_value: z.unknown().optional(),
  mutated_value: z.unknown(),
  applied_at_step_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ExperimentMutation = z.infer<typeof experimentMutationSchema>;

// ── Checkpoint Reference ────────────────────────────────────────────────────

export const checkpointReferenceSchema = z.object({
  checkpoint_id: z.string(),
  run_id: z.string().optional(),
  step_id: z.string(),
  state_snapshot_id: z.string().optional(),
  boundary_cursor: z.number().int().nonnegative().optional().default(0),
  created_at: z.string(),
  schema_version: z.string().optional().default("1.0.0-alpha"),
  state_hash: z.string().optional(),
  hash: z.string().optional(),
  storage_uri: z.string().optional(),
  restorable: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CheckpointReference = z.infer<typeof checkpointReferenceSchema>;

// ── Run Lineage ─────────────────────────────────────────────────────────────

export const runLineageSchema = z.object({
  parent_run_id: z.string().optional(),
  root_run_id: z.string().optional(),
  fork_step_id: z.string().optional(),
  checkpoint_reference: checkpointReferenceSchema.optional(),
  experiment_id: z.string().optional(),
  baseline_run_id: z.string().optional(),
  mutations: z.array(experimentMutationSchema).default([]),
});

export type RunLineage = z.infer<typeof runLineageSchema>;

// ── Comparison Metadata ─────────────────────────────────────────────────────

export const comparisonMetadataSchema = z.object({
  baseline_run_id: z.string(),
  candidate_run_id: z.string(),
  divergence_step_id: z.string().optional(),
  divergence_reason: z.string().optional(),
  metrics_deltas: z.record(z.string(), z.number()).optional(), // e.g. cost_usd: -0.012, latency_ms: -350
  eval_pass_rate_delta: z.number().optional(),                 // e.g. +0.15
  outcome_verdict: z.enum(["improved", "regressed", "neutral", "inconclusive"]).default("inconclusive"),
  notes: z.array(z.string()).default([]),
});

export type ComparisonMetadata = z.infer<typeof comparisonMetadataSchema>;
