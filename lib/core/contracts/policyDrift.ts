/**
 * Policy Drift Contracts — Snapshots, Declared vs Behavioral Changes, Permission Expansion.
 *
 * Implements fine-grained tracking of agent security and permission drift across
 * configurations and runtime execution.
 *
 * Distinguishes:
 * - DECLARED_POLICY_CHANGE (intentional declared policy updates)
 * - BEHAVIORAL_POLICY_CHANGE (policy code unchanged, but runtime behavior changed, e.g. DENY -> ALLOW)
 * - PERMISSION_EXPANSION (sensitive new tools or access)
 * - APPROVAL_BEHAVIOR_CHANGE (human approval required -> bypassed)
 */

import { z } from "zod";

export const policyBehaviorSnapshotSchema = z.object({
  policy_snapshot_id: z.string(),
  project_id: z.string(),
  run_id: z.string(),
  policy_id: z.string(),
  policy_version: z.number().int().positive(),
  configuration_hash: z.string(),
  actions_observed: z.array(z.string()).default([]),
  allows: z.array(z.string()).default([]),
  denies: z.array(z.string()).default([]),
  approval_required: z.array(z.string()).default([]),
  approval_granted: z.array(z.string()).default([]),
  approval_rejected: z.array(z.string()).default([]),
  blocked_side_effects: z.array(z.string()).default([]),
  violations: z.array(z.string()).default([]),
  bypasses: z.array(z.string()).default([]),
  sensitive_tool_accesses: z.array(z.string()).default([]),
  declared_permissions: z.array(z.string()).default([]),
  captured_at: z.string(),
});

export type PolicyBehaviorSnapshot = z.infer<typeof policyBehaviorSnapshotSchema>;

export const policyDriftTypeSchema = z.enum([
  "DECLARED_POLICY_CHANGE",
  "BEHAVIORAL_POLICY_CHANGE",
  "APPROVAL_BEHAVIOR_CHANGE",
  "PERMISSION_EXPANSION",
  "PERMISSION_RESTRICTION",
  "SIDE_EFFECT_BEHAVIOR_CHANGE",
  "UNEXPECTED_POLICY_DRIFT",
]);
export type PolicyDriftType = z.infer<typeof policyDriftTypeSchema>;

export const policyDriftFindingSchema = z.object({
  finding_id: z.string(),
  drift_type: policyDriftTypeSchema,
  severity: z.enum(["INFO", "WARNING", "FAIL", "CRITICAL"]),
  description: z.string(),
  baseline_state: z.unknown(),
  candidate_state: z.unknown(),
  action_or_tool: z.string(),
  is_declared: z.boolean(),
});

export type PolicyDriftFinding = z.infer<typeof policyDriftFindingSchema>;

export const policyDriftReportSchema = z.object({
  drift_report_id: z.string(),
  baseline_snapshot_id: z.string(),
  candidate_snapshot_id: z.string(),
  baseline_run_id: z.string(),
  candidate_run_id: z.string(),
  declared_version_delta: z.object({
    baseline: z.number().int(),
    candidate: z.number().int(),
    changed: z.boolean(),
  }),
  drift_findings: z.array(policyDriftFindingSchema).default([]),
  findings: z.array(policyDriftFindingSchema).optional(),
  has_critical_drift: z.boolean(),
  summary: z.string(),
  created_at: z.string(),
});

export type PolicyDriftReport = z.infer<typeof policyDriftReportSchema>;
