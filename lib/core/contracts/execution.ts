/**
 * Canonical Execution Trajectory & State Snapshot Contracts.
 *
 * Tracks the chronological steps of an execution and the discrete point-in-time state
 * snapshots captured at each step.
 */

import { z } from "zod";

// ── State Scope & Snapshot ──────────────────────────────────────────────────

export const stateScopeSchema = z.enum([
  "global",    // System-wide or multi-agent shared state
  "agent",     // Agent-private working state
  "session",   // User session state
  "workflow",  // Active workflow execution state
]);

export type StateScope = z.infer<typeof stateScopeSchema>;

export const stateSnapshotTypeSchema = z.enum([
  "INITIAL_STATE",
  "STEP_STATE",
  "FINAL_STATE",
  "CUSTOM",
]);

export type StateSnapshotType = z.infer<typeof stateSnapshotTypeSchema>;

export const stateSnapshotSchema = z.object({
  snapshot_id: z.string(),
  step_id: z.string(),
  snapshot_type: stateSnapshotTypeSchema.default("STEP_STATE"),
  timestamp: z.string(),
  state_scope: stateScopeSchema.default("workflow"),
  state_data: z.record(z.string(), z.unknown()).default({}),
  captured: z.boolean().default(true),
  hash: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type StateSnapshot = z.infer<typeof stateSnapshotSchema>;

// ── Execution Step ──────────────────────────────────────────────────────────

export const executionStepTypeSchema = z.enum([
  "trigger",
  "node",
  "model_call",
  "tool_call",
  "retrieval",
  "memory_op",
  "eval",
  "approval",
  "checkpoint",
  "artifact",
  "state_change",
  "branch",
  "unknown",
]);

export type ExecutionStepType = z.infer<typeof executionStepTypeSchema>;

export const executionStepStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "blocked",
  "degraded",
]);

export type ExecutionStepStatus = z.infer<typeof executionStepStatusSchema>;

export const executionStepSchema = z.object({
  step_id: z.string(),
  step_index: z.number().int().nonnegative(),
  step_type: executionStepTypeSchema,
  name: z.string(),
  node_id: z.string().optional(),
  agent_id: z.string().optional(),
  started_at: z.string(),
  completed_at: z.string().optional(),
  duration_ms: z.number().optional(),
  status: executionStepStatusSchema.default("completed"),
  state_snapshot_id: z.string().optional(),
  context_snapshot_id: z.string().optional(),
  boundary_ids: z.array(z.string()).default([]),
  tool_invocation_ids: z.array(z.string()).default([]),
  model_invocation_ids: z.array(z.string()).default([]),
  memory_operation_ids: z.array(z.string()).default([]),
  retrieval_operation_ids: z.array(z.string()).default([]),
  eval_result_ids: z.array(z.string()).default([]),
  artifact_ids: z.array(z.string()).default([]),
  input_summary: z.string().optional(),
  output_summary: z.string().optional(),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ExecutionStep = z.infer<typeof executionStepSchema>;
