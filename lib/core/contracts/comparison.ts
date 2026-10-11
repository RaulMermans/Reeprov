/**
 * Canonical Run Comparison & Divergence Analysis Contracts.
 *
 * Defines the versioned comparison artifact representing deterministic Layer 1 facts
 * and optional Layer 2 semantic interpretations between two agent executions.
 *
 * Comparison is a derived, standalone artifact: Run A and Run B remain strictly immutable.
 */

import { z } from "zod";
import { type ConfigurationDiff } from "./configuration";

export const configurationDiffSchema = z.object({
  identical: z.boolean(),
  changed_agent: z.boolean(),
  changed_model: z.boolean(),
  changed_parameters: z.boolean(),
  changed_prompts: z.boolean(),
  changed_skills: z.boolean(),
  changed_tools: z.boolean(),
  changed_permissions: z.boolean(),
  changed_workflow: z.boolean(),
  changed_runtime_config: z.boolean(),
  differences: z.record(z.string(), z.unknown()).default({}),
  summary: z.array(z.string()).default([]),
});

export const RUN_COMPARISON_SCHEMA_VERSION = "1.0.0";

// ── Relationship Classification ─────────────────────────────────────────────

export const runRelationshipSchema = z.enum([
  "INDEPENDENT",
  "PARENT_CHILD",
  "SIBLING_FORKS",
  "REPLAY_SOURCE",
  "SAME_EXPERIMENT",
  "UNKNOWN",
]);

export type RunRelationship = z.infer<typeof runRelationshipSchema>;

// ── Comparison Taxonomy & Categories ─────────────────────────────────────────

export const comparisonDimensionSchema = z.enum([
  "CONFIGURATION",
  "PLAN",
  "STATE",
  "CONTEXT",
  "MEMORY",
  "RETRIEVAL",
  "MODEL_INPUT",
  "MODEL_OUTPUT",
  "TOOL_SELECTION",
  "TOOL_ARGUMENT",
  "TOOL_OUTPUT",
  "BOUNDARY_ORDER",
  "PERMISSION",
  "APPROVAL",
  "SECURITY",
  "TEST",
  "REVIEW",
  "VERIFICATION",
  "ARTIFACT",
  "METRIC",
  "OUTCOME",
]);

export type ComparisonDimension = z.infer<typeof comparisonDimensionSchema>;

export const causalStatusSchema = z.enum([
  "OBSERVED_DIFFERENCE",
  "PLAUSIBLE_CONTRIBUTOR",
  "CONTROLLED_MUTATION",
  "CAUSALLY_SUPPORTED",
]);

export type CausalStatus = z.infer<typeof causalStatusSchema>;

export const comparisonSeveritySchema = z.enum([
  "info",
  "warning",
  "error",
  "critical",
]);

export type ComparisonSeverity = z.infer<typeof comparisonSeveritySchema>;

export const evidenceQualitySchema = z.enum([
  "EXACT",
  "HASH_ONLY",
  "STRUCTURAL",
  "SEMANTIC",
  "PARTIAL",
  "UNAVAILABLE",
]);

export type EvidenceQuality = z.infer<typeof evidenceQualitySchema>;

// ── Comparison Divergence ───────────────────────────────────────────────────

export const comparisonDivergenceSchema = z.object({
  divergence_id: z.string(),
  dimension: comparisonDimensionSchema,
  step_id: z.string().optional(),
  step_name: z.string().optional(),
  candidate_step_id: z.string().optional(),
  boundary_id: z.string().optional(),
  candidate_boundary_id: z.string().optional(),
  baseline_evidence: z.unknown().optional(),
  candidate_evidence: z.unknown().optional(),
  severity: comparisonSeveritySchema.default("info").optional(),
  deterministic: z.boolean().default(true).optional(),
  confidence: z.number().min(0).max(1).default(1.0).optional(),
  description: z.string(),
  evidence_refs: z.array(z.string()).default([]).optional(),
  causal_status: causalStatusSchema.default("OBSERVED_DIFFERENCE").optional(),
  origin_mutation_id: z.string().optional(),
  downstream_of_divergence_id: z.string().optional(),
  evidence_quality: evidenceQualitySchema.default("STRUCTURAL").optional(),
  is_meaningful: z.boolean().default(false).optional(),
});

export type ComparisonDivergence = z.infer<typeof comparisonDivergenceSchema>;

// ── Step & Boundary Alignment ───────────────────────────────────────────────

export const alignmentStatusSchema = z.enum([
  "MATCHED",
  "MODIFIED",
  "BASELINE_ONLY",
  "CANDIDATE_ONLY",
  "MOVED",
  "AMBIGUOUS",
]);

