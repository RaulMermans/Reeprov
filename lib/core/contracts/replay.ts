/**
 * Canonical Replayability & Side-Effect Semantics.
 *
 * A trace is not automatically replayable. Replayability requires sufficient
 * captured state and deterministic treatment of non-deterministic and external boundaries.
 */

import { z } from "zod";

// ── Replayability Classes ───────────────────────────────────────────────────

export const replayabilityClassSchema = z.enum([
  "REPLAYABLE_RECORDED",       // Can be accurately reproduced by mocking recorded outputs
  "REPLAYABLE_DETERMINISTIC",  // Pure computation; produces identical output given identical input
  "REPLAYABLE_SANDBOXED",      // Can be executed live in an isolated test harness or ephemeral sandbox
  "LIVE_REQUIRED",             // Inherently requires live external service connectivity
  "SIDE_EFFECT_GATED",         // Can only replay up to this boundary; requires human/policy signoff to proceed
  "NON_REPLAYABLE",            // Non-deterministic, unrecorded, or irreversible boundary
  "UNKNOWN",                   // Replay capability has not been evaluated or captured
]);

export type ReplayabilityClass = z.infer<typeof replayabilityClassSchema>;

// ── Side-Effect Classes ─────────────────────────────────────────────────────

export const sideEffectClassSchema = z.enum([
  "read_only",             // No state change, safe to call repeatedly
  "write_draft",           // Creates local/draft artifacts, ephemeral or easily rolled back
  "external_side_effect",  // Mutates external systems (e.g. sends email, posts comment, charges card)
  "sensitive_data",        // Involves credentials, PII, or security keys
  "destructive",           // Permanently modifies or deletes external data
]);

export type SideEffectClass = z.infer<typeof sideEffectClassSchema>;

// ── Redaction & Content Availability ────────────────────────────────────────

export const redactionStatusSchema = z.enum([
  "none",
  "partially_redacted",
  "fully_redacted",
  "unverified",
]);

export type RedactionStatus = z.infer<typeof redactionStatusSchema>;

export const canonicalContentAvailabilitySchema = z.enum([
  "CAPTURED",
  "REDACTED",
  "HASH_ONLY",
  "TRUNCATED",
  "NOT_CAPTURED",
  "UNAVAILABLE",
]);

export type CanonicalContentAvailability = z.infer<typeof canonicalContentAvailabilitySchema>;

/**
 * Normalizes legacy transitional availability values (e.g. "full", "summary_only")
 * into the canonical uppercase vocabulary.
 */
export function normalizeContentAvailability(val: unknown): CanonicalContentAvailability {
  if (typeof val !== "string") return "NOT_CAPTURED";
  const upper = val.toUpperCase().trim();
  if (upper === "FULL" || upper === "CAPTURED") return "CAPTURED";
  if (upper === "SUMMARY_ONLY" || upper === "TRUNCATED") return "TRUNCATED";
  if (upper === "HASH_ONLY") return "HASH_ONLY";
  if (upper === "REDACTED") return "REDACTED";
  if (upper === "UNAVAILABLE") return "UNAVAILABLE";
  if (upper === "NOT_CAPTURED") return "NOT_CAPTURED";
  return "NOT_CAPTURED";
}

export const capturedContentAvailabilitySchema = z.preprocess(
  normalizeContentAvailability,
  canonicalContentAvailabilitySchema
);

export type CapturedContentAvailability = CanonicalContentAvailability;

// ── Replay Side-Effect Safety Policy ────────────────────────────────────────

export const sideEffectReplayPolicySchema = z.enum([
  "SUBSTITUTE_RECORDED",       // Substitute recorded output offline without executing external action
  "DENY_ALL",                  // Fail immediately if any external side-effecting boundary is reached
  "AUTHORIZE_LIVE_EXECUTION",  // Explicit permission for live rerun (strictly forbidden in STRICT_OFFLINE)
]);

export type SideEffectReplayPolicy = z.infer<typeof sideEffectReplayPolicySchema>;

