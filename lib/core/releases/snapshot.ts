/**
 * Release Evidence Snapshot Engine.
 *
 * Captures durable historical records of release qualification evidence:
 * - Links release version, agent configuration, capability snapshot, policy snapshot,
 *   eval suite, dataset, and regression gate result.
 * - Enforces immutability: records what was proven at release qualification time.
 * - Statuses: CANDIDATE, APPROVED_EXTERNALLY, REJECTED, SUPERSEDED.
 * - Does NOT deploy candidates (deployment remains external).
 */

import {
  type ReleaseEvidenceSnapshot,
  type ReleaseStatus,
  releaseEvidenceSnapshotSchema,
  computeReleaseEvidenceHash,
} from "../contracts/releaseEvidence";
import { saveReleaseEvidenceSnapshot } from "./persistence";

export interface CreateReleaseSnapshotOptions {
  releaseEvidenceId?: string;
  projectId: string;
  releaseVersion: string;
  gitSha?: string;
  agentId: string;
  configurationHash: string;
  configurationSnapshotId?: string;
  capabilitySnapshotId: string;
  policySnapshotId: string;
  evalSuiteId: string;
  evalSuiteVersion: number;
  datasetId?: string;
  datasetVersion?: number;
  regressionGateResultId: string;
  regressionGateStatus: ReleaseEvidenceSnapshot["regression_gate_status"];
  experimentProvenanceId?: string;
  status?: ReleaseStatus;
  approvedBy?: string;
  approvedAt?: string;
  metadata?: Record<string, unknown>;
  persist?: boolean;
}

export class ReleaseEvidenceEngine {
  /**
   * Creates an immutable ReleaseEvidenceSnapshot.
   */
  static async createSnapshot(
    options: CreateReleaseSnapshotOptions
  ): Promise<ReleaseEvidenceSnapshot> {
    const id =
      options.releaseEvidenceId ??
      `rel_${options.agentId}_${options.releaseVersion}_${Date.now()}`;
    const createdAt = new Date().toISOString();

    const partial = {
      release_evidence_id: id,
      project_id: options.projectId,
      release_version: options.releaseVersion,
      git_sha: options.gitSha,
      agent_id: options.agentId,
      configuration_hash: options.configurationHash,
      configuration_snapshot_id: options.configurationSnapshotId,
      capability_snapshot_id: options.capabilitySnapshotId,
      policy_snapshot_id: options.policySnapshotId,
      eval_suite_id: options.evalSuiteId,
      eval_suite_version: options.evalSuiteVersion,
      dataset_id: options.datasetId,
      dataset_version: options.datasetVersion,
      regression_gate_result_id: options.regressionGateResultId,
      regression_gate_status: options.regressionGateStatus,
      experiment_provenance_id: options.experimentProvenanceId,
      approved_by: options.approvedBy,
      approved_at: options.approvedAt,
      created_at: createdAt,
      metadata: options.metadata ?? {},
    };

    const evidenceHash = computeReleaseEvidenceHash(partial);

    const snapshot: ReleaseEvidenceSnapshot = releaseEvidenceSnapshotSchema.parse({
      ...partial,
      evidence_hash: evidenceHash,
      status:
        options.status ??
        (options.regressionGateStatus === "PASS" ? "APPROVED_EXTERNALLY" : "CANDIDATE"),
    });

    if (options.persist !== false) {
      await saveReleaseEvidenceSnapshot(snapshot);
    }

    return snapshot;
  }
}
