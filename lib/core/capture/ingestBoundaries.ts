/**
 * Authoritative boundary ingestion contract (shared by HTTP ingest and tests).
 *
 * Per record, exactly one outcome:
 * - ACCEPTED: a new boundary was stored at `sequence_index`.
 * - DUPLICATE: the same `boundary_id` with identical content already exists
 *   (an idempotent retry); nothing changed.
 * - OBSERVATION_RECORDED: a legacy `checkpoint` boundary was stored as a
 *   non-restorable checkpoint observation, never as an execution boundary.
 * - REJECTED: nothing was stored; `code` says why.
 *
 * All records for one run are applied under that run's write lock in a
 * single read-modify-write, so concurrent requests cannot lose boundaries.
 */

import type { ExecutionBoundary } from "../contracts/replay";
import type { CheckpointObservation } from "../contracts/lineage";
import type { RunArtifact } from "../contracts/runArtifact";
import type { RawBoundaryInput } from "./types";
import { captureBoundary } from "./captureBoundary";
import { hashPayload } from "./hashing";
import { sanitizePayload, sanitizeCanonicalRecord } from "./redaction";
import { mutateCanonicalRun } from "./persistence";
import { capturePolicyForRun, refreshCanonicalFromLegacy } from "./runPolicy";
import type { SavedRun } from "../../runs/runTypes";

export type BoundaryIngestStatus = "ACCEPTED" | "DUPLICATE" | "OBSERVATION_RECORDED" | "REJECTED";

export interface BoundaryIngestResult {
  index: number;
  run_id?: string;
  boundary_id?: string;
  sequence_index?: number;
  status: BoundaryIngestStatus;
  code?: string;
  message?: string;
  warnings?: string[];
}

export interface BoundaryIngestSummary {
  ok: boolean;
  accepted: number;
  duplicates: number;
  observations: number;
  rejected: number;
  results: BoundaryIngestResult[];
  /** Kept for clients that only read `errors`. */
  errors: Array<{ boundary_id?: string; message: string }>;
}

export const UNKEYED_BOUNDARY_WARNING =
  "UNKEYED_BOUNDARY: record has no client boundary_id, so a transport retry cannot be de-duplicated. Upgrade the SDK.";

/** Content identity of a stored boundary, ignoring capture timestamps. */
export function boundaryFingerprint(boundary: ExecutionBoundary): string {
  const { timestamp: _t, started_at: _s, completed_at: _c, ...rest } = boundary;
  return hashPayload(rest);
}

function observationFingerprint(observation: CheckpointObservation): string {
  const { observed_at: _o, ...rest } = observation;
  return hashPayload(rest);
}

function rawField(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (raw[key] !== undefined) return raw[key];
  return undefined;
}

function isCheckpointRecord(raw: Record<string, unknown>): boolean {
  const type = rawField(raw, "boundaryType", "boundary_type", "type", "kind");
  return typeof type === "string" && type.toLowerCase().trim() === "checkpoint";
}

export interface IngestRunContext {
  legacyRun: SavedRun;
}

/**
 * Applies one run's records. `records` keep their original batch index.
 */
