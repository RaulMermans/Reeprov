/**
 * Ingest key authentication.
 *
 * External projects that emit trace events use REEPROV_INGEST_KEY.
 * If REEPROV_INGEST_KEY is not set, falls back to REEPROV_ACCESS_KEY
 * for local/dev simplicity.
 *
 * Header: x-reeprov-key (with legacy x-agentpulse-key fallback)
 *
 * Auth model:
 *   REEPROV_ACCESS_KEY  — dashboard / internal access (browser session)
 *   REEPROV_INGEST_KEY  — external trace ingestion (from AI projects)
 *   fallback            — if REEPROV_INGEST_KEY is unset, REEPROV_ACCESS_KEY
 *                         is accepted for local development
 */

import { timingSafeEqual } from "crypto";
import { AccessKeyError } from "./requireAccessKey";

export class IngestKeyError extends AccessKeyError {
  constructor(message = "Missing or invalid ingest key.") {
    super(message);
    this.name = "IngestKeyError";
  }
}

/**
 * Validates the x-reeprov-key header against the ingest key.
 *
 * Throws IngestKeyError (401) if the key is missing or invalid.
 *
 * Fallback: if REEPROV_INGEST_KEY is not configured, accepts
 * REEPROV_ACCESS_KEY instead (local dev / single-key deployments).
 */
export function requireIngestKey(request: Request): void {
  const ingestKey = process.env["REEPROV_INGEST_KEY"] ?? process.env["AGENTPULSE_INGEST_KEY"];
  const accessKey = process.env["REEPROV_ACCESS_KEY"] ?? process.env["AGENTPULSE_ACCESS_KEY"];
  const provided = request.headers.get("x-reeprov-key") ?? request.headers.get("x-agentpulse-key");

  // Determine the effective expected key.
  const expected = ingestKey ?? accessKey;

  if (!expected || !provided || !constantTimeEqual(provided, expected)) {
    throw new IngestKeyError();
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
