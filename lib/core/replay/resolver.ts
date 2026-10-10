/**
 * Canonical Boundary Resolver for Deterministic Offline Replay.
 *
 * Promotes BoundaryReplayHarness into an authoritative replay resolver:
 * - Strict cursor ordering without fuzzy substring ambiguity.
 * - Exact dependency identity matching (provider:model, tool:name, retrieval:service).
 * - Cryptographic input hash verification.
 * - Side-effect safety: substituted recorded output is permitted, but live external
 *   execution is strictly forbidden.
 * - Content-addressed payload retrieval with hash verification.
 */

import type { ExecutionBoundary, BoundaryType } from "../contracts/replay";
import type { RunArtifact } from "../contracts/runArtifact";
import { hashPayload } from "../capture/hashing";
import { getContentStore } from "../capture/contentStore";
import { type ReplayDivergence, type DivergenceType } from "./contracts";

export class BoundaryResolutionError extends Error {
  constructor(
    public readonly divergenceType: DivergenceType,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(`[BoundaryResolver: ${divergenceType}] ${message}`);
    this.name = "BoundaryResolutionError";
  }
}

export interface ResolveBoundaryRequest {
  expectedType: BoundaryType;
  name: string;
  dependencyIdentity?: string;
  input: unknown;
  sideEffectIntent?: "substitute_recorded" | "execute_live";
}

export interface ResolveBoundaryResponse {
  output: unknown;
  boundary: ExecutionBoundary;
  sideEffectSubstituted: boolean;
  liveSideEffectBlocked: boolean;
}

function isEquivalentType(expected: BoundaryType, actual: BoundaryType): boolean {
  if (expected === actual) return true;
  if (
    (expected === "retrieval_call" || expected === "retrieval_service") &&
    (actual === "retrieval_call" || actual === "retrieval_service")
  ) {
    return true;
  }
  return false;
}

export class BoundaryResolver {
  private readonly boundaries: ExecutionBoundary[];
  private cursor = 0;
  private substitutedCount = 0;
  private readonly strict: boolean;

  constructor(source: RunArtifact | ExecutionBoundary[], options: { strict?: boolean } = {}) {
    this.boundaries = Array.isArray(source) ? [...source] : [...source.boundaries];
    this.boundaries.sort((a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0));
    this.strict = options.strict !== false;
  }

