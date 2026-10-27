/**
 * Per-run capture policy and canonical/legacy synchronization for HTTP ingestion.
 *
 * External agents choose a content mode when they start a run. The mode is
 * stored on the canonical artifact and applied to every later boundary,
 * checkpoint, observation and trace event for that run.
 */

import type { RunArtifact } from "../contracts/runArtifact";
import type { TraceEvent } from "../../proof-layer/schemas";
import type { SavedRun } from "../../runs/runTypes";
import { adaptLegacyRunToRunArtifact } from "../adapters/legacyRunAdapter";
import { DEFAULT_CAPTURE_POLICY, resolvePolicy } from "./policy";
import { sanitizeCanonicalRecord, sanitizePayload } from "./redaction";
import type { CapturePolicy, ContentCaptureMode } from "./types";

const CONTENT_MODES: readonly ContentCaptureMode[] = ["STRUCTURE_ONLY", "SAFE_CONTENT", "FULL_CONTENT"];

export function parseContentMode(value: unknown): ContentCaptureMode | undefined {
  return typeof value === "string" && (CONTENT_MODES as readonly string[]).includes(value)
    ? (value as ContentCaptureMode)
    : undefined;
}

export function runContentMode(artifact: RunArtifact | null | undefined): ContentCaptureMode {
  const policy = artifact?.provenance.metadata?.["capture_policy"] as { content_mode?: unknown } | undefined;
  return parseContentMode(policy?.content_mode) ?? DEFAULT_CAPTURE_POLICY.contentMode;
}

/** The capture policy that applies to new evidence for this run. Redaction is always on. */
export function capturePolicyForRun(artifact: RunArtifact | null | undefined): CapturePolicy {
  const policy = resolvePolicy({ contentMode: runContentMode(artifact) });
  return { ...policy, redaction: { ...policy.redaction, enabled: true } };
}

const STRUCTURE_ONLY_EVENT_METADATA = new Set([
  "eval_id", "eval_name", "eval_type", "passed", "score", "severity",
  "model", "provider", "input_tokens", "output_tokens",
  "tool_name", "permission_class", "artifact_type", "checkpoint_id",
  "agent_id", "agent_role", "visibility",
]);

/** Applies the run's content mode to a trace event before it is stored. */
export function applyPolicyToTraceEvent(event: TraceEvent, policy: CapturePolicy): TraceEvent {
  const safe = sanitizeCanonicalRecord(event, policy);
  if (policy.contentMode !== "STRUCTURE_ONLY") return safe;
  const metadata = safe.metadata
    ? Object.fromEntries(
        Object.entries(safe.metadata).filter(
          ([key, value]) => STRUCTURE_ONLY_EVENT_METADATA.has(key) && (value === null || typeof value !== "object"),
        ),
      )
    : undefined;
  return {
    ...safe,
    input_summary: undefined,
    output_summary: undefined,
    metadata,
  };
}

/**
 * Rebuilds the legacy-derived view (trajectory, tools, evals, execution) of a
 * canonical run from the latest SavedRun while preserving canonical-only
 * evidence: boundaries, state, checkpoints, observations, lineage, capture
 * provenance, configuration and outcome evidence.
 */
export function refreshCanonicalFromLegacy(existing: RunArtifact | null, legacy: SavedRun): RunArtifact {
  const adapted = adaptLegacyRunToRunArtifact(legacy);
  if (!existing) return adapted;
  return {
    ...adapted,
    environment: existing.provenance.capture_method === "legacy_adaptation" ? adapted.environment : existing.environment,
    boundaries: existing.boundaries,
    state: existing.state,
    checkpoints: existing.checkpoints,
    checkpoint_observations: existing.checkpoint_observations ?? [],
    context: existing.context.length > 0 ? existing.context : adapted.context,
    lineage: existing.lineage,
    provenance: existing.provenance.capture_method === "legacy_adaptation" ? adapted.provenance : existing.provenance,
    configuration_snapshot: existing.configuration_snapshot ?? adapted.configuration_snapshot,
    evidence: existing.evidence ?? adapted.evidence,
    observability: {
      ...adapted.observability,
      model_calls_count: Math.max(
        adapted.observability.model_calls_count,
        existing.boundaries.filter((b) => b.boundary_type === "model_call").length,
      ),
      tool_calls_count: Math.max(
        adapted.observability.tool_calls_count,
        existing.boundaries.filter((b) => b.boundary_type === "tool_call").length,
      ),
    },
  };
}

export interface FinalizeRunInput {
  status: "completed" | "failed";
  completedAt: string;
  durationMs?: number;
  costUsd?: number;
  /** Final agent output; stored as outcome evidence under the run's content mode. */
  output?: unknown;
  errorMessage?: string;
}

/**
 * Applies run completion/failure to the canonical artifact while preserving
 * canonical-only evidence. Raw checkpoint or state arrays sent at completion
 * are not accepted here; restorable checkpoints must be registered while the
 * run executes.
 */
export function finalizeCanonicalArtifact(
  existing: RunArtifact | null,
  legacy: SavedRun,
  input: FinalizeRunInput,
): RunArtifact {
  const policy = capturePolicyForRun(existing);
  const artifact = refreshCanonicalFromLegacy(existing, legacy);
  artifact.execution.status = input.status;
  artifact.execution.completed_at = input.completedAt;
  if (input.durationMs !== undefined) artifact.execution.duration_ms = input.durationMs;
  if (input.costUsd !== undefined) artifact.observability.total_cost_usd = input.costUsd;
  if (input.errorMessage !== undefined) {
    const message = policy.contentMode === "STRUCTURE_ONLY" ? "[CONTENT_OMITTED]" : sanitizeCanonicalRecord(input.errorMessage, policy);
    artifact.execution.exit_reason = message;
    artifact.execution.error = { message };
  }
  const evidence = artifact.evidence ?? {
    verification_events: [], test_results: [], review_results: [], approval_events: [], security_events: [],
  };
  artifact.evidence = {
    ...evidence,
    final_outcome: {
      status: input.status === "completed" ? "SUCCESS" : "FAILURE",
      verification_status: "NOT_RUN",
      completed_at: input.completedAt,
      payload: input.output === undefined || policy.contentMode === "STRUCTURE_ONLY"
        ? undefined
        : sanitizePayload(input.output, { policy }).value,
    },
  };
  return artifact;
}
