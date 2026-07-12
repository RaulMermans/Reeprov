/**
 * Integration Workflow Blueprint types.
 *
 * A blueprint is an aggregate, integration-level view of what a connected
 * project's workflow generally looks like across its recent runs — stable
 * stages, common tools/models/evals/artifacts/issues, recent health, and
 * whether the shape is WorkflowSpec-backed or inferred from observed runs.
 *
 * This is distinct from a single-run RunGraph/VisualRunGraph: it summarizes
 * across a bounded window of recent runs instead of rendering every raw
 * trace event from one run. No project_id/workflow_id branching — every
 * field here is derived generically from RunGraph output.
 */

// ── Mode ──────────────────────────────────────────────────────────────────────

export type IntegrationBlueprintMode =
  | "registered_spec"
  | "inferred_from_runs"
  | "insufficient_data";

// ── Node vocabulary — mirrors VisualRunGraph's node/edge vocabulary ──────────

export type IntegrationBlueprintNodeType =
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

export type IntegrationBlueprintEdgeType =
  | "workflow"
  | "uses"
  | "produces"
  | "evaluates"
  | "fails"
  | "recovers"
  | "contains";

// ── Status summary ────────────────────────────────────────────────────────────

export interface IntegrationBlueprintStatusSummary {
  observedRuns: number;
  completedRuns: number;
  warningRuns: number;
  failedRuns: number;
  recoveredRuns: number;
}

export function emptyStatusSummary(): IntegrationBlueprintStatusSummary {
  return { observedRuns: 0, completedRuns: 0, warningRuns: 0, failedRuns: 0, recoveredRuns: 0 };
}

// ── Examples ───────────────────────────────────────────────────────────────────

export interface IntegrationBlueprintExample {
  runId: string;
  eventId?: string;
  summary?: string;
}

/** Max examples retained per node — keeps the payload bounded, not a raw event dump. */
export const MAX_EXAMPLES_PER_NODE = 3;

// ── Nodes ─────────────────────────────────────────────────────────────────────

export interface IntegrationBlueprintNode {
  id: string;
  type: IntegrationBlueprintNodeType;
  /** "primary" = a workflow stage; "evidence" = a model/tool/skill/cli/eval/artifact/issue/recovery attached to one or more stages. */
  role: "primary" | "evidence";
  label: string;
  /** Stable ordering hint (spec order in registered_spec mode, first-observed order otherwise). */
  order: number;
  statusSummary: IntegrationBlueprintStatusSummary;
  /** Number of sampled runs in which this node was actually observed. */
  frequency: number;
  lastSeenAt?: string;
  /** Small, curated, non-sensitive fields only — never a raw metadata dump. */
  commonMetadata?: Record<string, unknown>;
  examples: IntegrationBlueprintExample[];
  /** Evidence nodes only — stage ids this evidence was attached to across the sampled runs. */
  parentIds?: string[];
}

// ── Edges ─────────────────────────────────────────────────────────────────────

export interface IntegrationBlueprintEdge {
  id: string;
  source: string;
  target: string;
  type: IntegrationBlueprintEdgeType;
  frequency: number;
  lastSeenAt?: string;
}

// ── Evidence summary ───────────────────────────────────────────────────────────

export interface IntegrationEvidenceCount {
  label: string;
  count: number;
}

export interface IntegrationEvidenceSummary {
  modelCount: number;
  toolCount: number;
  skillCount: number;
  evalCount: number;
  artifactCount: number;
  issueCount: number;
  recoveryCount: number;
  topModels: IntegrationEvidenceCount[];
  topTools: IntegrationEvidenceCount[];
  topEvals: IntegrationEvidenceCount[];
  topArtifacts: IntegrationEvidenceCount[];
  topIssues: IntegrationEvidenceCount[];
}

export function emptyEvidenceSummary(): IntegrationEvidenceSummary {
  return {
    modelCount: 0,
    toolCount: 0,
    skillCount: 0,
    evalCount: 0,
    artifactCount: 0,
    issueCount: 0,
    recoveryCount: 0,
    topModels: [],
    topTools: [],
    topEvals: [],
    topArtifacts: [],
    topIssues: [],
  };
}

// ── Health summary ─────────────────────────────────────────────────────────────

export interface IntegrationHealthSummary {
  /** Number of runs the blueprint was built from (the sampled window, not lifetime total). */
  runCount: number;
  completedCount: number;
  degradedCount: number;
  failedCount: number;
  /** Number of sampled runs that contained at least one recovered issue. */
  recoveredCount: number;
  lastRunAt?: string;
  lastEventAt?: string;
  commonFailureModes: IntegrationEvidenceCount[];
}

export function emptyHealthSummary(): IntegrationHealthSummary {
  return {
    runCount: 0,
    completedCount: 0,
    degradedCount: 0,
    failedCount: 0,
    recoveredCount: 0,
    commonFailureModes: [],
  };
}

// ── Diagnostics summary ─────────────────────────────────────────────────────────

export interface IntegrationDiagnosticsSummary {
  recentErrorCount: number;
  categories: IntegrationEvidenceCount[];
}

// ── Top-level blueprint ─────────────────────────────────────────────────────────

export interface IntegrationWorkflowBlueprint {
  integrationId: string;
  projectId: string;
  workflowIds: string[];
  mode: IntegrationBlueprintMode;
  generatedFromRunIds: string[];
  runWindow: {
    count: number;
    from?: string;
    to?: string;
  };
  nodes: IntegrationBlueprintNode[];
  edges: IntegrationBlueprintEdge[];
  evidenceSummary: IntegrationEvidenceSummary;
  healthSummary: IntegrationHealthSummary;
  diagnosticsSummary?: IntegrationDiagnosticsSummary;
  generatedAt: string;
}