export type AlignmentStatus = z.infer<typeof alignmentStatusSchema>;

export const lineageSegmentTypeSchema = z.enum([
  "HISTORICAL_SHARED",
  "BASELINE_ONLY",
  "CANDIDATE_ONLY",
  "FORK_EXECUTION",
]);

export type LineageSegmentType = z.infer<typeof lineageSegmentTypeSchema>;

export const alignedStepSchema = z.object({
  logical_index: z.number().int().nonnegative(),
  baseline_step_id: z.string().optional(),
  candidate_step_id: z.string().optional(),
  name: z.string(),
  alignment_status: alignmentStatusSchema,
  alignment_confidence: z.number().min(0).max(1).default(1.0).optional(),
  alignment_basis: z.string(),
  segment_type: lineageSegmentTypeSchema.default("BASELINE_ONLY").optional(),
  differences: z.array(z.string()).default([]).optional(),
  divergence_ids: z.array(z.string()).default([]).optional(),
  duration_delta_ms: z.number().optional(),
  cost_delta_usd: z.number().optional(),
  tokens_delta: z.number().optional(),
});

export type AlignedStep = z.infer<typeof alignedStepSchema>;

export const boundaryChangeTypeSchema = z.enum([
  "BOUNDARY_ADDED",
  "BOUNDARY_REMOVED",
  "BOUNDARY_REORDERED",
  "BOUNDARY_TYPE_CHANGED",
  "BOUNDARY_INPUT_CHANGED",
  "BOUNDARY_OUTPUT_CHANGED",
  "SIDE_EFFECT_CLASS_CHANGED",
  "REPLAYABILITY_CHANGED",
  "MATCHED",
]);

export type BoundaryChangeType = z.infer<typeof boundaryChangeTypeSchema>;

export const alignedBoundarySchema = z.object({
  boundary_id: z.string().optional(),
  candidate_boundary_id: z.string().optional(),
  boundary_type: z.string(),
  name: z.string(),
  alignment_status: alignmentStatusSchema,
  change_type: boundaryChangeTypeSchema.default("MATCHED"),
  differences: z.array(z.string()).default([]),
});

export type AlignedBoundary = z.infer<typeof alignedBoundarySchema>;

export const comparisonAlignmentSchema = z.object({
  aligned_steps: z.array(alignedStepSchema).default([]),
  aligned_boundaries: z.array(alignedBoundarySchema).default([]),
  alignment_summary: z.object({
    total_baseline_steps: z.number().int().nonnegative(),
    total_candidate_steps: z.number().int().nonnegative(),
    matched_count: z.number().int().nonnegative(),
    modified_count: z.number().int().nonnegative(),
    baseline_only_count: z.number().int().nonnegative(),
    candidate_only_count: z.number().int().nonnegative(),
    ambiguous_count: z.number().int().nonnegative(),
  }),
  materialized_baseline: z.any().optional(),
  materialized_candidate: z.any().optional(),
});

export type ComparisonAlignment = z.infer<typeof comparisonAlignmentSchema>;

// ── State Diff ──────────────────────────────────────────────────────────────

export const stateChangeOperationSchema = z.enum(["add", "remove", "replace"]);
export type StateChangeOperation = z.infer<typeof stateChangeOperationSchema>;

export const stateChangeSchema = z.object({
  path: z.string(), // JSON Pointer format e.g. "/customer/vip"
  operation: stateChangeOperationSchema,
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  before_hash: z.string().optional(),
  after_hash: z.string().optional(),
  redacted: z.boolean().default(false),
});

export type StateChange = z.infer<typeof stateChangeSchema>;

export const stateDiffSchema = z.object({
  step_id: z.string().optional(),
  candidate_step_id: z.string().optional(),
  changes: z.array(stateChangeSchema).default([]),
});

export type StateDiff = z.infer<typeof stateDiffSchema>;

// ── Context Diff ───────────────────────────────────────────────────────────

export const contextChangeTypeSchema = z.enum([
  "CONTEXT_ITEM_ADDED",
  "CONTEXT_ITEM_REMOVED",
  "CONTEXT_ITEM_CHANGED",
  "CONTEXT_ORDER_CHANGED",
  "CONTEXT_TOKEN_DELTA",
  "CONTEXT_SOURCE_CHANGED",
]);

export type ContextChangeType = z.infer<typeof contextChangeTypeSchema>;