// ── Execution Boundary ──────────────────────────────────────────────────────

export const boundaryPayloadSchema = z.object({
  captured: z.boolean(),
  content: z.unknown().optional(),
  summary: z.string().optional(),
  hash: z.string().optional(),
  redaction_status: redactionStatusSchema.default("none"),
  content_ref: z.string().optional(),
  availability: capturedContentAvailabilitySchema.optional(),
  truncated: z.boolean().optional(),
  raw_size_bytes: z.number().int().nonnegative().optional(),
});

export type BoundaryPayload = z.infer<typeof boundaryPayloadSchema>;

export const boundaryTypeSchema = z.enum([
  "model_call",
  "tool_call",
  "external_http",
  "database",
  "filesystem",
  "clock",
  "randomness",
  "user_input",
  "retrieval_service",
  "retrieval_call",
  "memory_service",
  "memory_read",
  "memory_write",
  "code_execution",
  "filesystem_read",
  "filesystem_write",
  "subagent_call",
  "custom",
]);

export type BoundaryType = z.infer<typeof boundaryTypeSchema>;

export const executionBoundarySchema = z.object({
  boundary_id: z.string(),
  run_id: z.string().optional(),
  step_id: z.string().optional(),
  node_id: z.string().optional(),
  sequence_index: z.number().int().nonnegative().optional(),
  boundary_type: boundaryTypeSchema,
  name: z.string(),
  status: z.enum(["completed", "failed", "pending", "interrupted", "skipped"]).optional().default("completed"),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  input: boundaryPayloadSchema,
  output: boundaryPayloadSchema.optional(),
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
    details: z.unknown().optional(),
  }).optional(),
  replayability: replayabilityClassSchema.default("UNKNOWN"),
  side_effect_class: sideEffectClassSchema.default("read_only"),
  idempotency: z.object({
    is_idempotent: z.boolean(),
    idempotency_key: z.string().optional(),
  }).default({ is_idempotent: false }),
  external_dependency: z.string().optional(),
  dependency_identity: z.string().optional(),
  captured_content_availability: capturedContentAvailabilitySchema.default("NOT_CAPTURED"),
  redaction_status: redactionStatusSchema.default("unverified"),
  redaction_metadata: z.object({
    fields_redacted: z.array(z.string()).default([]),
    strategy: z.string().optional(),
  }).optional(),
  content_hashes: z.object({
    input_hash: z.string().optional(),
    output_hash: z.string().optional(),
  }).optional(),
  trace_correlation_id: z.string().optional(),
  linked_model_invocation_id: z.string().optional(),
  linked_tool_invocation_id: z.string().optional(),
  linked_retrieval_operation_id: z.string().optional(),
  linked_memory_operation_id: z.string().optional(),
  timestamp: z.string(),
  duration_ms: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ExecutionBoundary = z.infer<typeof executionBoundarySchema>;

// ── External Call ───────────────────────────────────────────────────────────

export const externalCallSchema = z.object({
  call_id: z.string(),
  step_id: z.string().optional(),
  service_name: z.string(),
  operation: z.string(),
  target_url: z.string().optional(),
  method: z.string().optional(),
  duration_ms: z.number().optional(),
  status: z.enum(["success", "failed", "timeout", "blocked"]),
  replayability: replayabilityClassSchema.default("UNKNOWN"),
  side_effect_class: sideEffectClassSchema.default("external_side_effect"),
  error: z.string().optional(),
  timestamp: z.string(),
});

export type ExternalCall = z.infer<typeof externalCallSchema>;

// ── Replay Metadata ─────────────────────────────────────────────────────────

export const replayMetadataSchema = z.object({
  overall_replayability: replayabilityClassSchema.default("UNKNOWN"),
  unsupported_boundaries_count: z.number().default(0),
  side_effect_gated_count: z.number().default(0),
  deterministic: z.boolean().default(false),
  sandboxed_available: z.boolean().default(false),
  missing_recordings: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});

export type ReplayMetadata = z.infer<typeof replayMetadataSchema>;
