/**
 * Visual Execution Canvas — generic visual graph model.
 *
 * VisualRunGraph is derived from RunGraph (itself derived from RunRecord,
 * TraceEvents, ToolCalls, EvalResults, and an optional WorkflowSpec). It
 * re-shapes that data into a vocabulary a node-based canvas can render
 * directly: primary workflow nodes, attached evidence nodes, groups, and
 * typed edges — with no project_id or workflow_id branching.
 */

import type { TraceEvent } from "@/lib/proof-layer/schemas";
import type { RunGraphSummary } from "@/lib/runs/runGraph";

// ── Node vocabulary ───────────────────────────────────────────────────────────

export type VisualNodeType =
  | "stage"
  | "agent"
  | "model"
  | "tool"
  | "skill"
  | "cli"
  | "eval"
  | "artifact"
  | "issue"
  | "recovery";

export type VisualNodeStatus =
  | "not_observed"
  | "running"
  | "completed"
  | "warning"
  | "failed"
  | "recovered";

export type VisualEdgeType =
  | "workflow"
  | "uses"
  | "produces"
  | "evaluates"
  | "fails"
  | "recovers"
  | "contains";

/** Where a node sits relative to the primary workflow path. */
export type VisualNodeKind = "primary" | "internal" | "evidence";

// ── Evidence counts (primary/internal nodes only) ─────────────────────────────

export interface VisualEvidenceCounts {
  models: number;
  tools: number;
  evals: number;
  skills: number;
  cli: number;
  artifacts: number;
  issues: number;
}

export type VisualModelProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "meta"
  | "mistral"
  | "local"
  | "mock"
  | "unknown";

export type VisualToolSubtype =
  | "web_search"
  | "webpage_extract"
  | "browser"
  | "filesystem"
  | "database"
  | "github"
  | "http_api"
  | "scraper"
  | "validator"
  | "unknown_tool";

export type VisualEvalSubtype =
  | "quality"
  | "factuality"
  | "publishability"
  | "contract"
  | "safety"
  | "source_evidence"
  | "unknown_eval";

export type VisualArtifactType =
  | "markdown"
  | "json"
  | "report"
  | "file"
  | "image"
  | "dataset"
  | "unknown_artifact";

export interface VisualNodeIdentity {
  title: string;
  typeLabel: string;
  badge?: string;
  provider?: VisualModelProvider;
  providerLabel?: string;
  modelName?: string;
  toolName?: string;
  toolSubtype?: VisualToolSubtype;
  skillName?: string;
  skillSubtype?: string;
  commandSummary?: string;
  evalName?: string;
  evalSubtype?: VisualEvalSubtype;
  artifactName?: string;
  artifactType?: VisualArtifactType;
}

export interface VisualNodeMetrics {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  costUsd?: number;
  retryCount?: number;
  errorCount?: number;
  score?: number;
  passed?: boolean;
  threshold?: number;
  sizeBytes?: number;
  contentStatus?: string;
  reason?: string;
  producingStageId?: string;
}

// ── Nodes ─────────────────────────────────────────────────────────────────────

export interface VisualNode {
  id: string;
  type: VisualNodeType;
  kind: VisualNodeKind;
  label: string;
  status: VisualNodeStatus;
  order: number;
  groupId: string;
  /** Set for evidence nodes — the id of the primary/internal node they're attached to. */
  parentId?: string;
  identity: VisualNodeIdentity;
  metrics: VisualNodeMetrics;
  metadata?: Record<string, unknown>;
  durationMs?: number;
  costUsd?: number;
  inputSummary?: string;
  outputSummary?: string;
  /** One-line detail for evidence nodes (e.g. attachment output summary). */
  detail?: string;
  /** True when an issue evidence node was recovered later in the same stage. */
  recovered?: boolean;
  /** Primary/internal nodes only — counts of attached evidence by kind. */
  evidenceCounts?: VisualEvidenceCounts;
  /** Primary/internal nodes only — ids of upstream/downstream primary nodes. */
  upstreamIds?: string[];
  downstreamIds?: string[];
  /** Raw trace events relevant to this node, for inspector detail. */
  rawEvents: TraceEvent[];
}

// ── Edges ─────────────────────────────────────────────────────────────────────

export interface VisualEdge {
  id: string;
  from: string;
  to: string;
  type: VisualEdgeType;
  label?: string;
}

// ── Groups (lanes/clusters) ────────────────────────────────────────────────────

export interface VisualGroup {
  id: string;
  label: string;
  order: number;
  nodeIds: string[];
}

// ── Top-level VisualRunGraph ───────────────────────────────────────────────────

export interface VisualRunGraph {
  workflowId: string;
  projectId: string;
  mode: "registered_spec" | "inferred";
  templateName?: string;
  groups: VisualGroup[];
  /** Stage/agent nodes that form the primary, obvious workflow path. */
  primaryNodes: VisualNode[];
  /** Observed nodes not declared in the spec — kept out of the primary path. */
  internalNodes: VisualNode[];
  /** Model/tool/skill/cli/eval/artifact/issue/recovery nodes attached to a primary or internal node. */
  evidenceNodes: VisualNode[];
  /** Edges between primary nodes only. */
  edges: VisualEdge[];
  /** Edges from a primary/internal node to its attached evidence nodes. */
  evidenceEdges: VisualEdge[];
  summary: RunGraphSummary;
}
