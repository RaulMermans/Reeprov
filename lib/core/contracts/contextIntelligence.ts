/**
 * Canonical Context Intelligence Contracts.
 *
 * Defines versioned contracts for ContextIntelligenceReport, ContextSnapshotAnalysis,
 * ContextComposition, ProvenanceCoverage, DiagnosticSignals, and AblationCandidates.
 *
 * Invariant:
 * The original ContextSnapshot and RunArtifact are NEVER modified.
 * Context intelligence reports are pure derived analysis.
 */

import { z } from "zod";
import {
  contextSourceTypeSchema,
  tokenMeasurementMethodSchema,
  type ContextSourceType,
  type TokenMeasurementMethod,
} from "./context";

export const CONTEXT_INTELLIGENCE_SCHEMA_VERSION = "1.0.0-alpha";
export const DEFAULT_CONTEXT_ANALYZER_NAME = "ReeprovContextAnalyzer";
export const LEGACY_DEFAULT_CONTEXT_ANALYZER_NAME = "AgentPulseContextAnalyzer";
export const DEFAULT_CONTEXT_ANALYZER_VERSION = "1.0.0";
export const DEFAULT_CONTEXT_RULESET_VERSION = "2026.10";

// ── Provenance Classification ───────────────────────────────────────────────

export const provenanceCompletenessClassSchema = z.enum([
  "COMPLETE",        // All required provenance fields for source type are present
  "PARTIAL",         // Some identifying fields present, but missing retrieval/version link
  "HASH_ONLY",       // Content hash is present, but source metadata is absent
  "UNKNOWN_SOURCE",  // Explicitly missing source origin or reference
  "UNAVAILABLE",     // Context item was unavailable or uncaptured
]);

export type ProvenanceCompletenessClass = z.infer<typeof provenanceCompletenessClassSchema>;

// ── Context Composition Breakdown ──────────────────────────────────────────

export const sourceCompositionShareSchema = z.object({
  source_type: contextSourceTypeSchema,
  tokens: z.number().int().nonnegative(),
  item_count: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
});

export type SourceCompositionShare = z.infer<typeof sourceCompositionShareSchema>;

export const contextCompositionSchema = z.object({
  total_tokens: z.number().int().nonnegative(),
  item_count: z.number().int().nonnegative(),
  by_source_type: z.array(sourceCompositionShareSchema),
  by_source_system: z.record(z.string(), z.number().int().nonnegative()),
  by_sensitivity: z.record(z.string(), z.number().int().nonnegative()),
  captured_tokens: z.number().int().nonnegative(),
  hash_only_tokens: z.number().int().nonnegative(),
  unavailable_tokens: z.number().int().nonnegative(),
  retrieved_tokens: z.number().int().nonnegative(),
  non_retrieved_tokens: z.number().int().nonnegative(),
});

export type ContextComposition = z.infer<typeof contextCompositionSchema>;

// ── Measurement Quality ─────────────────────────────────────────────────────

export const contextMeasurementQualitySchema = z.object({
  provider_reported_tokens: z.number().int().nonnegative(),
  tokenizer_counted_tokens: z.number().int().nonnegative(),
  estimated_tokens: z.number().int().nonnegative(),
  unknown_tokens: z.number().int().nonnegative(),
  exact_measured_percentage: z.number().min(0).max(100),
  estimated_percentage: z.number().min(0).max(100),
});

export type ContextMeasurementQuality = z.infer<typeof contextMeasurementQualitySchema>;

// ── Provenance Coverage ─────────────────────────────────────────────────────

export const itemProvenanceCoverageSchema = z.object({
  item_id: z.string(),
  source_type: contextSourceTypeSchema,
  classification: provenanceCompletenessClassSchema,
  missing_fields: z.array(z.string()).default([]),
  declared_fields: z.array(z.string()).default([]),
});

export type ItemProvenanceCoverage = z.infer<typeof itemProvenanceCoverageSchema>;

export const contextProvenanceCoverageSchema = z.object({
  coverage_ratio: z.number().min(0).max(1), // complete / total
  complete_count: z.number().int().nonnegative(),
  partial_count: z.number().int().nonnegative(),
  hash_only_count: z.number().int().nonnegative(),
  unknown_count: z.number().int().nonnegative(),
  unavailable_count: z.number().int().nonnegative(),
  items: z.array(itemProvenanceCoverageSchema),
});

export type ContextProvenanceCoverage = z.infer<typeof contextProvenanceCoverageSchema>;

// ── Tool Exposure Analysis ──────────────────────────────────────────────────

