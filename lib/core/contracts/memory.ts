/**
 * Canonical Memory Observability Contracts.
 *
 * Framework-neutral observability contracts for external memory systems
 * (e.g. Mem0, Letta/MemGPT, Zep, custom database stores).
 *
 * Core invariant:
 * run state ≠ checkpoint ≠ trace ≠ artifact ≠ memory ≠ eval result.
 * AgentPulse observes memory operations; it does not manage or persist long-term memory.
 */

import { z } from "zod";

// ── Memory Categories ───────────────────────────────────────────────────────

export const memoryCategorySchema = z.enum([
  "working",     // Short-term scratchpad or current task active memory
  "episodic",    // Records of specific past experiences, user interactions, or events
  "semantic",    // Generalized facts, domain knowledge, entity attributes, world knowledge
  "procedural",   // Learned workflows, instructions, behavioral policies, operational rules
]);

export type MemoryCategory = z.infer<typeof memoryCategorySchema>;

// ── Memory Operation Types ──────────────────────────────────────────────────

export const memoryOperationTypeSchema = z.enum([
  "read",             // Direct key/ID lookup
  "write_proposal",   // Proposed memory write before confirmation/guardrail
  "committed_write",  // Persisted new memory entry
  "update",           // In-place mutation of existing memory
  "supersede",        // Deprecating/replacing an older memory version with a newer one
  "delete",           // Explicit removal of a memory record
  "extraction",       // Parsing memories from conversation or execution steps
  "consolidation",    // Merging, summarizing, or clustering multiple memories into higher-order memories
  "retrieval",        // Query-driven search or similarity recall over memories
]);

export type MemoryOperationType = z.infer<typeof memoryOperationTypeSchema>;

// ── Memory Reference ────────────────────────────────────────────────────────

export const memoryReferenceSchema = z.object({
  memory_id: z.string(),
  category: memoryCategorySchema,
  key: z.string().optional(),
  summary: z.string().optional(),
  hash: z.string().optional(),
  uri: z.string().optional(),
  version: z.string().optional(),
});

export type MemoryReference = z.infer<typeof memoryReferenceSchema>;

// ── Memory Operation ────────────────────────────────────────────────────────

export const memoryOperationSchema = z.object({
  operation_id: z.string(),
  step_id: z.string().optional(),
  operation_type: memoryOperationTypeSchema,
  memory_id: z.string().optional(),
  memory_type: memoryCategorySchema,
  provider: z.string().optional(),                 // e.g. "mem0", "letta", "zep", "custom_postgres"
  query: z.string().optional(),                    // Search query for read/retrieval operations
  score: z.number().optional(),                    // Similarity or relevance score
  rank: z.number().int().positive().optional(),    // Result rank in multi-result retrieval
  source_provenance: z.string().optional(),        // Originating document, user message, or agent turn
  version: z.string().optional(),
  timestamps: z.object({
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    operation_at: z.string(),
  }),
  outcome: z.enum(["success", "rejected", "not_found", "failed", "pending"]),
  context_injection_linkage: z.object({
    context_item_id: z.string(),
    context_snapshot_id: z.string(),
  }).optional(),
  originating_run_id: z.string().optional(),
  originating_step_id: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type MemoryOperation = z.infer<typeof memoryOperationSchema>;
