/**
 * Canonical Context Intelligence Contracts.
 *
 * Captures what information was available to an agent or model at each decision moment.
 * Enables token attribution, provenance inspection, and future context ablation studies.
 */

import { z } from "zod";
import { redactionStatusSchema } from "./replay";

// ── Context Source Types ────────────────────────────────────────────────────

export const contextSourceTypeSchema = z.enum([
  "system_policy",                // Platform safety rules, developer guidelines, hard system prompts
  "agent_instructions",           // Primary persona or agent task prompt
  "active_skill",                 // Dynamically loaded skill or tool manual instructions
  "conversation_history",         // Prior chat turns or user/assistant message thread
  "run_state",                    // Injected execution variables, scratchpad, or accumulator values
  "retrieved_document",           // Chunks or documents retrieved from vector/hybrid knowledge bases
  "retrieved_memory",             // Episodic or semantic memories injected from long-term memory stores
  "tool_definition",              // JSON Schema or function descriptions presented to the model
  "artifact_reference",           // Summaries or contents of previously produced files/artifacts
  "few_shot_example",             // In-context demonstrations or golden exemplars
  "generated_intermediate_context", // Chain of thought, plan draft, or reasoning steps
  "user_input",                   // Direct human prompt or trigger payload
  "custom",                       // Other explicitly typed custom sources
]);

export type ContextSourceType = z.infer<typeof contextSourceTypeSchema>;

// ── Context Provenance ──────────────────────────────────────────────────────

export const contextProvenanceSchema = z.object({
  source_system: z.string().optional(),          // e.g. "knowledge_base", "mem0", "file_store", "git"
  document_id: z.string().optional(),
  chunk_id: z.string().optional(),
  uri: z.string().optional(),                    // e.g. "file:///docs/spec.md#L10-L40", "s3://..."
  version: z.string().optional(),
  retrieval_query: z.string().optional(),
  retrieval_score: z.number().optional(),
  author: z.string().optional(),
  attribution_metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ContextProvenance = z.infer<typeof contextProvenanceSchema>;

// ── Context Item ────────────────────────────────────────────────────────────

export const contextItemSchema = z.object({
  item_id: z.string(),
  source_type: contextSourceTypeSchema,
  source_reference: z.string().optional(),
  provenance: contextProvenanceSchema.optional(),
  token_estimate: z.number().int().nonnegative().optional(),
  position: z.number().int().nonnegative(),
  inclusion_reason: z.string().optional(),
  retrieval_score: z.number().optional(),
  timestamp: z.string().optional(),
  version: z.string().optional(),
  sensitivity: z.enum(["public", "internal", "confidential", "restricted"]).default("internal"),
  redaction_status: redactionStatusSchema.default("none"),
  content_captured: z.boolean(),
  content: z.string().optional(),
  content_hash: z.string().optional(),
  content_ref: z.string().optional(),
  availability: z.enum([
    "full",
    "summary_only",
    "hash_only",
    "not_captured",
    "CAPTURED",
    "REDACTED",
    "HASH_ONLY",
    "TRUNCATED",
    "NOT_CAPTURED",
    "UNAVAILABLE",
  ]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ContextItem = z.infer<typeof contextItemSchema>;

// ── Context Snapshot ────────────────────────────────────────────────────────

export const contextSnapshotSchema = z.object({
  snapshot_id: z.string(),
  step_id: z.string().optional(),
  model_invocation_id: z.string().optional(),
  timestamp: z.string(),
  total_token_estimate: z.number().int().nonnegative().optional(),
  items: z.array(contextItemSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;
