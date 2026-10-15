/**
 * Canonical Boundary Normalizer.
 *
 * Transforms raw integration boundary observations into fully validated,
 * canonical ExecutionBoundary records with content-addressing, secret redaction,
 * deterministic hashes, and replayability classification.
 */

import { executionBoundarySchema, type ExecutionBoundary, type BoundaryPayload, type CapturedContentAvailability } from "../contracts/replay";
import { canonicalJsonStringify, hashPayload } from "./hashing";
import { sanitizePayload } from "./redaction";
import { getContentStore } from "./contentStore";
import { resolvePolicy } from "./policy";
import { classifySideEffect } from "./sideEffectClassifier";
import { classifyReplayability } from "./replayabilityClassifier";
import { normalizeBoundaryType, deriveDependencyIdentity } from "./boundaryClassifier";
import type { RawBoundaryInput, CapturePolicy } from "./types";

/**
 * Normalizes a raw boundary input into a canonical ExecutionBoundary record.
 */
export async function normalizeBoundary(
  raw: RawBoundaryInput,
  policyOverrides?: Partial<CapturePolicy>
): Promise<ExecutionBoundary> {
  const policy = resolvePolicy(policyOverrides);
  const contentStore = getContentStore();

  const rawAny = raw as unknown as Record<string, unknown>;
  const rawType = (rawAny.boundaryType ?? rawAny.boundary_type ?? rawAny.type ?? rawAny.kind ?? "custom") as string;
  const boundaryType = normalizeBoundaryType(rawType);
  const boundaryName = (rawAny.name ?? rawAny.toolName ?? rawAny.tool_name ?? rawAny.model ?? rawAny.operation ?? rawAny.url ?? `${boundaryType}_op`) as string;
  const sequenceIndex = (rawAny.sequenceIndex ?? rawAny.sequence_index ?? raw.sequenceIndex ?? 0) as number;
  const boundaryId = (rawAny.boundaryId ?? rawAny.boundary_id ?? `bnd_${boundaryType}_${raw.runId || rawAny.run_id}_${sequenceIndex}`) as string;
  const timestamp = (rawAny.startedAt ?? rawAny.started_at ?? new Date().toISOString()) as string;

  // ── 1. Process Input Payload ──────────────────────────────────────────────
  const inputRedaction = sanitizePayload(raw.input, { policy });
  const inputSerialized = canonicalJsonStringify(inputRedaction.value);
  const inputSizeBytes = Buffer.byteLength(inputSerialized, "utf8");
  const inputHash = inputRedaction.persisted_hash;

  let inputContent: unknown = inputRedaction.value;
  let inputContentRef: string | undefined;
  let inputAvailability: CapturedContentAvailability = "CAPTURED";
  let inputTruncated = false;

  if (policy.contentMode === "STRUCTURE_ONLY") {
    inputContent = undefined;
    inputAvailability = "HASH_ONLY";
  } else if (inputSizeBytes > policy.maxPayloadBytes) {
    inputTruncated = true;
    inputAvailability = "TRUNCATED";
    inputContent = undefined;
  } else if (inputSizeBytes > policy.maxInlineBytes) {
    // Put into content-addressed blob store
    const putResult = await contentStore.put(inputSerialized, "application/json");
    inputContentRef = putResult.contentRef;
    inputContent = undefined; // bounded inline storage
    inputAvailability = "CAPTURED";
  }

  const inputPayload: BoundaryPayload = {
    captured: raw.input !== undefined,
    content: inputContent,
    summary: raw.inputSummary || (typeof raw.input === "string" ? raw.input.slice(0, 200) : undefined),
    hash: inputHash,
    redaction_status: inputRedaction.content_status,
    content_ref: inputContentRef,
    availability: inputAvailability,
    truncated: inputTruncated,
    raw_size_bytes: inputSizeBytes,
  };

  // ── 2. Process Output Payload ─────────────────────────────────────────────
  let outputPayload: BoundaryPayload | undefined;
  let outputCaptured = false;
  let outputHash: string | undefined;
  const outputFieldsRedacted: string[] = [];

  if (raw.output !== undefined) {
    outputCaptured = true;
    const outputRedaction = sanitizePayload(raw.output, { policy });
    outputRedaction.fields_redacted.forEach((f) => outputFieldsRedacted.push(f));

    const outputSerialized = canonicalJsonStringify(outputRedaction.value);
    const outputSizeBytes = Buffer.byteLength(outputSerialized, "utf8");
    outputHash = outputRedaction.persisted_hash;

    let outputContent: unknown = outputRedaction.value;
    let outputContentRef: string | undefined;
    let outputAvailability: CapturedContentAvailability = "CAPTURED";
    let outputTruncated = false;

    if (policy.contentMode === "STRUCTURE_ONLY") {
      outputContent = undefined;
      outputAvailability = "HASH_ONLY";
    } else if (outputSizeBytes > policy.maxPayloadBytes) {
      outputTruncated = true;
      outputAvailability = "TRUNCATED";
      outputContent = undefined;
    } else if (outputSizeBytes > policy.maxInlineBytes) {
      const putResult = await contentStore.put(outputSerialized, "application/json");
      outputContentRef = putResult.contentRef;
      outputContent = undefined;
      outputAvailability = "CAPTURED";
    }

    outputPayload = {
      captured: true,
      content: outputContent,
      summary: raw.outputSummary || (typeof raw.output === "string" ? raw.output.slice(0, 200) : undefined),
      hash: outputHash,
      redaction_status: outputRedaction.content_status,
      content_ref: outputContentRef,
      availability: outputAvailability,
      truncated: outputTruncated,
      raw_size_bytes: outputSizeBytes,
    };
  } else if (raw.error) {
    // Errored without explicit output
    outputPayload = {
      captured: false,
      summary: raw.error.message,
      redaction_status: "none",
      availability: "UNAVAILABLE",
    };
  }

  // ── 3. Classify Side-Effect & Replayability ────────────────────────────────
  const sideEffectClass = classifySideEffect(
    boundaryType,
    boundaryName,
    raw.declaredSideEffectClass
  );

  const overallContentAvailability: CapturedContentAvailability =
    policy.contentMode === "STRUCTURE_ONLY"
      ? "HASH_ONLY"
      : outputPayload
        ? outputPayload.availability ?? "CAPTURED"
        : "NOT_CAPTURED";

  const replayability = classifyReplayability({
    boundaryType,
    sideEffectClass,
    inputCaptured: true,
    outputCaptured,
    contentAvailability: overallContentAvailability,
    hasError: !!raw.error,
    declaredReplayability: raw.declaredReplayability,
  });

  // Redaction metadata
  const allFieldsRedacted = Array.from(
    new Set([...inputRedaction.fields_redacted, ...outputFieldsRedacted])
  );

  const overallRedactionStatus =
    allFieldsRedacted.length > 0 ? "partially_redacted" : "none";

  const dependencyIdentity =
    raw.dependencyIdentity || deriveDependencyIdentity(boundaryType, boundaryName);

  const boundaryRecord: ExecutionBoundary = {
    boundary_id: boundaryId,
    run_id: (rawAny.runId ?? rawAny.run_id ?? raw.runId) as string,
    step_id: (rawAny.stepId ?? rawAny.step_id) as string | undefined,
    node_id: (rawAny.nodeId ?? rawAny.node_id) as string | undefined,
    sequence_index: sequenceIndex,
    boundary_type: boundaryType,
    name: boundaryName,
    status: raw.status || (raw.error ? "failed" : "completed"),
    started_at: (rawAny.startedAt ?? rawAny.started_at ?? timestamp) as string,
    completed_at: (rawAny.completedAt ?? rawAny.completed_at) as string | undefined,
    duration_ms: (rawAny.durationMs ?? rawAny.duration_ms) as number | undefined,
    input: inputPayload,
    output: outputPayload,
    error: raw.error,
    replayability,
    side_effect_class: sideEffectClass,
    idempotency: {
      is_idempotent: !!raw.isIdempotent,
      idempotency_key: raw.idempotencyKey,
    },
    external_dependency: raw.dependencyIdentity,
    dependency_identity: dependencyIdentity,
    captured_content_availability: overallContentAvailability,
    redaction_status: overallRedactionStatus,
    redaction_metadata: {
      fields_redacted: allFieldsRedacted,
      strategy: "mask",
    },
    content_hashes: {
      input_hash: inputHash,
      output_hash: outputHash,
    },
    trace_correlation_id: raw.traceCorrelationId,
    linked_model_invocation_id: raw.linkedModelInvocationId,
    linked_tool_invocation_id: raw.linkedToolInvocationId,
    linked_retrieval_operation_id: raw.linkedRetrievalOperationId,
    linked_memory_operation_id: raw.linkedMemoryOperationId,
    timestamp,
    metadata: raw.metadata,
  };

  return executionBoundarySchema.parse(boundaryRecord);
}