export const contextItemChangeSchema = z.object({
  item_id: z.string(),
  source_type: z.string(),
  source_ref: z.string().optional(),
  change_type: contextChangeTypeSchema,
  before_hash: z.string().optional(),
  after_hash: z.string().optional(),
  token_delta: z.number().int().default(0),
  position_before: z.number().int().optional(),
  position_after: z.number().int().optional(),
});

export type ContextItemChange = z.infer<typeof contextItemChangeSchema>;

export const contextDiffSchema = z.object({
  token_delta: z.number().int().default(0),
  changes: z.array(contextItemChangeSchema).default([]),
  unavailable: z.boolean().default(false),
});

export type ContextDiff = z.infer<typeof contextDiffSchema>;

// ── Retrieval Diff ──────────────────────────────────────────────────────────

export const retrievalChangeTypeSchema = z.enum([
  "RETRIEVAL_QUERY_CHANGED",
  "RESULT_ADDED",
  "RESULT_REMOVED",
  "RESULT_RANK_CHANGED",
  "RESULT_SCORE_CHANGED",
  "CONTEXT_ADMISSION_CHANGED",
]);

export type RetrievalChangeType = z.infer<typeof retrievalChangeTypeSchema>;

export const retrievalChangeSchema = z.object({
  retrieval_id: z.string().optional(),
  change_type: retrievalChangeTypeSchema,
  query_before: z.string().optional(),
  query_after: z.string().optional(),
  item_id: z.string().optional(),
  rank_before: z.number().int().optional(),
  rank_after: z.number().int().optional(),
  score_before: z.number().optional(),
  score_after: z.number().optional(),
  entered_context_before: z.boolean().optional(),
  entered_context_after: z.boolean().optional(),
  details: z.record(z.string(), z.unknown()).default({}),
});

export type RetrievalChange = z.infer<typeof retrievalChangeSchema>;

export const retrievalDiffSchema = z.object({
  changes: z.array(retrievalChangeSchema).default([]),
});

export type RetrievalDiff = z.infer<typeof retrievalDiffSchema>;

// ── Memory Diff ─────────────────────────────────────────────────────────────

export const memoryChangeTypeSchema = z.enum([
  "MEMORY_RETRIEVAL_CHANGED",
  "MEMORY_VERSION_CHANGED",
  "MEMORY_ADDED_TO_CONTEXT",
  "MEMORY_REMOVED_FROM_CONTEXT",
  "MEMORY_WRITE_CHANGED",
]);

export type MemoryChangeType = z.infer<typeof memoryChangeTypeSchema>;

export const memoryChangeSchema = z.object({
  memory_id: z.string().optional(),
  change_type: memoryChangeTypeSchema,
  operation: z.enum(["read", "write", "search", "evict"]).optional(),
  version_before: z.string().optional(),
  version_after: z.string().optional(),
  details: z.record(z.string(), z.unknown()).default({}),
});

export type MemoryChange = z.infer<typeof memoryChangeSchema>;

export const memoryDiffSchema = z.object({
  changes: z.array(memoryChangeSchema).default([]),
});

export type MemoryDiff = z.infer<typeof memoryDiffSchema>;

// ── Plan Diff ───────────────────────────────────────────────────────────────

export const planChangeTypeSchema = z.enum([
  "PLAN_ADDED",
  "PLAN_REMOVED",
  "PLAN_ITEM_ADDED",
  "PLAN_ITEM_REMOVED",
  "PLAN_ITEM_CHANGED",
  "PLAN_STATUS_CHANGED",
  "PLAN_ORDER_CHANGED",
]);

export type PlanChangeType = z.infer<typeof planChangeTypeSchema>;

export const planItemChangeSchema = z.object({
  item_id: z.string(),
  change_type: planChangeTypeSchema,
  before_status: z.string().optional(),
  after_status: z.string().optional(),
  before_description: z.string().optional(),
  after_description: z.string().optional(),
});

export type PlanItemChange = z.infer<typeof planItemChangeSchema>;

export const planDiffSchema = z.object({
  plan_added: z.boolean().default(false),
  plan_removed: z.boolean().default(false),
  status_changed: z.boolean().default(false),
  before_status: z.string().optional(),
  after_status: z.string().optional(),
  changes: z.array(planItemChangeSchema).default([]),
});

export type PlanDiff = z.infer<typeof planDiffSchema>;

// ── Evidence Diff ───────────────────────────────────────────────────────────

export const testDiffSchema = z.object({
  test_id: z.string(),
  suite: z.string(),
  name: z.string(),
  change_type: z.enum(["TEST_STATUS_CHANGED", "TEST_ADDED", "TEST_REMOVED", "TEST_DURATION_DELTA"]),
  before_status: z.string().optional(),
  after_status: z.string().optional(),
  duration_delta_ms: z.number().optional(),
  failure_message_before: z.string().optional(),
  failure_message_after: z.string().optional(),
});