export async function ingestBoundariesForRun(
  runId: string,
  records: Array<{ index: number; raw: Record<string, unknown> }>,
  context: IngestRunContext,
): Promise<BoundaryIngestResult[]> {
  return mutateCanonicalRun(runId, async (current) => {
    const artifact: RunArtifact = refreshCanonicalFromLegacy(current, context.legacyRun);
    const policy = capturePolicyForRun(current);
    const results: BoundaryIngestResult[] = [];
    let changed = false;

    for (const { index, raw } of records) {
      if (isCheckpointRecord(raw)) {
        const outcome = recordLegacyCheckpointObservation(artifact, runId, raw, policy);
        if (outcome.status === "OBSERVATION_RECORDED") changed = true;
        results.push({ index, run_id: runId, ...outcome });
        continue;
      }

      const clientId = rawField(raw, "boundaryId", "boundary_id");
      const clientSeq = rawField(raw, "sequenceIndex", "sequence_index");
      if (clientId !== undefined && (typeof clientId !== "string" || clientId.length === 0)) {
        results.push({ index, run_id: runId, status: "REJECTED", code: "INVALID_BOUNDARY_ID", message: "boundary_id must be a non-empty string." });
        continue;
      }
      if (clientSeq !== undefined && (!Number.isInteger(clientSeq) || (clientSeq as number) < 0)) {
        results.push({ index, run_id: runId, status: "REJECTED", code: "INVALID_SEQUENCE", message: "sequence_index must be a non-negative integer." });
        continue;
      }

      const nextSequence = artifact.boundaries.reduce((n, b) => Math.max(n, (b.sequence_index ?? 0) + 1), 0);
      let boundary: ExecutionBoundary;
      try {
        boundary = await captureBoundary(
          {
            ...(raw as unknown as RawBoundaryInput),
            runId,
            sequenceIndex: (clientSeq as number | undefined) ?? nextSequence,
          },
          policy,
        );
      } catch (err) {
        results.push({
          index, run_id: runId, status: "REJECTED", code: "INVALID_BOUNDARY",
          message: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      const byId = artifact.boundaries.find((b) => b.boundary_id === boundary.boundary_id);
      if (byId) {
        if (boundaryFingerprint(byId) === boundaryFingerprint(boundary)) {
          results.push({ index, run_id: runId, boundary_id: byId.boundary_id, sequence_index: byId.sequence_index, status: "DUPLICATE" });
        } else {
          results.push({
            index, run_id: runId, boundary_id: boundary.boundary_id, status: "REJECTED", code: "BOUNDARY_ID_CONFLICT",
            message: `Boundary "${boundary.boundary_id}" already exists with different content; it was not overwritten.`,
          });
        }
        continue;
      }
      const bySequence = artifact.boundaries.find((b) => (b.sequence_index ?? 0) === boundary.sequence_index);
      if (bySequence) {
        results.push({
          index, run_id: runId, boundary_id: boundary.boundary_id, sequence_index: boundary.sequence_index,
          status: "REJECTED", code: "SEQUENCE_CONFLICT",
          message: `Sequence ${boundary.sequence_index} is already occupied by "${bySequence.boundary_id}".`,
        });
        continue;
      }

      artifact.boundaries.push(boundary);
      changed = true;
      results.push({
        index, run_id: runId, boundary_id: boundary.boundary_id, sequence_index: boundary.sequence_index, status: "ACCEPTED",
        warnings: clientId === undefined ? [UNKEYED_BOUNDARY_WARNING] : undefined,
      });
    }

    if (!changed) return { value: results };
    artifact.boundaries.sort((a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0));
    return { artifact, value: results };
  });
}

function recordLegacyCheckpointObservation(
  artifact: RunArtifact,
  runId: string,
  raw: Record<string, unknown>,
  policy: ReturnType<typeof capturePolicyForRun>,
): Omit<BoundaryIngestResult, "index" | "run_id"> {
  const metadata = (raw["metadata"] ?? {}) as Record<string, unknown>;
  const name = String(rawField(raw, "name") ?? "");
  const checkpointId = String(metadata["checkpoint_id"] ?? name.replace(/^checkpoint:/, "") ?? "").trim();
  if (!checkpointId) {
    return { status: "REJECTED", code: "INVALID_CHECKPOINT_OBSERVATION", message: "Checkpoint observation requires a checkpoint_id." };
  }
  const state = rawField(raw, "output", "state");
  const observation: CheckpointObservation = {
    observation_id: String(rawField(raw, "boundaryId", "boundary_id") ?? `obs_${runId}_${checkpointId}`),
    checkpoint_id: checkpointId,
    run_id: runId,
    step_id: rawField(raw, "stepId", "step_id") as string | undefined,
    node_id: rawField(raw, "nodeId", "node_id") as string | undefined,
    observed_at: String(rawField(raw, "startedAt", "started_at") ?? new Date().toISOString()),
    reported_state_hash: state === undefined ? undefined : sanitizePayload(state, { policy }).persisted_hash,
    source: "LEGACY_CHECKPOINT_BOUNDARY",
    restorable: false,
    metadata: policy.contentMode === "STRUCTURE_ONLY" ? undefined : sanitizeCanonicalRecord(metadata, policy),
  };
  return storeObservation(artifact, observation, {
    message: "Legacy checkpoint event stored as a non-restorable observation. Use registerCheckpoint() for a restorable checkpoint.",
  });
}

export function storeObservation(
  artifact: RunArtifact,
  observation: CheckpointObservation,
  extra: { message?: string } = {},
): Omit<BoundaryIngestResult, "index" | "run_id"> {
  const observations = (artifact.checkpoint_observations ??= []);
  const existing = observations.find((o) => o.observation_id === observation.observation_id);
  if (existing) {
    return observationFingerprint(existing) === observationFingerprint(observation)
      ? { boundary_id: existing.observation_id, status: "DUPLICATE" }
      : {
          boundary_id: observation.observation_id, status: "REJECTED", code: "OBSERVATION_ID_CONFLICT",
          message: `Observation "${observation.observation_id}" already exists with different content.`,
        };
  }
  observations.push(observation);
  return { boundary_id: observation.observation_id, status: "OBSERVATION_RECORDED", message: extra.message };
}

export function summarizeIngest(results: BoundaryIngestResult[]): BoundaryIngestSummary {
  const sorted = [...results].sort((a, b) => a.index - b.index);
  const count = (status: BoundaryIngestStatus) => sorted.filter((r) => r.status === status).length;
  const rejected = count("REJECTED");
  return {
    ok: rejected === 0,
    accepted: count("ACCEPTED"),
    duplicates: count("DUPLICATE"),
    observations: count("OBSERVATION_RECORDED"),
    rejected,
    results: sorted,
    errors: sorted
      .filter((r) => r.status === "REJECTED")
      .map((r) => ({ boundary_id: r.boundary_id, message: `${r.code ?? "REJECTED"}: ${r.message ?? ""}`.trim() })),
  };
}

/** 200 when every record succeeded, 207 for partial rejection, 422 when nothing succeeded. */
export function ingestHttpStatus(summary: { rejected: number; results: unknown[] }): number {
  if (summary.rejected === 0) return 200;
  return summary.rejected === summary.results.length ? 422 : 207;
}
