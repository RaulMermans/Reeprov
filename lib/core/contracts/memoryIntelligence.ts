/**
 * Canonical Memory Intelligence Contracts.
 *
 * Defines versioned contracts for MemoryIntelligenceReport, MemoryLifecycle,
 * MemoryDiagnosticSignal, MemoryInjectionRecord, MemoryImpactEvidence,
 * and MemoryAblationCandidate.
 *
 * Invariant:
 * Reeprov observes and analyzes external memory operations.
 * It is NOT a memory database, vector store, or memory optimizer.
 */

import { z } from "zod";
import {
  memoryCategorySchema,
  memoryOperationTypeSchema,
  type MemoryCategory,
  type MemoryOperationType,
} from "./memory";

export const MEMORY_INTELLIGENCE_SCHEMA_VERSION = "1.0.0-alpha";
export const DEFAULT_MEMORY_ANALYZER_NAME = "ReeprovMemoryAnalyzer";
export const LEGACY_DEFAULT_MEMORY_ANALYZER_NAME = "AgentPulseMemoryAnalyzer";
export const DEFAULT_MEMORY_ANALYZER_VERSION = "1.0.0";
export const DEFAULT_MEMORY_RULESET_VERSION = "2026.10";

// ── Evidence & Contribution Levels ──────────────────────────────────────────

export const memoryEvidenceLevelSchema = z.enum([
  "OBSERVED",             // Operation was recorded directly in execution trace
  "CORRELATED",           // Injected memory present in a run that succeeded/failed (no counterfactual proof)
  "CONTROLLED_ABLATION",  // Controlled fork performed with memory_exclusion
  "CAUSALLY_SUPPORTED",   // Controlled experiment proves outcome divergence attributable to memory
]);

export type MemoryEvidenceLevel = z.infer<typeof memoryEvidenceLevelSchema>;

// ── Lifecycle Relationship Status ───────────────────────────────────────────

export const lifecycleLinkStatusSchema = z.enum([
  "OBSERVED",
  "INFERRED_FROM_PROVIDER_METADATA",
  "UNKNOWN",
]);

export type LifecycleLinkStatus = z.infer<typeof lifecycleLinkStatusSchema>;

// ── Memory Lifecycle Node & Transition ──────────────────────────────────────

export const memoryLifecycleNodeSchema = z.object({
  node_id: z.string(),
  memory_id: z.string(),
  version: z.string().optional(),
  operation_id: z.string(),
  operation_type: memoryOperationTypeSchema,
  timestamp: z.string(),
  step_id: z.string().optional(),
  content_hash: z.string().optional(),
  summary_preview: z.string().optional(),
  category: memoryCategorySchema,
  provider: z.string().optional(),
  evidence_status: lifecycleLinkStatusSchema.default("OBSERVED"),
});

export type MemoryLifecycleNode = z.infer<typeof memoryLifecycleNodeSchema>;

export const memoryLifecycleEdgeSchema = z.object({
  source_node_id: z.string(),
  target_node_id: z.string(),
  relation: z.enum([
    "extracted_from",
    "proposed_as",
    "committed_from",
    "updated_to",
    "consolidated_into",
    "superseded_by",
    "retrieved_for",
    "injected_into",
  ]),
  status: lifecycleLinkStatusSchema.default("OBSERVED"),
});

export type MemoryLifecycleEdge = z.infer<typeof memoryLifecycleEdgeSchema>;

