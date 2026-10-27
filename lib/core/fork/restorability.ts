/**
 * Checkpoint Restorability Assessment.
 *
 * A checkpoint is advertised as RESTORABLE only when both hold:
 * 1. Its state is valid: a REGISTERED checkpoint with an existing snapshot,
 *    a matching state hash, a valid boundary cursor and a declared resume
 *    adapter identity.
 * 2. A compatible host resume capability has been verified: either a host
 *    adapter with the same identity was probed now (`supportsResume`), or a
 *    derived run resumed from this checkpoint with that adapter.
 *
 * Observations and legacy checkpoints are never advertised as restorable.
 */

import type { RunArtifact } from "../contracts/runArtifact";
import type { CheckpointReference, ResumeAdapterIdentity } from "../contracts/lineage";
import { validateCheckpoint } from "./validation";

export type RestorabilityStatus =
  | "RESTORABLE"
  | "STATE_VALID_HOST_UNVERIFIED"
  | "LEGACY_UNVERIFIED"
  | "INVALID";

export interface HostResumeProbe {
  identity: ResumeAdapterIdentity;
  supportsResume(position: { resume_step_index: number; resume_step_id?: string }): boolean;
}

export interface VerifiedResume {
  derived_run_id: string;
  checkpoint_id: string;
  adapter: ResumeAdapterIdentity;
}

export interface CheckpointAssessment {
  checkpoint_id: string;
  status: RestorabilityStatus;
  /** True only for RESTORABLE. UI and APIs must use this, not `checkpoint.restorable`. */
  advertised_restorable: boolean;
  state_valid: boolean;
  resume_adapter?: ResumeAdapterIdentity;
  verified_by?: { kind: "HOST_PROBE" } | { kind: "RESUMED_FORK"; derived_run_id: string };
  reasons: string[];
}

export function sameAdapter(a?: ResumeAdapterIdentity, b?: ResumeAdapterIdentity): boolean {
  return Boolean(a && b && a.adapter_id === b.adapter_id && a.adapter_version === b.adapter_version);
}

export function assessCheckpoint(
  artifact: RunArtifact,
  checkpoint: CheckpointReference,
  options: { host?: HostResumeProbe; verifiedResumes?: VerifiedResume[] } = {},
): CheckpointAssessment {
  const reasons = [...(checkpoint.restorability_reasons ?? [])];
  const validation = validateCheckpoint(artifact, checkpoint.checkpoint_id);
  for (const err of validation.errors) reasons.push(`${err.code}: ${err.message}`);

  if (checkpoint.capture_kind !== "REGISTERED") {
    return {
      checkpoint_id: checkpoint.checkpoint_id,
      status: validation.valid ? "LEGACY_UNVERIFIED" : "INVALID",
      advertised_restorable: false,
      state_valid: false,
      resume_adapter: checkpoint.resume_adapter,
      reasons: [
        ...reasons,
        "LEGACY_CHECKPOINT: not captured through restorable-checkpoint registration; no verified host resume contract.",
      ],
    };
  }

  const stateValid = validation.valid && checkpoint.restorable !== false && reasons.length === 0;
  if (!stateValid) {
    return {
      checkpoint_id: checkpoint.checkpoint_id,
      status: "INVALID",
      advertised_restorable: false,
      state_valid: false,
      resume_adapter: checkpoint.resume_adapter,
      reasons,
    };
  }

  const position = {
    resume_step_index: checkpoint.resume_step_index ?? 0,
    resume_step_id: checkpoint.resume_step_id,
  };
  if (options.host) {
    if (!sameAdapter(options.host.identity, checkpoint.resume_adapter)) {
      reasons.push(
        `INCOMPATIBLE_HOST_ADAPTER: checkpoint requires ${fmt(checkpoint.resume_adapter)}, host provides ${fmt(options.host.identity)}.`,
      );
    } else if (!options.host.supportsResume(position)) {
      reasons.push(
        `UNSUPPORTED_RESUME_POINT: host ${fmt(options.host.identity)} does not support resuming at step index ${position.resume_step_index}${position.resume_step_id ? ` (${position.resume_step_id})` : ""}.`,
      );
    } else {
      return {
        checkpoint_id: checkpoint.checkpoint_id,
        status: "RESTORABLE",
        advertised_restorable: true,
        state_valid: true,
        resume_adapter: checkpoint.resume_adapter,
        verified_by: { kind: "HOST_PROBE" },
        reasons,
      };
    }
    return {
      checkpoint_id: checkpoint.checkpoint_id,
      status: "STATE_VALID_HOST_UNVERIFIED",
      advertised_restorable: false,
      state_valid: true,
      resume_adapter: checkpoint.resume_adapter,
      reasons,
    };
  }

  const resumed = (options.verifiedResumes ?? []).find(
    (v) => v.checkpoint_id === checkpoint.checkpoint_id && sameAdapter(v.adapter, checkpoint.resume_adapter),
  );
  if (resumed) {
    return {
      checkpoint_id: checkpoint.checkpoint_id,
      status: "RESTORABLE",
      advertised_restorable: true,
      state_valid: true,
      resume_adapter: checkpoint.resume_adapter,
      verified_by: { kind: "RESUMED_FORK", derived_run_id: resumed.derived_run_id },
      reasons,
    };
  }

  return {
    checkpoint_id: checkpoint.checkpoint_id,
    status: "STATE_VALID_HOST_UNVERIFIED",
    advertised_restorable: false,
    state_valid: true,
    resume_adapter: checkpoint.resume_adapter,
    reasons: [
      ...reasons,
      `HOST_RESUME_UNVERIFIED: no compatible host (${fmt(checkpoint.resume_adapter)}) has been verified for this checkpoint yet.`,
    ],
  };
}

function fmt(identity?: ResumeAdapterIdentity): string {
  return identity ? `${identity.adapter_id}@${identity.adapter_version}` : "<none>";
}

/** A child run proves host resume only if it completed a resumed fork with a declared adapter. */
export function verifiedResumesFrom(children: RunArtifact[]): VerifiedResume[] {
  return children.flatMap((child) => {
    const fork = child.provenance.metadata?.["fork"] as
      | { adapter?: ResumeAdapterIdentity; resumed?: boolean; status?: string }
      | undefined;
    const checkpointId = child.lineage?.fork_checkpoint_id;
    if (!checkpointId || !fork?.adapter || fork.resumed !== true || fork.status !== "COMPLETED") return [];
    return [{ derived_run_id: child.identity.run_id, checkpoint_id: checkpointId, adapter: fork.adapter }];
  });
}