export type TestDiff = z.infer<typeof testDiffSchema>;

export const reviewFindingDiffSchema = z.object({
  severity: z.string(),
  category: z.string(),
  message: z.string(),
  change_type: z.enum(["FINDING_ADDED", "FINDING_REMOVED", "FINDING_MODIFIED"]),
});

export type ReviewFindingDiff = z.infer<typeof reviewFindingDiffSchema>;

export const reviewDiffSchema = z.object({
  review_id: z.string(),
  reviewer: z.string(),
  review_type: z.string(),
  change_type: z.enum(["REVIEW_STATUS_CHANGED", "FINDINGS_CHANGED", "REVIEW_ADDED", "REVIEW_REMOVED"]),
  before_status: z.string().optional(),
  after_status: z.string().optional(),
  findings_delta: z.number().int().default(0),
  findings_diff: z.array(reviewFindingDiffSchema).default([]),
});

export type ReviewDiff = z.infer<typeof reviewDiffSchema>;

export const verificationEventDiffSchema = z.object({
  event_id: z.string(),
  event_type: z.string(),
  target_type: z.string(),
  target_id: z.string().optional(),
  change_type: z.enum(["VERIFICATION_CHANGED", "VERIFICATION_ADDED", "VERIFICATION_REMOVED"]),
  before_status: z.string().optional(),
  after_status: z.string().optional(),
});

export type VerificationEventDiff = z.infer<typeof verificationEventDiffSchema>;

export const securityDiffSchema = z.object({
  event_id: z.string().optional(),
  action_id: z.string().optional(),
  tool_id: z.string().optional(),
  change_type: z.enum([
    "ACTION_ADDED",
    "ACTION_REMOVED",
    "PERMISSION_DECISION_CHANGED",
    "APPROVAL_REQUIREMENT_CHANGED",
    "APPROVAL_RESULT_CHANGED",
    "SIDE_EFFECT_BLOCK_CHANGED",
    "POLICY_VERSION_CHANGED",
    "SECURITY_VIOLATION_ADDED",
    "SECURITY_VIOLATION_REMOVED",
  ]),
  before_decision: z.string().optional(),
  after_decision: z.string().optional(),
  severity: comparisonSeveritySchema.default("warning"),
  details: z.record(z.string(), z.unknown()).default({}),
});

export type SecurityDiff = z.infer<typeof securityDiffSchema>;

export const artifactDiffSchema = z.object({
  name: z.string(),
  change_type: z.enum(["ARTIFACT_ADDED", "ARTIFACT_REMOVED", "ARTIFACT_MODIFIED", "ARTIFACT_HASH_CHANGED"]),
  before_uri: z.string().optional(),
  after_uri: z.string().optional(),
  before_hash: z.string().optional(),
  after_hash: z.string().optional(),
});

export type ArtifactDiff = z.infer<typeof artifactDiffSchema>;

export const evidenceDiffSchema = z.object({
  plan_diff: planDiffSchema.optional(),
  test_diffs: z.array(testDiffSchema).default([]),
  review_diffs: z.array(reviewDiffSchema).default([]),
  verification_diffs: z.array(verificationEventDiffSchema).default([]),
  security_diffs: z.array(securityDiffSchema).default([]),
  artifact_diffs: z.array(artifactDiffSchema).default([]),
});

export type EvidenceDiff = z.infer<typeof evidenceDiffSchema>;

// ── Metrics Diff & Directional Semantics ────────────────────────────────────

export const metricDirectionSchema = z.enum([
  "LOWER_IS_BETTER",
  "HIGHER_IS_BETTER",
  "CONTEXT_DEPENDENT",
]);

export type MetricDirection = z.infer<typeof metricDirectionSchema>;

export const metricEvaluationSchema = z.enum([
  "IMPROVED",
  "REGRESSED",
  "NEUTRAL",
  "CONTEXT_DEPENDENT",
]);

export type MetricEvaluation = z.infer<typeof metricEvaluationSchema>;

export const metricDeltaSchema = z.object({
  key: z.string(),
  direction: metricDirectionSchema,
  baseline: z.number(),
  candidate: z.number(),
  absolute_delta: z.number(),
  percent_delta: z.number().nullable().optional(),
  evaluation: metricEvaluationSchema,
});

export type MetricDelta = z.infer<typeof metricDeltaSchema>;

