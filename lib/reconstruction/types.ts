/**
 * lib/reconstruction/types.ts
 *
 * Types for Static-to-Proof Reconstruction.
 *
 * Reeprov reconstructs a best-effort proof-layer architecture from a static
 * ScanReport — no code execution, no external API calls, no repo changes required.
 *
 * Two levels of proof:
 *   1. Static reconstruction  — inferred from repo files; always available
 *   2. Runtime proof          — optional; requires ReeprovClient instrumentation
 */

import type { WorkflowSpec } from "@/lib/proof-layer/schemas";

// ── Confidence ────────────────────────────────────────────────────────────────

export type ReconstructionConfidence = "high" | "medium" | "low";

// ── SuggestedWorkflowSpec ──────────────────────────────────────────────────────

/** A WorkflowSpec that is augmented with reconstruction metadata. */
export interface SuggestedWorkflowSpec extends WorkflowSpec {
  /** Where the spec evidence came from. */
  source:
    | "manifest"          // explicit workflow manifest (workflow.yaml, agents.yaml, etc.)
    | "framework_adapter" // recognized framework pattern (LangGraph, CrewAI, etc.)
    | "path_inference"    // inferred from directory/file structure
    | "readme_inference"  // inferred from README or documentation content
    | "mixed";            // combination of sources
  confidence: ReconstructionConfidence;
  /** Files that provided evidence for this spec. */
  evidencePaths: string[];
  /** Fields that could not be inferred and were left as defaults. */
  missingFields: string[];
  /** Per-spec recommendations to improve the manifest. */
  recommendations: string[];
}

// ── MappingSummary ─────────────────────────────────────────────────────────────

export interface MappingSummary {
  agents: {
    total: number;
    mappedToPrompts: number;
    mappedToTools: number;
    mappedToEvals: number;
    mappedToModels: number;
  };
  workflows: {
    total: number;
    withStages: number;
    stagesMappedToAgents: number;
    stagesMappedToPrompts: number;
    stagesMappedToTools: number;
    stagesMappedToEvals: number;
    stagesMappedToModels: number;
  };
  prompts: {
    total: number;
    mapped: number;
    unmapped: number;
  };
  tools: {
    total: number;
    mapped: number;
    withPermissionClass: number;
    requiringApproval: number;
  };
  evals: {
    total: number;
    mapped: number;
    unmapped: number;
  };
  models: {
    total: number;
    mapped: number;
    unmapped: number;
  };
}

// ── MissingLink ────────────────────────────────────────────────────────────────

export type MissingLinkType =
  | "agent_missing_prompt"
  | "agent_missing_tools"
  | "agent_missing_evals"
  | "agent_missing_model"
  | "workflow_missing_stages"
  | "stage_missing_agent"
  | "stage_missing_prompt"
  | "stage_missing_tools"
  | "stage_missing_evals"
  | "stage_missing_model"
  | "tool_missing_permission_class"
  | "tool_missing_approval_policy"
  | "eval_unmapped"
  | "prompt_unmapped"
  | "model_unmapped";

export interface MissingLink {
  id: string;
  severity: "info" | "low" | "medium" | "high";
  type: MissingLinkType;
  targetId: string;
  targetLabel: string;
  evidencePaths: string[];
  recommendation: string;
}

// ── SuggestedManifestFile ──────────────────────────────────────────────────────

export interface SuggestedManifestFile {
  path: string;
  format: "json" | "yaml" | "markdown";
  purpose: string;
  /** The generated file content — clearly marked as a suggestion. */
  content: string;
}

// ── InstrumentationPlan ────────────────────────────────────────────────────────

export interface InstrumentationPlanEvent {
  stageId: string;
  events: string[];
}

export interface InstrumentationPlan {
  /** Instrumentation is never required — Reeprov works without it. */
  required: false;
  /** The ReeprovClient is available if the project wants runtime proof. */
  available: true;
  summary: string;
  recommendedEnvVars: string[];
  suggestedEvents: InstrumentationPlanEvent[];
  /** Human-readable hints about where in the codebase to add trace calls. */
  codeHints: string[];
}

// ── ReconstructedSystemGraph ───────────────────────────────────────────────────

/** A simplified graph used for reconstruction display (lighter than SystemGraph). */
export interface ReconstructedNode {
  id: string;
  label: string;
  type:
    | "agent"
    | "workflow"
    | "stage"
    | "prompt"
    | "tool"
    | "eval"
    | "model"
    | "approval_gate"
    | "artifact";
  confidence: ReconstructionConfidence;
  sourcePath?: string;
  missingLinks?: MissingLinkType[];
}

export interface ReconstructedEdge {
  from: string;
  to: string;
  type: string;
  confidence: ReconstructionConfidence;
}

export interface ReconstructedSystemGraph {
  nodes: ReconstructedNode[];
  edges: ReconstructedEdge[];
}

// ── StaticProofReconstruction ─────────────────────────────────────────────────

/**
 * The full reconstruction result produced from a ScanReport.
 *
 * Static reconstruction is always a best-effort inference — confidence levels
 * indicate how much evidence was available. It does not require or imply any
 * changes to the scanned repository.
 */
export interface StaticProofReconstruction {
  reconstructionId: string;
  /** The ScanReport this reconstruction was derived from. */
  reportId: string;
  projectId: string;
  sourceReportVersion: string;
  generatedAt: string;
  /** Always "static_inference" — this is not a runtime record. */
  mode: "static_inference";
  /** Overall confidence in the reconstruction. */
  confidence: ReconstructionConfidence;
  /** The suggested WorkflowSpec(s) derived from the scan. */
  workflowSpecs: SuggestedWorkflowSpec[];
  /** Reconstructed graph (lightweight — used for UI rendering). */
  systemGraph: ReconstructedSystemGraph;
  /** Mapping coverage summary. */
  mappingSummary: MappingSummary;
  /** Unmapped or disconnected artifacts. */
  missingLinks: MissingLink[];
  /** Ready-to-use manifest/spec file suggestions. */
  suggestedFiles: SuggestedManifestFile[];
  /** Optional instrumentation guide (clearly non-required). */
  instrumentationPlan: InstrumentationPlan;
}
