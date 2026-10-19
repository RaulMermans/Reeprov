/**
 * Canonical Contracts & Schemas for Offline Replay Runtime.
 *
 * Defines versioned contracts for ReplayPlan, ReplayResult, ReplayEvent, and ReplayDivergence.
 */

import { z } from "zod";
import { checkpointReferenceSchema } from "../contracts/lineage";

export const CANONICAL_REPLAY_SCHEMA_VERSION = "1.0.0-alpha";

// ── Replay Modes & Statuses ──────────────────────────────────────────────────

export const replayModeSchema = z.enum([
  "STRICT_OFFLINE",         // Recorded dependencies; known Node I/O blocked; fail fast on mismatch
  "BEST_EFFORT_OFFLINE",    // Record divergences and continue where possible
  "VALIDATION_ONLY",        // Inspect artifact & create ReplayPlan without executing logic
]);

export type ReplayMode = z.infer<typeof replayModeSchema>;

export const replayStatusSchema = z.enum([
  "MATCHED",
  "DIVERGED",
  "BLOCKED",
  "UNSUPPORTED",
  "FAILED",
]);

export type ReplayStatus = z.infer<typeof replayStatusSchema>;

export const replayabilityVerdictSchema = z.enum([
  "REPLAYABLE",
  "PARTIALLY_REPLAYABLE",
  "NOT_REPLAYABLE",
]);

export type ReplayabilityVerdict = z.infer<typeof replayabilityVerdictSchema>;

// ── Divergence Types & Schema ────────────────────────────────────────────────

export const divergenceTypeSchema = z.enum([
  "STEP_MISMATCH",
  "BOUNDARY_TYPE_MISMATCH",
  "BOUNDARY_IDENTITY_MISMATCH",
  "INPUT_HASH_MISMATCH",
  "STATE_HASH_MISMATCH",
  "MISSING_BOUNDARY",
  "EXTRA_BOUNDARY",
  "ORDER_MISMATCH",
  "MISSING_PAYLOAD",
  "UNSUPPORTED_BOUNDARY",
  "OUTPUT_MISMATCH",
  "NETWORK_ATTEMPT_BLOCKED",
  "SIDE_EFFECT_ATTEMPT_BLOCKED",
]);

export type DivergenceType = z.infer<typeof divergenceTypeSchema>;

export const replayDivergenceSchema = z.object({
  divergence_id: z.string(),
  replay_id: z.string(),
  source_run_id: z.string(),
  divergence_type: divergenceTypeSchema,
  step_index: z.number().int().nonnegative().optional(),
  boundary_sequence: z.number().int().nonnegative().optional(),
  expected: z.record(z.string(), z.unknown()).default({}),
  actual: z.record(z.string(), z.unknown()).default({}),
  severity: z.enum(["critical", "warning"]).default("critical"),
  message: z.string(),
  timestamp: z.string(),
});

export type ReplayDivergence = z.infer<typeof replayDivergenceSchema>;

// ── Replay Events ────────────────────────────────────────────────────────────

export const replayEventTypeSchema = z.enum([
  "replay.start",
  "replay.plan.created",
  "replay.state.restored",
  "replay.step.start",
  "replay.boundary.requested",
  "replay.boundary.substituted",
  "replay.side_effect_substituted",
  "replay.live_side_effect_blocked",
  "replay.network_blocked",
  "replay.divergence",
  "replay.step.complete",
  "replay.complete",
  "replay.fail",
]);

export type ReplayEventType = z.infer<typeof replayEventTypeSchema>;

export const replayEventSchema = z.object({
  event_id: z.string(),
  replay_id: z.string(),
  source_run_id: z.string(),
  event_type: replayEventTypeSchema,
  timestamp: z.string(),
  step_id: z.string().optional(),
  boundary_id: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type ReplayEvent = z.infer<typeof replayEventSchema>;

// ── Expected Step & Boundary Summaries ───────────────────────────────────────

export const expectedStepSchema = z.object({
  step_id: z.string(),
  step_index: z.number().int().nonnegative(),
  name: z.string(),
  step_type: z.string(),
  boundary_ids: z.array(z.string()).default([]),
  state_snapshot_id: z.string().optional(),
});

export type ExpectedStep = z.infer<typeof expectedStepSchema>;

export const expectedBoundarySchema = z.object({
  boundary_id: z.string(),
  sequence_index: z.number().int().nonnegative(),
  boundary_type: z.string(),
  name: z.string(),
  dependency_identity: z.string().optional(),
  step_id: z.string().optional(),
  input_hash: z.string().optional(),
  output_hash: z.string().optional(),
  replayability: z.string(),
  side_effect_class: z.string(),
  content_availability: z.string(),
});

export type ExpectedBoundary = z.infer<typeof expectedBoundarySchema>;

// ── ReplayPlan ───────────────────────────────────────────────────────────────

export const replayPlanSchema = z.object({
  replay_id: z.string(),
  source_run_id: z.string(),
  source_schema_version: z.string(),
  mode: replayModeSchema.default("STRICT_OFFLINE"),
  expected_steps: z.array(expectedStepSchema).default([]),
  expected_boundaries: z.array(expectedBoundarySchema).default([]),
  checkpoint: checkpointReferenceSchema.optional().nullable(),
  boundary_policy: z.record(z.string(), z.unknown()).default({}),
  state_policy: z.record(z.string(), z.unknown()).default({}),
  environment_requirements: z.record(z.string(), z.unknown()).default({}),
  unsupported_features: z.array(z.string()).default([]),
  missing_evidence: z.array(z.string()).default([]),
  replayability_verdict: replayabilityVerdictSchema,
  created_at: z.string(),
});

export type ReplayPlan = z.infer<typeof replayPlanSchema>;

// ── ReplayResult ─────────────────────────────────────────────────────────────

export const replayResultSchema = z.object({
  replay_id: z.string(),
  source_run_id: z.string(),
  replay_of: z.string(),
  status: replayStatusSchema,
  mode: replayModeSchema,
  started_at: z.string(),
  completed_at: z.string(),
  steps_expected: z.number().int().nonnegative(),
  steps_executed: z.number().int().nonnegative(),
  boundaries_expected: z.number().int().nonnegative(),
  boundaries_substituted: z.number().int().nonnegative(),
  live_calls_attempted: z.number().int().nonnegative().default(0),
  live_calls_blocked: z.number().int().nonnegative().default(0),
  divergences: z.array(replayDivergenceSchema).default([]),
  final_output: z.unknown().optional(),
  final_output_hash: z.string().optional(),
  deterministic_match: z.boolean().default(false),
  limitations: z.array(z.string()).default([]),
  replay_events: z.array(replayEventSchema).default([]),
  last_successful_step_id: z.string().optional(),
  last_substituted_boundary_id: z.string().optional(),
});

export type ReplayResult = z.infer<typeof replayResultSchema>;
