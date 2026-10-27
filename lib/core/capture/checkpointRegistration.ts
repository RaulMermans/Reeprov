/**
 * Checkpoint observation and restorable-checkpoint registration.
 *
 * These are two distinct operations:
 *
 * - observeCheckpoint: records that an external agent reported reaching a
 *   checkpoint. Never restorable, never a fork point, never a boundary.
 *
 * - registerCheckpoint: validates and stores a state snapshot plus a linked
 *   CheckpointReference carrying step identity, boundary cursor, state hash
 *   and resume adapter identity. The result is REGISTERED with state
 *   validity established; it is advertised as restorable only after a
 *   compatible host resume capability is verified (see fork/restorability).
 */

import { z } from "zod";
import type { RunArtifact } from "../contracts/runArtifact";
import type { CheckpointObservation, CheckpointReference } from "../contracts/lineage";
import { resumeAdapterIdentitySchema, checkpointPositionSchema } from "../contracts/lineage";
import type { StateSnapshot } from "../contracts/execution";
import type { TraceEvent } from "../../proof-layer/schemas";
import type { SavedRun } from "../../runs/runTypes";
import { getRunStore } from "../../db/getStores";
import { hashPayload } from "./hashing";
import { sanitizeCanonicalRecord, sanitizePayload } from "./redaction";
import { mutateCanonicalRun } from "./persistence";
import { capturePolicyForRun, refreshCanonicalFromLegacy } from "./runPolicy";
import { storeObservation } from "./ingestBoundaries";
import { assessCheckpoint, type CheckpointAssessment } from "../fork/restorability";

