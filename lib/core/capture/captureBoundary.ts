/**
 * Canonical Boundary Capture Interceptor.
 *
 * Coordinates normalization, hashing, redaction, content-addressing, and telemetry
 * tracking for any raw boundary observation.
 */

import { normalizeBoundary } from "./normalizeBoundary";
import { globalCaptureMetrics } from "./metrics";
import type { RawBoundaryInput, CapturePolicy } from "./types";
import type { ExecutionBoundary } from "../contracts/replay";

/**
 * Captures an execution boundary, observes telemetry, and returns the canonical ExecutionBoundary record.
 */
export async function captureBoundary(
  raw: RawBoundaryInput,
  policy?: Partial<CapturePolicy>
): Promise<ExecutionBoundary> {
  try {
    const boundary = await normalizeBoundary(raw, policy);

    const inputBytes = boundary.input.raw_size_bytes ?? 0;
    const outputBytes = boundary.output?.raw_size_bytes ?? 0;
    const bytesIn = inputBytes + outputBytes;

    const didRedact =
      boundary.redaction_status === "partially_redacted" ||
      boundary.redaction_status === "fully_redacted";

    const didTruncate =
      boundary.input.truncated === true || boundary.output?.truncated === true;

    globalCaptureMetrics.recordBoundary(
      boundary.replayability,
      boundary.side_effect_class,
      bytesIn,
      bytesIn, // persisted or referenced
      didRedact,
      didTruncate
    );

    return boundary;
  } catch (err) {
    globalCaptureMetrics.recordFailure();
    throw err;
  }
}