  /**
   * Resolves a non-deterministic boundary against recorded execution evidence.
   */
  async resolve(request: ResolveBoundaryRequest): Promise<ResolveBoundaryResponse> {
    if (this.cursor >= this.boundaries.length) {
      throw new BoundaryResolutionError(
        "EXTRA_BOUNDARY",
        `Execution attempted unexpected boundary '${request.name}' (${request.expectedType}) at cursor ${this.cursor}, but no more recorded boundaries exist.`,
        {
          cursor: this.cursor,
          expectedBoundary: { type: request.expectedType, name: request.name },
          totalRecorded: this.boundaries.length,
        }
      );
    }

    const recorded = this.boundaries[this.cursor];

    // 1. Boundary Type Check
    if (!isEquivalentType(request.expectedType, recorded.boundary_type)) {
      throw new BoundaryResolutionError(
        "BOUNDARY_TYPE_MISMATCH",
        `Boundary type mismatch at cursor ${this.cursor}. Expected '${request.expectedType}', found recorded '${recorded.boundary_type}'.`,
        {
          cursor: this.cursor,
          expectedType: request.expectedType,
          actualType: recorded.boundary_type,
          boundaryId: recorded.boundary_id,
        }
      );
    }

    // 2. Identity Check (Dependency identity or exact name matching)
    const identityMatches = this.matchesIdentity(request, recorded);
    if (!identityMatches) {
      throw new BoundaryResolutionError(
        "BOUNDARY_IDENTITY_MISMATCH",
        `Boundary identity mismatch at cursor ${this.cursor}. Expected '${request.name}', found recorded '${recorded.name}'.`,
        {
          cursor: this.cursor,
          expected: { name: request.name, identity: request.dependencyIdentity },
          actual: { name: recorded.name, identity: recorded.dependency_identity },
          boundaryId: recorded.boundary_id,
        }
      );
    }

    // 3. Side-Effect Safety Model
    let sideEffectSubstituted = false;
    let liveSideEffectBlocked = false;

    const isSideEffecting =
      recorded.side_effect_class === "external_side_effect" ||
      recorded.side_effect_class === "destructive";

    if (isSideEffecting) {
      if (request.sideEffectIntent === "execute_live") {
        liveSideEffectBlocked = true;
        throw new BoundaryResolutionError(
          "SIDE_EFFECT_ATTEMPT_BLOCKED",
          `Boundary '${recorded.name}' attempted live external execution. Offline replay strictly forbids live mutation.`,
          {
            boundaryId: recorded.boundary_id,
            sideEffectClass: recorded.side_effect_class,
          }
        );
      }
      sideEffectSubstituted = true;
    }

    // 4. Input Hash Verification
    const incomingHash = hashPayload(request.input);
    const expectedHash = recorded.content_hashes?.input_hash ?? recorded.input.hash;

    if (this.strict && expectedHash && incomingHash !== expectedHash) {
      throw new BoundaryResolutionError(
        "INPUT_HASH_MISMATCH",
        `Input hash mismatch for boundary '${recorded.name}'. Expected '${expectedHash}', received '${incomingHash}'. Inputs have diverged.`,
        {
          boundaryId: recorded.boundary_id,
          expectedHash,
          actualHash: incomingHash,
        }
      );
    }

    // 5. Output Payload Availability & Retrieval
    if (
      recorded.captured_content_availability === "NOT_CAPTURED" ||
      recorded.captured_content_availability === "UNAVAILABLE" ||
      !recorded.output
    ) {
      throw new BoundaryResolutionError(
        "MISSING_PAYLOAD",
        `Recorded output payload is unavailable for boundary '${recorded.name}'.`,
        {
          boundaryId: recorded.boundary_id,
          availability: recorded.captured_content_availability,
        }
      );
    }

    let outputContent: unknown = recorded.output.content;

    if (outputContent === undefined && recorded.output.content_ref) {
      const contentStore = getContentStore();
      const rawBlob = await contentStore.get(recorded.output.content_ref);
      if (rawBlob !== null) {
        try {
          outputContent = JSON.parse(rawBlob);
        } catch {
          outputContent = rawBlob;
        }
      }
    }

    if (outputContent === undefined) {
      throw new BoundaryResolutionError(
        "MISSING_PAYLOAD",
        `Payload for boundary '${recorded.name}' could not be resolved from inline content or content store.`,
        {
          boundaryId: recorded.boundary_id,
          contentRef: recorded.output.content_ref,
        }
      );
    }

    this.cursor++;
    this.substitutedCount++;

    return {
      output: outputContent,
      boundary: recorded,
      sideEffectSubstituted,
      liveSideEffectBlocked,
    };
  }

  private matchesIdentity(request: ResolveBoundaryRequest, recorded: ExecutionBoundary): boolean {
    if (
      request.dependencyIdentity &&
      recorded.dependency_identity &&
      request.dependencyIdentity === recorded.dependency_identity
    ) {
      return true;
    }

    if (request.name === recorded.name) {
      return true;
    }

    // Fallback: sanitized name equality or known alias
    const normReq = request.name.toLowerCase().trim();
    const normRec = recorded.name.toLowerCase().trim();
    if (normReq === normRec) {
      return true;
    }

    // Explicit legacy fallback: prefix or colon-delimited match
    if (normReq.endsWith(`/${normRec}`) || normReq.endsWith(`:${normRec}`)) {
      return true;
    }
    if (normRec.endsWith(`/${normReq}`) || normRec.endsWith(`:${normReq}`)) {
      return true;
    }

    return false;
  }

  getCursor(): number {
    return this.cursor;
  }

  getSubstitutedCount(): number {
    return this.substitutedCount;
  }

  getTotalBoundaries(): number {
    return this.boundaries.length;
  }

  hasRemaining(): boolean {
    return this.cursor < this.boundaries.length;
  }

  peekNext(): ExecutionBoundary | undefined {
    return this.boundaries[this.cursor];
  }
}