export const metricsDiffSchema = z.object({
  deltas: z.record(z.string(), metricDeltaSchema).default({}),
  cost_delta_usd: z.number().default(0),
  latency_delta_ms: z.number().default(0),
  tokens_delta: z.number().default(0),
});

export type MetricsDiff = z.infer<typeof metricsDiffSchema>;

// ── Outcome Diff ────────────────────────────────────────────────────────────

export const outcomeDiffSchema = z.object({
  baseline_status: z.string(),
  candidate_status: z.string(),
  status_changed: z.boolean(),
  baseline_verification_status: z.string().optional(),
  candidate_verification_status: z.string().optional(),
  summary: z.string().optional(),
  reason_code_changed: z.boolean().default(false),
  baseline_reason_code: z.string().optional(),
  candidate_reason_code: z.string().optional(),
});

export type OutcomeDiff = z.infer<typeof outcomeDiffSchema>;

// ── Semantic Text Comparator ────────────────────────────────────────────────

export const semanticRelationSchema = z.enum([
  "EQUIVALENT",
  "PARAPHRASE",
  "REFINED",
  "CONTRADICTORY",
  "DIVERGENT",
  "UNAVAILABLE",
]);

export type SemanticRelation = z.infer<typeof semanticRelationSchema>;

export const semanticComparisonResultSchema = z.object({
  semantic_relation: semanticRelationSchema,
  similarity: z.number().min(0).max(1),
  material_difference: z.boolean(),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  evaluator_name: z.string(),
  evaluator_version: z.string(),
  model_id: z.string().optional(),
});

export type SemanticComparisonResult = z.infer<typeof semanticComparisonResultSchema>;

export interface SemanticComparisonRequest {
  text_a: string;
  text_b: string;
  context_type?: "model_output" | "final_answer" | "plan_description" | "review_narrative" | "generic";
  metadata?: Record<string, unknown>;
}

export interface SemanticComparator {
  compareText(request: SemanticComparisonRequest): Promise<SemanticComparisonResult>;
}

// ── Comparison Verdict & Policy ─────────────────────────────────────────────

export const comparisonVerdictSchema = z.enum([
  "IMPROVED",
  "REGRESSED",
  "NEUTRAL",
  "MIXED",
  "INCONCLUSIVE",
]);

export type ComparisonVerdict = z.infer<typeof comparisonVerdictSchema>;

export const comparisonPolicySchema = z.object({
  policy_id: z.string().default("default"),
  version: z.string().default("1.0"),
  required_non_regression: z.array(z.string()).default(["task_success", "security_violations"]),
  weights: z.record(z.string(), z.number()).default({
    task_success: 0.5,
    security: 0.3,
    cost: 0.1,
    latency: 0.1,
  }),
});

export type ComparisonPolicy = z.infer<typeof comparisonPolicySchema>;

// ── Comparison Finding ──────────────────────────────────────────────────────

export const comparisonFindingSchema = z.object({
  finding_id: z.string(),
  category: z.string(),
  severity: comparisonSeveritySchema,
  title: z.string(),
  description: z.string(),
  causal_status: causalStatusSchema,
  evidence_refs: z.array(z.string()).default([]),
});

export type ComparisonFinding = z.infer<typeof comparisonFindingSchema>;

// ── Canonical RunComparison Artifact ────────────────────────────────────────

export const runComparisonSchema = z.object({
  comparison_id: z.string(),
  schema_version: z.string().regex(/^1\.\d+\.\d+.*$/, "Must be a valid 1.x version string"),
  baseline_run_id: z.string(),
  candidate_run_id: z.string(),
  project_id: z.string().optional(),
  relationship: runRelationshipSchema,
  created_at: z.string(),
  configuration_diff: configurationDiffSchema,
  execution_alignment: comparisonAlignmentSchema,
  divergences: z.array(comparisonDivergenceSchema).default([]),
  state_diffs: z.array(stateDiffSchema).default([]),
  context_diff: contextDiffSchema.optional(),
  memory_diff: memoryDiffSchema.optional(),
  retrieval_diff: retrievalDiffSchema.optional(),
  evidence_diff: evidenceDiffSchema,
  metrics_diff: metricsDiffSchema,
  outcome_diff: outcomeDiffSchema,
  first_structural_divergence: comparisonDivergenceSchema.optional(),
  first_meaningful_divergence: comparisonDivergenceSchema.optional(),
  semantic_comparisons: z.record(z.string(), semanticComparisonResultSchema).default({}),
  findings: z.array(comparisonFindingSchema).default([]),
  interpretation: z.string().optional(),
  verdict: comparisonVerdictSchema.default("INCONCLUSIVE"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RunComparison = z.infer<typeof runComparisonSchema>;
