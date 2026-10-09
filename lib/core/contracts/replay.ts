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

export const capturedContentAvailabilitySchema = z.enum([
  "full",
  "summary_only",
  "hash_only",
  "not_captured",
]);

export type CapturedContentAvailability = z.infer<typeof capturedContentAvailabilitySchema>;

// ── Execution Boundary ──────────────────────────────────────────────────────

export const boundaryPayloadSchema = z.object({
  captured: z.boolean(),
  content: z.unknown().optional(),
  summary: z.string().optional(),
  hash: z.string().optional(),
  redaction_status: redactionStatusSchema.default("none"),
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
  "memory_service",
  "subagent_call",
  "custom",
]);

export type BoundaryType = z.infer<typeof boundaryTypeSchema>;

export const executionBoundarySchema = z.object({
  boundary_id: z.string(),
  step_id: z.string().optional(),
  node_id: z.string().optional(),
  boundary_type: boundaryTypeSchema,
  name: z.string(),
  input: boundaryPayloadSchema,
  output: boundaryPayloadSchema.optional(),
  replayability: replayabilityClassSchema.default("UNKNOWN"),
  side_effect_class: sideEffectClassSchema.default("read_only"),
  idempotency: z.object({
    is_idempotent: z.boolean(),
    idempotency_key: z.string().optional(),
  }).default({ is_idempotent: false }),
  external_dependency: z.string().optional(),
  captured_content_availability: capturedContentAvailabilitySchema.default("not_captured"),
  redaction_status: redactionStatusSchema.default("unverified"),
  timestamp: z.string(),
  duration_ms: z.number().optional(),
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
