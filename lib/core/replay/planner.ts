/**
 * Deterministic Replay Planner.
 *
 * Pre-execution analysis of a RunArtifact to verify replay feasibility,
 * blob integrity, boundary sequences, state readiness, and safety constraints
 * BEFORE runtime execution begins.
 */

import type { RunArtifact } from "../contracts/runArtifact";
import { getContentStore } from "../capture/contentStore";
import { validateExecutionIntegrity } from "../capture/integrity";
import {
  type ReplayPlan,
  type ReplayMode,
  type ReplayabilityVerdict,
  type ExpectedStep,
  type ExpectedBoundary,
} from "./contracts";

export interface BuildReplayPlanOptions {
  mode?: ReplayMode;
  replayId?: string;
  verifyBlobs?: boolean;
}

const SUPPORTED_OFFLINE_BOUNDARIES = new Set([
  "model_call",
  "tool_call",
  "retrieval_call",
  "retrieval_service",
  "external_http",
  "memory_read",
  "memory_write",
  "memory_service",
  "clock",
  "randomness",
]);

/**
 * Builds a deterministic ReplayPlan from a source RunArtifact.
 * Fails fast before execution if the artifact is missing required evidence.
 */
export async function buildReplayPlan(
  source: RunArtifact,
  options: BuildReplayPlanOptions = {}
): Promise<ReplayPlan> {
  const mode: ReplayMode = options.mode ?? "STRICT_OFFLINE";
  const replayId = options.replayId ?? `replay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const verifyBlobs = options.verifyBlobs !== false;
  const contentStore = getContentStore();

  const unsupportedFeatures: string[] = [];
  const missingEvidence: string[] = [];

  // 1. Schema compatibility check
  if (!source.schema_version?.startsWith("1.")) {
    unsupportedFeatures.push(`Unsupported schema version: '${source.schema_version}'. Only 1.x is supported.`);
  }

  // 2. Trajectory & Boundary sequence integrity
  const integrityReport = validateExecutionIntegrity(source);
  if (!integrityReport.valid) {
    for (const err of integrityReport.errors) {
      missingEvidence.push(`Integrity: ${err}`);
    }
  }

  // 3. Inspect expected steps
  const expectedSteps: ExpectedStep[] = (source.trajectory ?? []).map((s) => ({
    step_id: s.step_id,
    step_index: s.step_index,
    name: s.name,
    step_type: s.step_type,
    boundary_ids: [...(s.boundary_ids ?? [])],
    state_snapshot_id: s.state_snapshot_id,
  }));

  // 4. Inspect expected boundaries & payload availability
  const expectedBoundaries: ExpectedBoundary[] = [];
  const boundaries = source.boundaries ?? [];

  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];

    // Check supported boundary type
    if (!SUPPORTED_OFFLINE_BOUNDARIES.has(b.boundary_type)) {
      unsupportedFeatures.push(`Unsupported boundary type '${b.boundary_type}' on boundary '${b.name}'`);
    }

    // Check replayability classification
    if (b.replayability === "NON_REPLAYABLE" || b.replayability === "LIVE_REQUIRED") {
      unsupportedFeatures.push(
        `Boundary '${b.name}' classified as '${b.replayability}' cannot be replayed offline.`
      );
    }

    // Check output payload presence
    if (!b.output) {
      missingEvidence.push(`Boundary '${b.name}' (sequence ${b.sequence_index ?? i}) has no recorded output.`);
    } else {
      // Check content availability
      if (
        b.captured_content_availability === "NOT_CAPTURED" ||
        b.captured_content_availability === "UNAVAILABLE"
      ) {
        missingEvidence.push(
          `Boundary '${b.name}' output marked as '${b.captured_content_availability}'.`
        );
      }

      // Check external blob existence if content_ref is specified
      if (b.output.content_ref && verifyBlobs) {
        const hasBlob = await contentStore.has(b.output.content_ref);
        if (!hasBlob) {
          missingEvidence.push(
            `Blob for boundary '${b.name}' (ref: ${b.output.content_ref}) not found in content store.`
          );
        }
      }
    }

    expectedBoundaries.push({
      boundary_id: b.boundary_id,
      sequence_index: b.sequence_index ?? i,
      boundary_type: b.boundary_type,
      name: b.name,
      dependency_identity: b.dependency_identity,
      step_id: b.step_id,
      input_hash: b.content_hashes?.input_hash ?? b.input.hash,
      output_hash: b.content_hashes?.output_hash ?? b.output?.hash,
      replayability: b.replayability,
      side_effect_class: b.side_effect_class,
      content_availability: b.captured_content_availability,
    });
  }

  // 5. Checkpoint & State Availability
  const checkpoint = source.lineage?.checkpoint_reference ?? null;
  const hasInitialState = (source.state ?? []).length > 0;

  // 6. Compute Verdict
  let replayabilityVerdict: ReplayabilityVerdict = "REPLAYABLE";

  if (missingEvidence.length > 0 || unsupportedFeatures.length > 0) {
    if (
      missingEvidence.some((e) => e.includes("not found in content store") || e.includes("no recorded output") || e.includes("Integrity:")) ||
      unsupportedFeatures.some((u) => u.includes("cannot be replayed offline") || u.includes("Unsupported schema"))
    ) {
      replayabilityVerdict = "NOT_REPLAYABLE";
    } else {
      replayabilityVerdict = "PARTIALLY_REPLAYABLE";
    }
  }

  return {
    replay_id: replayId,
    source_run_id: source.identity.run_id,
    source_schema_version: source.schema_version,
    mode,
    expected_steps: expectedSteps,
    expected_boundaries: expectedBoundaries,
    checkpoint,
    boundary_policy: {
      strict_sequence: true,
      verify_input_hash: true,
      deny_live_network: mode === "STRICT_OFFLINE",
    },
    state_policy: {
      has_initial_state: hasInitialState,
      checkpoint_attached: Boolean(checkpoint),
    },
    environment_requirements: {
      runtime: source.environment?.runtime ?? "node",
      sdk_version: source.environment?.sdk_version,
    },
    unsupported_features: unsupportedFeatures,
    missing_evidence: missingEvidence,
    replayability_verdict: replayabilityVerdict,
    created_at: new Date().toISOString(),
  };
}
