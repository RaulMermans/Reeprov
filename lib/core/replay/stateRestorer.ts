/**
 * State and Checkpoint Restorer.
 *
 * Restores point-in-time state snapshots and checkpoints to initialize replay execution,
 * validating hash integrity before mounting into the host application.
 */

import type { RunArtifact } from "../contracts/runArtifact";
import type { StateSnapshot } from "../contracts/execution";
import type { CheckpointReference } from "../contracts/lineage";
import { hashPayload } from "../capture/hashing";

export class StateRestorationError extends Error {
  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(`[StateRestorationError] ${message}`);
    this.name = "StateRestorationError";
  }
}

export interface RestoredStateResult {
  state: Record<string, unknown>;
  snapshotId: string;
  stepId: string;
  hash: string;
  boundaryCursor: number;
}

export class StateRestorer {
  private readonly snapshots: StateSnapshot[];
  private readonly checkpoints: CheckpointReference[];

  constructor(source: RunArtifact | { state?: StateSnapshot[]; checkpoints?: CheckpointReference[]; lineage?: { checkpoint_reference?: CheckpointReference } }) {
    this.snapshots = source.state ?? [];
    if ("checkpoints" in source && source.checkpoints && source.checkpoints.length > 0) {
      this.checkpoints = source.checkpoints;
    } else if ("lineage" in source && source.lineage?.checkpoint_reference) {
      this.checkpoints = [source.lineage.checkpoint_reference];
    } else {
      this.checkpoints = [];
    }
  }

  /**
   * Restores initial recorded state for replay start.
   * Looks up INITIAL_STATE snapshot or the first snapshot.
   */
  restoreInitialState(): RestoredStateResult {
    if (this.snapshots.length === 0) {
      return {
        state: {},
        snapshotId: "empty_initial",
        stepId: "step_initial",
        hash: hashPayload({}),
        boundaryCursor: 0,
      };
    }

    const initialSnapshot =
      this.snapshots.find((s) => s.snapshot_type === "INITIAL_STATE") ??
      this.snapshots[0];

    // Validate hash integrity
    const computedHash = hashPayload(initialSnapshot.state_data);
    if (initialSnapshot.hash && computedHash !== initialSnapshot.hash) {
      throw new StateRestorationError(
        `Initial state hash mismatch! Recorded hash '${initialSnapshot.hash}', computed '${computedHash}'. State corrupted.`,
        {
          snapshotId: initialSnapshot.snapshot_id,
          expectedHash: initialSnapshot.hash,
          actualHash: computedHash,
        }
      );
    }

    return {
      state: structuredClone(initialSnapshot.state_data),
      snapshotId: initialSnapshot.snapshot_id,
      stepId: initialSnapshot.step_id,
      hash: computedHash,
      boundaryCursor: 0,
    };
  }

  /**
   * Restores state from a specific checkpoint.
   * Explicit checkpoint request MUST fail closed if not found.
   */
  restoreCheckpoint(checkpointId?: string): RestoredStateResult {
    if (checkpointId !== undefined) {
      const checkpoint = this.checkpoints.find((c) => c.checkpoint_id === checkpointId);
      if (!checkpoint) {
        throw new StateRestorationError(
          `CHECKPOINT_NOT_FOUND: Checkpoint '${checkpointId}' was explicitly requested but not found in run artifact.`,
          { checkpointId }
        );
      }
      return this.restoreFromCheckpoint(checkpoint);
    }

    if (this.checkpoints.length > 0) {
      return this.restoreFromCheckpoint(this.checkpoints[0]);
    }

    // Fallback to initial state only when no checkpoint was explicitly requested
    return this.restoreInitialState();
  }

  private restoreFromCheckpoint(checkpoint: CheckpointReference): RestoredStateResult {
    const targetSnapshot = checkpoint.state_snapshot_id
      ? this.snapshots.find((s) => s.snapshot_id === checkpoint.state_snapshot_id)
      : this.snapshots[0];

    if (!targetSnapshot) {
      throw new StateRestorationError(
        `Checkpoint '${checkpoint.checkpoint_id}' references snapshot '${checkpoint.state_snapshot_id}', but snapshot is missing.`,
        { checkpointId: checkpoint.checkpoint_id, snapshotId: checkpoint.state_snapshot_id }
      );
    }

    const computedHash = hashPayload(targetSnapshot.state_data);
    const expectedHash = checkpoint.state_hash ?? targetSnapshot.hash;
    if (expectedHash && computedHash !== expectedHash) {
      throw new StateRestorationError(
        `CHECKPOINT_CORRUPT: Checkpoint state hash mismatch! Expected '${expectedHash}', computed '${computedHash}'.`,
        {
          checkpointId: checkpoint.checkpoint_id,
          expectedHash,
          actualHash: computedHash,
        }
      );
    }

    return {
      state: structuredClone(targetSnapshot.state_data),
      snapshotId: targetSnapshot.snapshot_id,
      stepId: targetSnapshot.step_id,
      hash: computedHash,
      boundaryCursor: checkpoint.boundary_cursor ?? 0,
    };
  }

  /**
   * Validates whether a current host state matches the recorded snapshot for a step.
   */
  validateStepState(
    stepIdOrIndex: string | number,
    currentState: Record<string, unknown>
  ): { matches: boolean; expectedHash?: string; actualHash: string } {
    const snapshot =
      typeof stepIdOrIndex === "number"
        ? this.snapshots[stepIdOrIndex]
        : this.snapshots.find((s) => s.step_id === stepIdOrIndex);

    const actualHash = hashPayload(currentState);

    if (!snapshot) {
      return { matches: true, actualHash };
    }

    const expectedHash = snapshot.hash ?? hashPayload(snapshot.state_data);
    return {
      matches: actualHash === expectedHash,
      expectedHash,
      actualHash,
    };
  }
}
