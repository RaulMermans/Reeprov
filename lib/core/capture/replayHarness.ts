/**
 * Deterministic Boundary Substitution Harness.
 *
 * Implements the offline boundary substitution engine that serves recorded
 * outputs for supported non-deterministic boundaries (models, tools, retrieval, HTTP)
 * without making live external network or model calls.
 *
 * Invariant: Never silently fall back to live execution. Strict mode refuses
 * incompatible input hashes, wrong boundary ordering, or missing payloads.
 */

import type { ExecutionBoundary, BoundaryType } from "../contracts/replay";
import type { RunArtifact } from "../contracts/runArtifact";
import { hashPayload } from "./hashing";
import { getContentStore } from "./contentStore";

export type ReplayErrorCode =
  | "MISSING_RECORDED_BOUNDARY"
  | "WRONG_BOUNDARY_ORDER"
  | "INPUT_HASH_MISMATCH"
  | "UNAVAILABLE_PAYLOAD"
  | "SIDE_EFFECT_GATED"
  | "NON_REPLAYABLE_BOUNDARY"
  | "UNSUPPORTED_BOUNDARY_TYPE";

export class ReplayMismatchError extends Error {
  constructor(
    public readonly code: ReplayErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(`[BoundaryReplay: ${code}] ${message}`);
    this.name = "ReplayMismatchError";
  }
}

export interface ReplayHarnessOptions {
  strict?: boolean;
  verifyOrder?: boolean;
  allowSideEffects?: boolean;
}

export class BoundaryReplayHarness {
  private readonly boundaries: ExecutionBoundary[];
  private currentIndex = 0;
  private substitutedCount = 0;
  private readonly strict: boolean;
  private readonly verifyOrder: boolean;
  private readonly allowSideEffects: boolean;

  constructor(
    source: RunArtifact | ExecutionBoundary[],
    options: ReplayHarnessOptions = {}
  ) {
    this.boundaries = Array.isArray(source) ? [...source] : [...source.boundaries];
    // Sort boundaries by sequence_index if present
    this.boundaries.sort((a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0));

    this.strict = options.strict !== false; // default true
    this.verifyOrder = options.verifyOrder !== false; // default true
    this.allowSideEffects = options.allowSideEffects === true; // default false
  }

