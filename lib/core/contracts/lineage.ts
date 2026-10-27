/**
 * Canonical Experiment, Lineage, and Fork Contracts.
 *
 * Captures how runs relate to baselines, parent runs, checkpoints, and controlled experiments.
 * A mutation describes what was intentionally changed — it does not itself execute anything.
 */

import { z } from "zod";

export const checkpointPositionSchema = z.enum([
  "BEFORE_STEP",
  "AFTER_STEP",
  "CUSTOM",
]);

export type CheckpointPosition = z.infer<typeof checkpointPositionSchema>;

// ── Experiment Mutation Types ───────────────────────────────────────────────

export const experimentMutationTypeSchema = z.enum([
  "state_patch",               // Structured deterministic JSON state patch
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

/**
 * How a checkpoint record came to exist.
 * - REGISTERED: the host submitted a validated state snapshot, cursor and
 *   resume adapter identity (restorable-checkpoint capture).
 * - LEGACY: created before Sprint 13 or by in-process fixtures; never
 *   advertised as restorable for external hosts without re-verification.
 * Observed-only checkpoints are not CheckpointReferences; see
 * checkpointObservationSchema.
 */
export const checkpointCaptureKindSchema = z.enum(["REGISTERED", "LEGACY"]);

export type CheckpointCaptureKind = z.infer<typeof checkpointCaptureKindSchema>;

/** Identity of the host code that knows how to resume from a checkpoint. */
export const resumeAdapterIdentitySchema = z.object({
  adapter_id: z.string().min(1),
  adapter_version: z.string().min(1),
});

export type ResumeAdapterIdentity = z.infer<typeof resumeAdapterIdentitySchema>;

export const checkpointReferenceSchema = z.object({
  checkpoint_id: z.string(),
  run_id: z.string().optional(),
  step_id: z.string(),
  position: checkpointPositionSchema.default("AFTER_STEP"),
  state_snapshot_id: z.string().optional(),
  boundary_cursor: z.number().int().nonnegative().optional().default(0),
  resume_step_index: z.number().int().nonnegative().optional(),
  resume_step_id: z.string().optional(),
  created_at: z.string(),
  schema_version: z.string().optional().default("1.0.0-alpha"),
  state_hash: z.string().optional(),
  hash: z.string().optional(),
  storage_uri: z.string().optional(),
  restorable: z.boolean().default(true),
  capture_kind: checkpointCaptureKindSchema.optional(),
  /** Host step identity the checkpoint was taken at (host-defined, not the trace step id). */
  host_step_id: z.string().optional(),
  host_step_index: z.number().int().nonnegative().optional(),
  resume_adapter: resumeAdapterIdentitySchema.optional(),
  /** Machine-readable reasons this checkpoint cannot be restored. */
  restorability_reasons: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CheckpointReference = z.infer<typeof checkpointReferenceSchema>;

// ── Checkpoint Observation ──────────────────────────────────────────────────

/**
 * An external agent reported that it reached a checkpoint. An observation
 * never claims resumability: it has no restorable snapshot and is never used
 * as a fork point. It is also not an execution boundary — replay does not
 * substitute or expect it.
 */
export const checkpointObservationSchema = z.object({
  observation_id: z.string(),
  checkpoint_id: z.string(),
  run_id: z.string(),
  step_id: z.string().optional(),
  node_id: z.string().optional(),
  observed_at: z.string(),
  /** Hash of the sanitized state the host reported, when content capture allowed it. */
  reported_state_hash: z.string().optional(),
  source: z.enum(["SDK_OBSERVATION", "LEGACY_CHECKPOINT_BOUNDARY"]),
  restorable: z.literal(false).default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CheckpointObservation = z.infer<typeof checkpointObservationSchema>;

// ── Run Lineage ─────────────────────────────────────────────────────────────

export const runLineageSchema = z.object({
  parent_run_id: z.string().optional(),
  root_run_id: z.string().optional(),
  fork_checkpoint_id: z.string().optional(),
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