export const registerCheckpointInputSchema = z.object({
  checkpoint_id: z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/, "checkpoint_id may contain letters, digits, _ . : -"),
  step_id: z.string().min(1),
  step_index: z.number().int().nonnegative().optional(),
  position: checkpointPositionSchema.default("AFTER_STEP"),
  resume_step_index: z.number().int().nonnegative(),
  resume_step_id: z.string().min(1).optional(),
  boundary_cursor: z.number().int().nonnegative(),
  state: z.record(z.string(), z.unknown()),
  /** Canonical sha256 of `state` computed by the client; detects corruption in transit. */
  state_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
  adapter: resumeAdapterIdentitySchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RegisterCheckpointInput = z.infer<typeof registerCheckpointInputSchema>;

export const observeCheckpointInputSchema = z.object({
  checkpoint_id: z.string().min(1).max(200),
  step_id: z.string().optional(),
  node_id: z.string().optional(),
  state: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CheckpointRegistrationStatus =
  | "REGISTERED"
  | "REGISTERED_NOT_RESTORABLE"
  | "DUPLICATE"
  | "OBSERVATION_RECORDED"
  | "REJECTED";

export interface CheckpointRegistrationResult {
  status: CheckpointRegistrationStatus;
  code?: string;
  message?: string;
  checkpoint?: CheckpointReference;
  observation?: CheckpointObservation;
  assessment?: CheckpointAssessment;
}

const reject = (code: string, message: string): CheckpointRegistrationResult => ({ status: "REJECTED", code, message });

export function checkpointStepEventId(runId: string, checkpointId: string): string {
  return `${runId}::checkpoint::${checkpointId}`;
}

function registrationFingerprint(c: CheckpointReference): string {
  const { created_at: _c, ...rest } = c;
  return hashPayload(rest);
}

export async function registerCheckpoint(
  runId: string,
  rawInput: unknown,
  legacyRun: SavedRun,
): Promise<CheckpointRegistrationResult> {
  const parsed = registerCheckpointInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return reject("INVALID_CHECKPOINT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const input = parsed.data;

  return mutateCanonicalRun<CheckpointRegistrationResult>(runId, async (current) => {
    const policy = capturePolicyForRun(current);
    if (policy.contentMode === "STRUCTURE_ONLY") {
      return {
        value: reject(
          "STATE_CAPTURE_DISABLED",
          "This run uses STRUCTURE_ONLY capture; a restorable checkpoint needs its state snapshot. Record a checkpoint observation instead.",
        ),
      };
    }
    if (legacyRun.runRecord.status !== "running") {
      return { value: reject("RUN_NOT_RUNNING", `Run is ${legacyRun.runRecord.status}; checkpoints can only be registered while it runs.`) };
    }

    // Integrity in transit: the client hash is over the state it sent.
    const receivedHash = hashPayload(input.state);
    if (input.state_hash && input.state_hash !== receivedHash) {
      return {
        value: reject(
          "CHECKPOINT_STATE_HASH_MISMATCH",
          `Client state hash ${input.state_hash} does not match received state ${receivedHash}; the snapshot was corrupted or altered.`,
        ),
      };
    }

    const base = refreshCanonicalFromLegacy(current, legacyRun);
    const sequences = new Set(base.boundaries.map((b) => b.sequence_index ?? 0));
    for (let seq = 0; seq < input.boundary_cursor; seq++) {
      if (!sequences.has(seq)) {
        return {
          value: reject(
            "CURSOR_AHEAD_OF_EVIDENCE",
            `boundary_cursor ${input.boundary_cursor} requires acknowledged boundaries 0..${input.boundary_cursor - 1}; sequence ${seq} is missing.`,
          ),
        };
      }
    }

    const redaction = sanitizePayload(input.state, { policy });
    const stateData = redaction.value as Record<string, unknown>;
    const stateHash = hashPayload(stateData);
    const reasons = redaction.redacted
      ? [`STATE_REDACTED: ${redaction.fields_redacted.length || 1} value(s) were removed from the snapshot; the stored state is not the host's exact state.`]
      : [];

    const stepEventId = checkpointStepEventId(runId, input.checkpoint_id);
    const snapshotId = `state_${runId}_${input.checkpoint_id}`;
    const now = new Date().toISOString();
    const checkpoint: CheckpointReference = {
      checkpoint_id: input.checkpoint_id,
      run_id: runId,
      step_id: stepEventId,
      position: input.position,
      state_snapshot_id: snapshotId,
      boundary_cursor: input.boundary_cursor,
      resume_step_index: input.resume_step_index,
      resume_step_id: input.resume_step_id,
      created_at: now,
      schema_version: "1.1.0",
      state_hash: stateHash,
      restorable: reasons.length === 0,
      capture_kind: "REGISTERED",
      host_step_id: input.step_id,
      host_step_index: input.step_index,
      resume_adapter: input.adapter,
      restorability_reasons: reasons.length > 0 ? reasons : undefined,
      metadata: input.metadata ? sanitizeCanonicalRecord(input.metadata, policy) : undefined,
    };

    const existing = base.checkpoints.find((c) => c.checkpoint_id === input.checkpoint_id);
    if (existing) {
      return {
        value: registrationFingerprint(existing) === registrationFingerprint({ ...checkpoint, created_at: existing.created_at })
          ? { status: "DUPLICATE" as const, checkpoint: existing, assessment: assessCheckpoint(base, existing) }
          : reject("CHECKPOINT_ID_CONFLICT", `Checkpoint "${input.checkpoint_id}" already exists with different content.`),
      };
    }

    // The checkpoint step must exist in the event-derived trajectory so it
    // survives run completion; record it as a trace event first.
    const stepEvent: TraceEvent = {
      event_id: stepEventId,
      run_id: runId,
      workflow_id: legacyRun.runRecord.workflow_id,
      event_type: "node_completed",
      status: "completed",
      node_id: input.step_id,
      timestamp: now,
      metadata: { checkpoint_id: input.checkpoint_id, checkpoint_registered: true },
    };
    const appended = await getRunStore().appendTraceEvent(runId, stepEvent);
    if (appended.warning) return { value: reject("PERSISTENCE_FAILED", appended.warning) };
    const refreshedLegacy = (await getRunStore().getRun(runId)) ?? legacyRun;

    const artifact: RunArtifact = refreshCanonicalFromLegacy(current, refreshedLegacy);
    const snapshot: StateSnapshot = {
      snapshot_id: snapshotId,
      step_id: stepEventId,
      snapshot_type: "STEP_CHECKPOINT",
      timestamp: now,
      state_scope: "workflow",
      state_data: stateData,
      captured: true,
      hash: stateHash,
    };
    artifact.state = [...artifact.state.filter((s) => s.snapshot_id !== snapshotId), snapshot];
    artifact.checkpoints = [...artifact.checkpoints, checkpoint];

    const assessment = assessCheckpoint(artifact, checkpoint);
    return {
      artifact,
      value: {
        status: reasons.length === 0 && assessment.state_valid ? "REGISTERED" : "REGISTERED_NOT_RESTORABLE",
        checkpoint,
        assessment,
      },
    };
  });
}

export async function observeCheckpoint(
  runId: string,
  rawInput: unknown,
  legacyRun: SavedRun,
): Promise<CheckpointRegistrationResult> {
  const parsed = observeCheckpointInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return reject("INVALID_CHECKPOINT_OBSERVATION", parsed.error.issues.map((i) => i.message).join("; "));
  }
  const input = parsed.data;
  return mutateCanonicalRun<CheckpointRegistrationResult>(runId, async (current) => {
    const policy = capturePolicyForRun(current);
    const artifact = refreshCanonicalFromLegacy(current, legacyRun);
    const observation: CheckpointObservation = {
      observation_id: `obs_${runId}_${input.checkpoint_id}`,
      checkpoint_id: input.checkpoint_id,
      run_id: runId,
      step_id: input.step_id,
      node_id: input.node_id,
      observed_at: new Date().toISOString(),
      reported_state_hash: input.state === undefined ? undefined : sanitizePayload(input.state, { policy }).persisted_hash,
      source: "SDK_OBSERVATION",
      restorable: false,
      metadata: input.metadata && policy.contentMode !== "STRUCTURE_ONLY" ? sanitizeCanonicalRecord(input.metadata, policy) : undefined,
    };
    const outcome = storeObservation(artifact, observation);
    if (outcome.status !== "OBSERVATION_RECORDED") {
      return { value: { status: outcome.status as CheckpointRegistrationStatus, code: outcome.code, message: outcome.message } };
    }
    return { artifact, value: { status: "OBSERVATION_RECORDED", observation } };
  });
}