  /**
   * Core substitution: finds the recorded boundary, verifies identity & input hash,
   * checks side-effect safety, and returns the recorded output.
   */
  async substituteBoundary(params: {
    expectedType: BoundaryType;
    name: string;
    input: unknown;
  }): Promise<{ output: unknown; boundary: ExecutionBoundary }> {
    let targetBoundary: ExecutionBoundary | undefined;

    if (this.verifyOrder) {
      if (this.currentIndex >= this.boundaries.length) {
        throw new ReplayMismatchError(
          "MISSING_RECORDED_BOUNDARY",
          `Expected ${params.expectedType} (${params.name}) at sequence index ${this.currentIndex}, but no more boundaries exist.`,
          { expectedIndex: this.currentIndex, totalBoundies: this.boundaries.length }
        );
      }

      targetBoundary = this.boundaries[this.currentIndex];

      if (
        targetBoundary.boundary_type !== params.expectedType ||
        (!targetBoundary.name.includes(params.name) && !params.name.includes(targetBoundary.name))
      ) {
        throw new ReplayMismatchError(
          "WRONG_BOUNDARY_ORDER",
          `Boundary order mismatch at sequence ${this.currentIndex}. Expected ${params.expectedType} '${params.name}', found recorded ${targetBoundary.boundary_type} '${targetBoundary.name}'.`,
          {
            expectedIndex: this.currentIndex,
            expected: { type: params.expectedType, name: params.name },
            actual: { type: targetBoundary.boundary_type, name: targetBoundary.name },
          }
        );
      }
    } else {
      // Lookup by name and type
      targetBoundary = this.boundaries.find(
        (b) =>
          b.boundary_type === params.expectedType &&
          (b.name.includes(params.name) || params.name.includes(b.name))
      );

      if (!targetBoundary) {
        throw new ReplayMismatchError(
          "MISSING_RECORDED_BOUNDARY",
          `No recorded boundary found matching ${params.expectedType} '${params.name}'.`
        );
      }
    }

    // 1. Safety check: side-effect gates
    if (
      !this.allowSideEffects &&
      (targetBoundary.side_effect_class === "external_side_effect" ||
        targetBoundary.side_effect_class === "destructive")
    ) {
      throw new ReplayMismatchError(
        "SIDE_EFFECT_GATED",
        `Boundary '${targetBoundary.name}' is classified as '${targetBoundary.side_effect_class}' and cannot be safely replayed without explicit side-effect authorization.`,
        { boundaryId: targetBoundary.boundary_id, sideEffectClass: targetBoundary.side_effect_class }
      );
    }

    // 2. Payload availability check
    if (
      targetBoundary.captured_content_availability === "not_captured" ||
      targetBoundary.captured_content_availability === "NOT_CAPTURED" ||
      targetBoundary.captured_content_availability === "UNAVAILABLE" ||
      !targetBoundary.output
    ) {
      throw new ReplayMismatchError(
        "UNAVAILABLE_PAYLOAD",
        `Recorded output payload is unavailable for boundary '${targetBoundary.name}'.`,
        { boundaryId: targetBoundary.boundary_id, availability: targetBoundary.captured_content_availability }
      );
    }

    // 3. Replayability check
    if (
      targetBoundary.replayability === "NON_REPLAYABLE" ||
      targetBoundary.replayability === "LIVE_REQUIRED"
    ) {
      throw new ReplayMismatchError(
        "NON_REPLAYABLE_BOUNDARY",
        `Boundary '${targetBoundary.name}' was marked as '${targetBoundary.replayability}' and cannot be substituted.`,
        { boundaryId: targetBoundary.boundary_id, replayability: targetBoundary.replayability }
      );
    }

    // 4. Strict input hash check
    if (this.strict) {
      const incomingHash = hashPayload(params.input);
      const expectedHash =
        targetBoundary.content_hashes?.input_hash ?? targetBoundary.input.hash;

      if (expectedHash && incomingHash !== expectedHash) {
        throw new ReplayMismatchError(
          "INPUT_HASH_MISMATCH",
          `Input hash mismatch for boundary '${targetBoundary.name}'. Recorded hash ${expectedHash}, incoming hash ${incomingHash}. Execution inputs have diverged.`,
          {
            boundaryId: targetBoundary.boundary_id,
            expectedHash,
            actualHash: incomingHash,
          }
        );
      }
    }

    // 5. Retrieve output content (inline or from blob store)
    let outputContent: unknown = targetBoundary.output.content;

    if (outputContent === undefined && targetBoundary.output.content_ref) {
      const contentStore = getContentStore();
      const rawBlob = await contentStore.get(targetBoundary.output.content_ref);
      if (rawBlob !== null) {
        try {
          outputContent = JSON.parse(rawBlob);
        } catch {
          outputContent = rawBlob;
        }
      }
    }

    if (outputContent === undefined) {
      throw new ReplayMismatchError(
        "UNAVAILABLE_PAYLOAD",
        `Payload for boundary '${targetBoundary.name}' could not be resolved from inline content or blob store.`,
        { contentRef: targetBoundary.output.content_ref }
      );
    }

    if (this.verifyOrder) {
      this.currentIndex++;
    }

    this.substitutedCount++;
    return { output: outputContent, boundary: targetBoundary };
  }

  // ── Convenience Wrappers ──────────────────────────────────────────────────

  async substituteModel(
    name: string,
    input: unknown
  ): Promise<{ output: unknown; boundary: ExecutionBoundary }> {
    return this.substituteBoundary({ expectedType: "model_call", name, input });
  }

  async substituteTool(
    toolName: string,
    args: unknown
  ): Promise<{ output: unknown; boundary: ExecutionBoundary }> {
    return this.substituteBoundary({ expectedType: "tool_call", name: toolName, input: args });
  }

  async substituteRetrieval(
    serviceOrQuery: string,
    input: unknown
  ): Promise<{ output: unknown; boundary: ExecutionBoundary }> {
    return this.substituteBoundary({
      expectedType: "retrieval_service",
      name: serviceOrQuery,
      input,
    });
  }

  async substituteHttp(
    urlOrHost: string,
    input: unknown
  ): Promise<{ output: unknown; boundary: ExecutionBoundary }> {
    return this.substituteBoundary({
      expectedType: "external_http",
      name: urlOrHost,
      input,
    });
  }

  /**
   * Verifies whether all recorded boundaries in the trajectory were substituted.
   */
  verifyCompleteReplay(): {
    complete: boolean;
    totalRecorded: number;
    substitutedCount: number;
    remainingBoundaries: number;
  } {
    const remaining = this.boundaries.length - this.currentIndex;
    return {
      complete: remaining === 0,
      totalRecorded: this.boundaries.length,
      substitutedCount: this.substitutedCount,
      remainingBoundaries: remaining,
    };
  }

  getSubstitutedCount(): number {
    return this.substitutedCount;
  }
}
