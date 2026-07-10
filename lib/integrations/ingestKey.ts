/**
 * Per-integration scoped ingest key helpers.
 *
 * A scoped ingest key authenticates trace ingestion for exactly one
 * integration/project, instead of the shared deployment-wide
 * AGENTPULSE_INGEST_KEY. Only a SHA-256 hash and a short non-secret preview
 * are ever persisted — the raw key is returned to the caller exactly once,
 * at generation time, and never stored or logged in plain text.
 */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const KEY_PREFIX = "ap_live_";

/** Generates a new raw scoped ingest key. Format: ap_live_<48 hex chars>. */
export function generateRawIngestKey(): string {
  return `${KEY_PREFIX}${randomBytes(24).toString("hex")}`;
}

/** SHA-256 hex digest of a raw ingest key, for storage and lookup. */
export function hashIngestKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/** Short, non-secret preview for display, e.g. "ap_live_...9f2a1c3b". */
export function previewIngestKey(rawKey: string): string {
  const suffix = rawKey.slice(-8);
  return `${KEY_PREFIX}...${suffix}`;
}

/** Constant-time comparison of two hash strings (defense in depth). */
export function constantTimeEqualHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
