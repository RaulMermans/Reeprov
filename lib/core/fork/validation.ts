/**
 * Checkpoint and Mutation Pre-Flight Validation.
 *
 * Enforces strict, machine-readable validation before any fork execution commences.
 */

import type { RunArtifact } from "../contracts/runArtifact";
import type { CheckpointReference, ExperimentMutation } from "../contracts/lineage";
import { hashPayload } from "../capture/hashing";

export interface CheckpointValidationError {
  code:
    | "CHECKPOINT_NOT_FOUND"
    | "CHECKPOINT_CORRUPT"
    | "INVALID_CHECKPOINT"
    | "INVALID_CURSOR"
    | "CROSS_RUN_CHECKPOINT_REJECTED"
    | "CHECKPOINT_NOT_RESTORABLE"
    | "SCHEMA_UNSUPPORTED";
  message: string;
  details?: Record<string, unknown>;
}

export interface CheckpointValidationResult {
  valid: boolean;
  checkpoint?: CheckpointReference;
  errors: CheckpointValidationError[];
}

export const SUPPORTED_MUTATION_TYPES = [
  "state_patch",
  "tool_result_override",
  "model_parameters",
  "prompt",
] as const;

export type SupportedMutationType = (typeof SUPPORTED_MUTATION_TYPES)[number];

export function validateCheckpoint(
  artifact: RunArtifact,
  checkpointId: string
): CheckpointValidationResult {
  const errors: CheckpointValidationError[] = [];

  // 1. Checkpoint existence
  const checkpoints =
    artifact.checkpoints && artifact.checkpoints.length > 0
      ? artifact.checkpoints
      : artifact.lineage?.checkpoint_reference
        ? [artifact.lineage.checkpoint_reference]
        : [];

  const checkpoint = checkpoints.find((c) => c.checkpoint_id === checkpointId);
  if (!checkpoint) {
    errors.push({
      code: "CHECKPOINT_NOT_FOUND",
      message: `Checkpoint '${checkpointId}' not found in source run artifact.`,
      details: { checkpointId, availableCheckpoints: checkpoints.map((c) => c.checkpoint_id) },
    });
    return { valid: false, errors };
  }

  // 2. Cross-run checkpoint protection
  if (checkpoint.run_id && checkpoint.run_id !== artifact.identity.run_id) {
    errors.push({
      code: "CROSS_RUN_CHECKPOINT_REJECTED",
      message: `Checkpoint '${checkpointId}' belongs to run '${checkpoint.run_id}', not '${artifact.identity.run_id}'. Cross-run restore is rejected.`,
      details: { checkpointRunId: checkpoint.run_id, artifactRunId: artifact.identity.run_id },
    });
  }

  // 3. Step existence in trajectory
  const step = artifact.trajectory.find((s) => s.step_id === checkpoint.step_id);
  if (!step) {
    errors.push({
      code: "INVALID_CHECKPOINT",
      message: `Step '${checkpoint.step_id}' referenced by checkpoint '${checkpointId}' does not exist in source trajectory.`,
      details: { stepId: checkpoint.step_id },
    });
  }

  // 4. Snapshot existence in state
  const snapshotId = checkpoint.state_snapshot_id;
  const snapshot = snapshotId
    ? artifact.state.find((s) => s.snapshot_id === snapshotId)
    : artifact.state[0];

  if (!snapshot) {
    errors.push({
      code: "INVALID_CHECKPOINT",
      message: `State snapshot '${snapshotId}' referenced by checkpoint '${checkpointId}' is missing from source artifact.`,
      details: { snapshotId },
    });
  } else {
    // 5. State Hash Integrity
    const computedHash = hashPayload(snapshot.state_data);
    const expectedHash = checkpoint.state_hash ?? snapshot.hash;

    if (expectedHash && computedHash !== expectedHash) {
      errors.push({
        code: "CHECKPOINT_CORRUPT",
        message: `State hash mismatch for checkpoint '${checkpointId}'. Expected '${expectedHash}', computed '${computedHash}'. Snapshot data is corrupt.`,
        details: { expectedHash, computedHash, snapshotId: snapshot.snapshot_id },
      });
    }
  }

  // 6. Boundary cursor in range
  const boundaryCursor = checkpoint.boundary_cursor ?? 0;
  if (boundaryCursor < 0 || boundaryCursor > artifact.boundaries.length) {
    errors.push({
      code: "INVALID_CURSOR",
      message: `Boundary cursor ${boundaryCursor} is out of valid range [0, ${artifact.boundaries.length}].`,
      details: { boundaryCursor, totalBoundaries: artifact.boundaries.length },
    });
  }

  // 7. Checkpoint restorable flag
  if (checkpoint.restorable === false) {
    errors.push({
      code: "CHECKPOINT_NOT_RESTORABLE",
      message: `Checkpoint '${checkpointId}' is marked not restorable due to missing or invalid evidence.`,
      details: { checkpointId },
    });
  }

  return {
    valid: errors.length === 0,
    checkpoint,
    errors,
  };
}

export function validateMutation(mutation: ExperimentMutation): {
  valid: boolean;
  code?: string;
  error?: string;
} {
  if (!SUPPORTED_MUTATION_TYPES.includes(mutation.mutation_type as SupportedMutationType)) {
    return {
      valid: false,
      code: "UNSUPPORTED_MUTATION",
      error: `UNSUPPORTED_MUTATION: Mutation type '${mutation.mutation_type}' is not supported. Supported types: ${SUPPORTED_MUTATION_TYPES.join(", ")}.`,
    };
  }

  if (!mutation.target_identifier || mutation.target_identifier.trim().length === 0) {
    return {
      valid: false,
      code: "MUTATION_TARGET_NOT_FOUND",
      error: "MUTATION_TARGET_NOT_FOUND: Mutation requires a non-empty target_identifier.",
    };
  }

  return { valid: true };
}
