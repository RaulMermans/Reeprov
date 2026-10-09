/**
 * Canonical Failure Taxonomy & API Stability Contracts.
 *
 * Provides a standardized, comprehensive categorization of failure modes across
 * agent architectures, reasoning, infrastructure, tools, context, and memory.
 */

import { z } from "zod";

// ── Canonical Failure Taxonomy ──────────────────────────────────────────────

export const failureCategorySchema = z.enum([
  "ARCHITECTURE",
  "ROUTING",
  "MODEL_REASONING",
  "MODEL_PROVIDER",
  "CONTEXT",
  "RETRIEVAL",
  "MEMORY",
  "TOOL_SELECTION",
  "TOOL_ARGUMENT",
  "TOOL_EXECUTION",
  "SCHEMA",
  "PERMISSION",
  "APPROVAL",
  "STATE",
  "CHECKPOINT",
  "REPLAY",
  "DURABILITY",
  "TIMEOUT",
  "BUDGET",
  "EVAL",
  "SECURITY",
  "INFRASTRUCTURE",
  "DEPLOYMENT",
]);

export type FailureCategory = z.infer<typeof failureCategorySchema>;

export const failureDetailSchema = z.object({
  category: failureCategorySchema,
  message: z.string(),
  code: z.string().optional(),
  step_id: z.string().optional(),
  node_id: z.string().optional(),
  recoverable: z.boolean().default(false),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type FailureDetail = z.infer<typeof failureDetailSchema>;

// ── API Stability Classifications ───────────────────────────────────────────

export const apiStabilityClassSchema = z.enum([
  "PUBLIC_STABLE",
  "PUBLIC_EXPERIMENTAL",
  "INTERNAL",
]);

export type APIStabilityClass = z.infer<typeof apiStabilityClassSchema>;