export const contextToolExposureSchema = z.object({
  tools_exposed_count: z.number().int().nonnegative(),
  tool_definition_tokens: z.number().int().nonnegative(),
  tool_token_share_percentage: z.number().min(0).max(100),
  tools_used_downstream: z.array(z.string()),
  unused_exposed_tools: z.array(z.string()),
  tools_used_count: z.number().int().nonnegative(),
});

export type ContextToolExposure = z.infer<typeof contextToolExposureSchema>;

// ── Diagnostic Signals ──────────────────────────────────────────────────────

export const contextDiagnosticCodeSchema = z.enum([
  "EXACT_DUPLICATE_CONTENT",
  "REPEATED_UNCHANGED_CONTEXT",
  "LARGE_CONTEXT_ITEM",
  "HIGH_TOKEN_SHARE",
  "LOW_RETRIEVAL_SCORE",
  "RETRIEVED_NOT_ADMITTED",
  "CONTEXT_SOURCE_VERSION_CHANGED",
  "STALE_BY_EXPLICIT_VERSION",
  "STALE_BY_EXPLICIT_TIMESTAMP",
  "PROVENANCE_GAP",
  "HASH_ONLY_CONTEXT",
  "UNAVAILABLE_CONTEXT",
  "TOOL_DEFINITION_BLOAT",
  "CONTEXT_CHURN",
]);

export type ContextDiagnosticCode = z.infer<typeof contextDiagnosticCodeSchema>;

export const contextDiagnosticSignalSchema = z.object({
  signal_id: z.string(),
  code: contextDiagnosticCodeSchema,
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
  snapshot_id: z.string().optional(),
  item_id: z.string().optional(),
  item_ids: z.array(z.string()).optional(),
  token_impact: z.number().int().nonnegative().optional(),
  description: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  bounded_finding: z.string(), // Strictly factual, non-judgmental language
});

export type ContextDiagnosticSignal = z.infer<typeof contextDiagnosticSignalSchema>;

// ── Context Churn Analysis ──────────────────────────────────────────────────

export const contextChurnTransitionSchema = z.object({
  from_snapshot_id: z.string(),
  to_snapshot_id: z.string(),
  tokens_retained: z.number().int().nonnegative(),
  tokens_added: z.number().int().nonnegative(),
  tokens_removed: z.number().int().nonnegative(),
  tokens_changed: z.number().int().nonnegative(),
  context_churn_rate: z.number().min(0).max(1), // (added + removed + changed) / max(total_before, total_after)
  churn_by_source_type: z.record(
    z.string(),
    z.object({
      added: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
      retained: z.number().int().nonnegative(),
    })
  ),
});

export type ContextChurnTransition = z.infer<typeof contextChurnTransitionSchema>;

// ── Retrieval Admission ─────────────────────────────────────────────────────

export const retrievalAdmissionStatusSchema = z.enum([
  "RETRIEVED_AND_INJECTED",
  "RETRIEVED_NOT_INJECTED",
  "INJECTED_WITHOUT_RETRIEVAL_LINK",
  "UNKNOWN",
]);

export type RetrievalAdmissionStatus = z.infer<typeof retrievalAdmissionStatusSchema>;

export const retrievalAdmissionItemSchema = z.object({
  document_id: z.string(),
  chunk_id: z.string().optional(),
  status: retrievalAdmissionStatusSchema,
  retrieval_score: z.number().optional(),
  retrieval_rank: z.number().int().positive().optional(),
  injected_context_item_id: z.string().optional(),
  tokens: z.number().int().nonnegative().optional(),
});

export type RetrievalAdmissionItem = z.infer<typeof retrievalAdmissionItemSchema>;

export const retrievalAdmissionAnalysisSchema = z.object({
  operation_id: z.string(),
  query: z.string(),
  service_name: z.string().optional(),
  candidates_count: z.number().int().nonnegative(),
  injected_count: z.number().int().nonnegative(),
  admission_rate: z.number().min(0).max(1),
  items: z.array(retrievalAdmissionItemSchema),
});

export type RetrievalAdmissionAnalysis = z.infer<typeof retrievalAdmissionAnalysisSchema>;

// ── Ablation Candidate ──────────────────────────────────────────────────────

export const contextAblationCandidateSchema = z.object({
  candidate_id: z.string(),
  snapshot_id: z.string(),
  item_id: z.string(),
  source_type: contextSourceTypeSchema,
  token_savings_estimate: z.number().int().nonnegative(),
  rationale: z.string(),
  signal_code: contextDiagnosticCodeSchema,
  suggested_mutation: z.object({
    mutation_type: z.literal("context_exclusion"),
    target_identifier: z.string(),
    description: z.string(),
  }),
});