export const memoryLifecycleSchema = z.object({
  memory_id: z.string(),
  provider: z.string().optional(),
  category: memoryCategorySchema,
  current_version: z.string().optional(),
  versions_seen: z.array(z.string()).default([]),
  nodes: z.array(memoryLifecycleNodeSchema),
  edges: z.array(memoryLifecycleEdgeSchema),
  is_superseded: z.boolean().default(false),
  superseded_by: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export type MemoryLifecycle = z.infer<typeof memoryLifecycleSchema>;

// ── Memory Retrieval → Context Injection Flow ──────────────────────────────

export const memoryInjectionRecordSchema = z.object({
  injection_id: z.string(),
  memory_id: z.string(),
  provider: z.string().optional(),
  memory_version: z.string().optional(),
  category: memoryCategorySchema,
  retrieval_operation_id: z.string().optional(),
  retrieval_query: z.string().optional(),
  retrieval_score: z.number().optional(),
  retrieval_rank: z.number().int().positive().optional(),
  context_snapshot_id: z.string(),
  context_item_id: z.string(),
  model_invocation_id: z.string().optional(),
  step_id: z.string().optional(),
  injected_tokens: z.number().int().nonnegative().optional(),
  content_preview: z.string().optional(),
  content_hash: z.string().optional(),
  is_stale_at_injection: z.boolean().default(false),
  stale_reason: z.string().optional(),
  downstream_tool_calls: z.array(z.string()).default([]),
  outcome_status: z.string().optional(),
});

export type MemoryInjectionRecord = z.infer<typeof memoryInjectionRecordSchema>;

// ── Diagnostic Signals ──────────────────────────────────────────────────────

export const memoryDiagnosticCodeSchema = z.enum([
  "MEMORY_RETRIEVED_NOT_INJECTED",
  "MEMORY_INJECTED",
  "MEMORY_OLD_VERSION_INJECTED",
  "MEMORY_SUPERSEDED_BUT_RETRIEVED",
  "MEMORY_EXACT_DUPLICATE",
  "MEMORY_PROVENANCE_GAP",
  "MEMORY_WRITE_REJECTED",
  "MEMORY_WRITE_FAILED",
  "MEMORY_CONSOLIDATION_UNTRACEABLE",
  "MEMORY_HIGH_TOKEN_SHARE",
  "MEMORY_VERSION_CONFLICT",
  "MEMORY_CONTEXT_LINK_BROKEN",
]);

export type MemoryDiagnosticCode = z.infer<typeof memoryDiagnosticCodeSchema>;

export const memoryDiagnosticSignalSchema = z.object({
  signal_id: z.string(),
  code: memoryDiagnosticCodeSchema,
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
  memory_id: z.string().optional(),
  operation_id: z.string().optional(),
  context_item_id: z.string().optional(),
  token_impact: z.number().int().nonnegative().optional(),
  description: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  bounded_finding: z.string(), // Strictly factual, non-judgmental language
});

export type MemoryDiagnosticSignal = z.infer<typeof memoryDiagnosticSignalSchema>;

// ── Impact Evidence ─────────────────────────────────────────────────────────

export const memoryImpactEvidenceSchema = z.object({
  memory_id: z.string(),
  memory_version: z.string().optional(),
  evidence_level: memoryEvidenceLevelSchema,
  injected_into_snapshot_id: z.string().optional(),
  context_tokens: z.number().int().nonnegative().optional(),
  observed_behavior: z.string(),
  counterfactual_experiment_id: z.string().optional(),
  notes: z.string(),
});

export type MemoryImpactEvidence = z.infer<typeof memoryImpactEvidenceSchema>;

// ── Memory Ablation Candidate ───────────────────────────────────────────────

export const memoryAblationCandidateSchema = z.object({
  candidate_id: z.string(),
  memory_id: z.string(),
  memory_version: z.string().optional(),
  linked_context_item_id: z.string().optional(),
  token_savings_estimate: z.number().int().nonnegative().optional(),
  rationale: z.string(),
  signal_code: memoryDiagnosticCodeSchema,
  suggested_mutation: z.object({
    mutation_type: z.literal("memory_exclusion"),
    target_identifier: z.string(),
    description: z.string(),
  }),
});

export type MemoryAblationCandidate = z.infer<typeof memoryAblationCandidateSchema>;

// ── Summaries ───────────────────────────────────────────────────────────────

export const memoryOperationsSummarySchema = z.object({
  total_operations: z.number().int().nonnegative(),
  by_type: z.record(z.string(), z.number().int().nonnegative()),
  unique_memories_observed: z.number().int().nonnegative(),
  reads_count: z.number().int().nonnegative(),
  writes_committed_count: z.number().int().nonnegative(),
  updates_count: z.number().int().nonnegative(),
  supersedes_count: z.number().int().nonnegative(),
  consolidations_count: z.number().int().nonnegative(),
  extractions_count: z.number().int().nonnegative(),
  write_failures_count: z.number().int().nonnegative(),
});

export type MemoryOperationsSummary = z.infer<typeof memoryOperationsSummarySchema>;

export const memoryRetrievalSummarySchema = z.object({
  total_retrieval_ops: z.number().int().nonnegative(),
  memories_retrieved_count: z.number().int().nonnegative(),
  memories_injected_count: z.number().int().nonnegative(),
  admission_rate: z.number().min(0).max(1),
  superseded_retrieved_count: z.number().int().nonnegative(),
  stale_versions_retrieved_count: z.number().int().nonnegative(),
});

export type MemoryRetrievalSummary = z.infer<typeof memoryRetrievalSummarySchema>;

// ── Memory Intelligence Report ──────────────────────────────────────────────

export const memoryIntelligenceReportSchema = z.object({
  report_id: z.string(),
  run_id: z.string(),
  analyzer_name: z.string().default(DEFAULT_MEMORY_ANALYZER_NAME),
  analyzer_version: z.string().default(DEFAULT_MEMORY_ANALYZER_VERSION),
  ruleset_version: z.string().default(DEFAULT_MEMORY_RULESET_VERSION),
  schema_version: z.string().default(MEMORY_INTELLIGENCE_SCHEMA_VERSION),
  source_artifact_schema_version: z.string(),
  generated_at: z.string(),
  operations_summary: memoryOperationsSummarySchema,
  retrieval_summary: memoryRetrievalSummarySchema,
  injections: z.array(memoryInjectionRecordSchema),
  lifecycles: z.array(memoryLifecycleSchema),
  diagnostics: z.array(memoryDiagnosticSignalSchema),
  impact_evidence: z.array(memoryImpactEvidenceSchema),
  ablation_candidates: z.array(memoryAblationCandidateSchema),
});

export type MemoryIntelligenceReport = z.infer<typeof memoryIntelligenceReportSchema>;
