/**
 * Release Evidence Snapshot Contracts.
 *
 * Implements a durable, immutable historical record of release evidence:
 * "What did we know when this version was considered acceptable?"
 *
 * Invariants:
 * - Immutable once recorded.
 * - Does not perform automated deployment (external systems decide).
 * - Binds configuration, capability snapshot, policy snapshot, and regression gate result.
 */

import { z } from "zod";
import { hashPayload } from "../capture/hashing";
import { regressionGateStatusSchema } from "./regression";

export const releaseStatusSchema = z.enum([
  "CANDIDATE",
  "APPROVED_EXTERNALLY",
  "REJECTED",
  "SUPERSEDED",
]);
export type ReleaseStatus = z.infer<typeof releaseStatusSchema>;

export const releaseEvidenceSnapshotSchema = z.object({
  release_evidence_id: z.string(),
  project_id: z.string(),
  release_version: z.string(),
  git_sha: z.string().optional(),
  agent_id: z.string(),
  configuration_hash: z.string(),
  configuration_snapshot_id: z.string().optional(),
  capability_snapshot_id: z.string(),
  policy_snapshot_id: z.string(),
  eval_suite_id: z.string(),
  eval_suite_version: z.number().int().positive(),
  dataset_id: z.string().optional(),
  dataset_version: z.number().int().positive().optional(),
  regression_gate_result_id: z.string(),
  regression_gate_status: regressionGateStatusSchema,
  experiment_provenance_id: z.string().optional(),
  status: releaseStatusSchema.default("CANDIDATE"),
  approved_by: z.string().optional(),
  approved_at: z.string().optional(),
  created_at: z.string(),
  evidence_hash: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type ReleaseEvidenceSnapshot = z.infer<typeof releaseEvidenceSnapshotSchema>;

export function computeReleaseEvidenceHash(payload: Omit<ReleaseEvidenceSnapshot, "evidence_hash" | "status">): string {
  return hashPayload({
    release_evidence_id: payload.release_evidence_id,
    project_id: payload.project_id,
    release_version: payload.release_version,
    agent_id: payload.agent_id,
    configuration_hash: payload.configuration_hash,
    capability_snapshot_id: payload.capability_snapshot_id,
    policy_snapshot_id: payload.policy_snapshot_id,
    eval_suite_id: payload.eval_suite_id,
    regression_gate_result_id: payload.regression_gate_result_id,
    regression_gate_status: payload.regression_gate_status,
  });
}
