/**
 * Capability Engine Contracts — Snapshots, Dimensions, History, and Drift.
 *
 * Implements evidence-based capability tracking across agent versions without
 * inventing arbitrary intelligence scores.
 *
 * Principles:
 * - Derived strictly from named evaluation evidence.
 * - Multi-dimensional tracking (no collapsing into a single meaningless score).
 * - Distinguishes IMPROVED vs REGRESSED vs UNCHANGED vs INCONCLUSIVE.
 * - Associates configuration changes without unsupported causality claims.
 */

import { z } from "zod";

export const capabilityDimensionTypeSchema = z.enum([
  "TASK_SUCCESS",
  "TOOL_USE",
  "RETRIEVAL",
  "CONTEXT",
  "MEMORY",
  "SAFETY",
  "APPROVAL_COMPLIANCE",
  "COST_EFFICIENCY",
  "LATENCY",
  "TRAJECTORY",
]);
export type CapabilityDimensionType = z.infer<typeof capabilityDimensionTypeSchema>;

export const capabilityDimensionScoreSchema = z.object({
  dimension: capabilityDimensionTypeSchema,
  score: z.number().min(0).max(1),
  pass_rate: z.number().min(0).max(1),
  case_count: z.number().int().nonnegative(),
  trial_count: z.number().int().nonnegative(),
  eval_definition_ids: z.array(z.string()).default([]),
  evidence_quality: z.enum(["HIGH", "MEDIUM", "LOW"]).default("HIGH"),
});

export type CapabilityDimensionScore = z.infer<typeof capabilityDimensionScoreSchema>;

export const capabilitySnapshotSchema = z.object({
  capability_snapshot_id: z.string(),
  project_id: z.string(),
  agent_id: z.string(),
  agent_version: z.string(),
  configuration_hash: z.string(),
  evaluation_run_ids: z.array(z.string()).default([]),
  suite_id: z.string(),
  suite_version: z.number().int().positive(),
  dataset_id: z.string().optional(),
  dataset_version: z.number().int().positive().optional(),
  captured_at: z.string(),
  dimensions: z.array(capabilityDimensionScoreSchema),
  overall_status: z.enum(["ACCEPTABLE", "DEGRADED", "UNPROVEN"]).default("ACCEPTABLE"),
  evidence_quality: z.enum(["HIGH", "MEDIUM", "LOW"]).default("HIGH"),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type CapabilitySnapshot = z.infer<typeof capabilitySnapshotSchema>;

export const dimensionDriftSchema = z.object({
  dimension: capabilityDimensionTypeSchema,
  baseline_score: z.number(),
  candidate_score: z.number(),
  score_delta: z.number(),
  baseline_pass_rate: z.number(),
  candidate_pass_rate: z.number(),
  direction: z.enum(["IMPROVED", "REGRESSED", "UNCHANGED", "INCONCLUSIVE"]),
  associated_configuration_changes: z.array(z.string()).default([]),
  attribution: z.enum([
    "ASSOCIATED_CHANGE",
    "CAUSALLY_SUPPORTED_WITHIN_EXPERIMENT",
    "UNATTRIBUTED",
  ]).default("ASSOCIATED_CHANGE"),
});

export type DimensionDrift = z.infer<typeof dimensionDriftSchema>;

export const capabilityDriftReportSchema = z.object({
  report_id: z.string(),
  baseline_snapshot_id: z.string(),
  candidate_snapshot_id: z.string(),
  agent_id: z.string(),
  baseline_version: z.string(),
  candidate_version: z.string(),
  dimensions: z.array(dimensionDriftSchema),
  drift_summary: string(),
  overall_drift: z.enum(["IMPROVED", "REGRESSED", "UNCHANGED", "INCONCLUSIVE"]),
  created_at: z.string(),
});

function string() {
  return z.string();
}

export type CapabilityDriftReport = z.infer<typeof capabilityDriftReportSchema>;

export const capabilityHistorySchema = z.object({
  agent_id: z.string(),
  snapshots: z.array(capabilitySnapshotSchema),
});

export type CapabilityHistory = z.infer<typeof capabilityHistorySchema>;