export type ContextAblationCandidate = z.infer<typeof contextAblationCandidateSchema>;

// ── Context Item Analysis ───────────────────────────────────────────────────

export const contextItemAnalysisSchema = z.object({
  item_id: z.string(),
  source_type: contextSourceTypeSchema,
  source_reference: z.string().optional(),
  token_count: z.number().int().nonnegative(),
  measurement_method: tokenMeasurementMethodSchema,
  position: z.number().int().nonnegative(),
  provenance_class: provenanceCompletenessClassSchema,
  content_captured: z.boolean(),
  content_hash: z.string().optional(),
  signals: z.array(contextDiagnosticCodeSchema).default([]),
});

export type ContextItemAnalysis = z.infer<typeof contextItemAnalysisSchema>;

// ── Context Snapshot Analysis (Decision-Scoped) ─────────────────────────────

export const contextSnapshotAnalysisSchema = z.object({
  snapshot_id: z.string(),
  step_id: z.string().optional(),
  model_invocation_id: z.string().optional(),
  timestamp: z.string(),
  composition: contextCompositionSchema,
  measurement_quality: contextMeasurementQualitySchema,
  provenance_coverage: contextProvenanceCoverageSchema,
  tool_exposure: contextToolExposureSchema,
  items: z.array(contextItemAnalysisSchema),
  signals: z.array(contextDiagnosticSignalSchema),
  ablation_candidates: z.array(contextAblationCandidateSchema),
});

export type ContextSnapshotAnalysis = z.infer<typeof contextSnapshotAnalysisSchema>;

// ── Run Summary ─────────────────────────────────────────────────────────────

export const contextRunSummarySchema = z.object({
  total_decisions: z.number().int().nonnegative(),
  total_context_tokens: z.number().int().nonnegative(),
  exact_repeated_tokens: z.number().int().nonnegative(),
  tool_definition_tokens: z.number().int().nonnegative(),
  retrieved_docs_admitted_count: z.number().int().nonnegative(),
  retrieved_docs_total_count: z.number().int().nonnegative(),
  retrieved_docs_admission_rate: z.number().min(0).max(1),
  memory_items_injected_count: z.number().int().nonnegative(),
  provenance_coverage_ratio: z.number().min(0).max(1),
  exact_duplicates_count: z.number().int().nonnegative(),
  provenance_gaps_count: z.number().int().nonnegative(),
});

export type ContextRunSummary = z.infer<typeof contextRunSummarySchema>;

// ── Provenance Graph Types ──────────────────────────────────────────────────

export const provenanceGraphNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum([
    "source_document",
    "retrieval_operation",
    "memory_operation",
    "context_item",
    "context_snapshot",
    "model_invocation",
    "execution_step",
    "tool_action",
    "outcome",
  ]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ProvenanceGraphNode = z.infer<typeof provenanceGraphNodeSchema>;

export const provenanceGraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  relation: z.string(), // e.g. "retrieved_by", "injected_into", "consumed_by", "produced"
  verified: z.boolean().default(true),
});

export type ProvenanceGraphEdge = z.infer<typeof provenanceGraphEdgeSchema>;

export const contextProvenanceGraphSchema = z.object({
  nodes: z.array(provenanceGraphNodeSchema),
  edges: z.array(provenanceGraphEdgeSchema),
});

export type ContextProvenanceGraph = z.infer<typeof contextProvenanceGraphSchema>;

// ── Context Intelligence Report ─────────────────────────────────────────────

export const contextIntelligenceReportSchema = z.object({
  report_id: z.string(),
  run_id: z.string(),
  analyzer_name: z.string().default(DEFAULT_CONTEXT_ANALYZER_NAME),
  analyzer_version: z.string().default(DEFAULT_CONTEXT_ANALYZER_VERSION),
  ruleset_version: z.string().default(DEFAULT_CONTEXT_RULESET_VERSION),
  schema_version: z.string().default(CONTEXT_INTELLIGENCE_SCHEMA_VERSION),
  source_artifact_schema_version: z.string(),
  generated_at: z.string(),
  run_summary: contextRunSummarySchema,
  snapshots: z.array(contextSnapshotAnalysisSchema),
  churn_transitions: z.array(contextChurnTransitionSchema).default([]),
  retrieval_admissions: z.array(retrievalAdmissionAnalysisSchema).default([]),
  provenance_graph: contextProvenanceGraphSchema.optional(),
  signals: z.array(contextDiagnosticSignalSchema),
  ablation_candidates: z.array(contextAblationCandidateSchema),
  comparison_link_id: z.string().optional(),
});

export type ContextIntelligenceReport = z.infer<typeof contextIntelligenceReportSchema>;
