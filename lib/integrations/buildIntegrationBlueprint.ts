/**
 * Integration Workflow Blueprint builder.
 *
 * Aggregates a bounded window of recent runs (already loaded by the caller)
 * plus an optional registered WorkflowSpec into a generic, integration-level
 * IntegrationWorkflowBlueprint: stable stages, common evidence, recent health,
 * and common failure/recovery patterns.
 *
 * Pure and deterministic — no I/O. Reuses buildRunGraph per run so this
 * module never re-derives stage grouping, issue extraction, or attachment
 * logic; it only aggregates RunGraph output across runs. No project_id or
 * workflow_id branching — every field is derived generically from RunGraph
 * node ids, types, statuses, and attachments.
 */

import type { SavedRun } from "@/lib/runs/runTypes";
import type { WorkflowSpec } from "@/lib/proof-layer/schemas";
import { buildRunGraph } from "@/lib/runs/runGraph";
import type {
  RunGraph,
  RunGraphAttachment,
  RunGraphAttachmentKind,
  RunGraphNodeType,
} from "@/lib/runs/runGraph";
import {
  emptyEvidenceSummary,
  emptyHealthSummary,
  MAX_EXAMPLES_PER_NODE,
} from "@/lib/integrations/integrationBlueprintTypes";
import type {
  IntegrationBlueprintEdge,
  IntegrationBlueprintEdgeType,
  IntegrationBlueprintExample,
  IntegrationBlueprintMode,
  IntegrationBlueprintNode,
  IntegrationBlueprintNodeType,
  IntegrationBlueprintStatusSummary,
  IntegrationDiagnosticsSummary,
  IntegrationEvidenceCount,
  IntegrationWorkflowBlueprint,
} from "@/lib/integrations/integrationBlueprintTypes";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default bounded run window used by callers when loading recent runs for a blueprint. */
export const DEFAULT_BLUEPRINT_RUN_WINDOW = 10;

const TOP_N = 5;

// ── Small pure helpers ─────────────────────────────────────────────────────────

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

function normalizeMessage(msg: string): string {
  return msg.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
}

function safeSummary(text: string | undefined, maxLen = 160): string | undefined {
  if (!text) return undefined;
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;
  return collapsed.length > maxLen ? `${collapsed.slice(0, maxLen - 1)}…` : collapsed;
}

function latestTimestamp(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function runTimestamp(run: SavedRun): string | undefined {
  return run.runRecord.completed_at ?? run.runRecord.started_at;
}

function topN(counts: Map<string, number>, n: number): IntegrationEvidenceCount[] {
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

// ── Stage-level node type mapping (mirrors buildVisualRunGraph's primary map) ──

const PRIMARY_TYPE_MAP: Record<RunGraphNodeType, IntegrationBlueprintNodeType> = {
  stage: "stage",
  agent: "agent",
  model_call: "model",
  tool_call: "tool",
  skill: "skill",
  eval: "eval",
  artifact: "artifact",
  issue: "issue",
  unknown: "stage",
};

// ── Evidence (attachment) type/edge mapping (mirrors ATTACHMENT_TYPE_MAP) ─────

const EVIDENCE_TYPE_MAP: Record<RunGraphAttachmentKind, { type: IntegrationBlueprintNodeType; edge: IntegrationBlueprintEdgeType }> = {
  model_call: { type: "model", edge: "uses" },
  tool_call: { type: "tool", edge: "uses" },
  skill: { type: "skill", edge: "uses" },
  cli: { type: "cli", edge: "uses" },
  eval: { type: "eval", edge: "evaluates" },
  artifact: { type: "artifact", edge: "produces" },
  issue: { type: "issue", edge: "fails" },
  agent: { type: "agent", edge: "contains" },
};

function evidenceGroupingLabel(attachment: RunGraphAttachment): string {
  if (attachment.kind === "issue") return normalizeMessage(attachment.label);
  return attachment.label;
}

function evidenceStatusBucket(attachment: RunGraphAttachment): "completed" | "warning" | "failed" | undefined {
  if (attachment.kind === "issue") {
    if (attachment.recovered) return undefined; // counted via recoveredRuns instead
    return attachment.status === "critical" || attachment.status === "fail" ? "failed" : "warning";
  }
  if (attachment.kind === "eval") return attachment.status === "passed" ? "completed" : "failed";
  switch (attachment.status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "blocked":
    case "degraded":
      return "warning";
    default:
      return undefined;
  }
}

function evidenceCommonMetadata(attachment: RunGraphAttachment, type: IntegrationBlueprintNodeType): Record<string, unknown> | undefined {
  if (type === "model") {
    const provider = attachment.metadata?.["model_provider"];
    return typeof provider === "string" ? { provider } : undefined;
  }
  if (type === "tool") {
    const permissionClass = attachment.metadata?.["permission_class"];
    return typeof permissionClass === "string" ? { permissionClass } : undefined;
  }
  if (type === "eval") {
    const evalType = attachment.metadata?.["eval_type"];
    return typeof evalType === "string" ? { evalType } : undefined;
  }
  if (type === "issue" || type === "recovery") {
    return typeof attachment.status === "string" ? { severity: attachment.status } : undefined;
  }
  return undefined;
}

// ── Internal aggregation entries ────────────────────────────────────────────────

interface NodeAgg {
  id: string;
  type: IntegrationBlueprintNodeType;
  label: string;
  order: number;
  statusSummary: IntegrationBlueprintStatusSummary;
  runIdsObserved: Set<string>;
  occurrenceCount: number;
  lastSeenAt?: string;
  commonMetadata?: Record<string, unknown>;
  examples: IntegrationBlueprintExample[];
  parentIds: Set<string>;
}

interface EdgeAgg {
  id: string;
  source: string;
  target: string;
  type: IntegrationBlueprintEdgeType;
  frequency: number;
  lastSeenAt?: string;
}

function newNodeAgg(id: string, type: IntegrationBlueprintNodeType, label: string, order: number): NodeAgg {
  return {
    id,
    type,
    label,
    order,
    statusSummary: { observedRuns: 0, completedRuns: 0, warningRuns: 0, failedRuns: 0, recoveredRuns: 0 },
    runIdsObserved: new Set(),
    occurrenceCount: 0,
    examples: [],
    parentIds: new Set(),
  };
}

function addExample(entry: NodeAgg, runId: string, summary: string | undefined, eventId?: string): void {
  if (entry.examples.length >= MAX_EXAMPLES_PER_NODE) return;
  if (entry.examples.some((e) => e.runId === runId)) return;
  entry.examples.push({ runId, eventId, summary });
}

// ── Builder input ─────────────────────────────────────────────────────────────

export interface BuildIntegrationBlueprintParams {
  integrationId: string;
  projectId: string;
  /** Most-recent-first, already bounded by the caller (see DEFAULT_BLUEPRINT_RUN_WINDOW). */
  runs: SavedRun[];
  workflowSpec?: WorkflowSpec;
  lastEventAt?: string;
  /** Already-redacted diagnostics; category + timestamp only. */
  diagnostics?: Array<{ category: string; createdAt: string }>;
}

// ── Main builder ──────────────────────────────────────────────────────────────

export function buildIntegrationBlueprint(params: BuildIntegrationBlueprintParams): IntegrationWorkflowBlueprint {
  const { integrationId, projectId, runs, workflowSpec, lastEventAt, diagnostics } = params;

  const hasSpec = Boolean(workflowSpec && workflowSpec.nodes.length > 0);
  const mode: IntegrationBlueprintMode = hasSpec
    ? "registered_spec"
    : runs.length > 0
    ? "inferred_from_runs"
    : "insufficient_data";

  const stageNodes = new Map<string, NodeAgg>();
  const evidenceNodes = new Map<string, NodeAgg>();
  const workflowEdges = new Map<string, EdgeAgg>();
  const evidenceEdges = new Map<string, EdgeAgg>();
  let evidenceOrderCounter = 100000;

  // Seed the full declared stage set (and declared edges) so a registered
  // spec always shows its complete shape, even for stages never yet observed.
  if (hasSpec && workflowSpec) {
    const specOrder = workflowSpec.expected_order ?? workflowSpec.nodes.map((n) => n.id);
    const orderIndex = new Map(specOrder.map((id, i) => [id, i]));
    for (const node of workflowSpec.nodes) {
      const type = PRIMARY_TYPE_MAP[
        node.type === "agent" ? "agent" :
        node.type === "tool" ? "tool_call" :
        node.type === "evaluator" ? "eval" :
        node.type === "artifact" ? "artifact" :
        node.type === "llm" ? "model_call" :
        "stage"
      ];
      stageNodes.set(node.id, newNodeAgg(node.id, type, node.label, orderIndex.get(node.id) ?? stageNodes.size));
    }
    for (const edge of workflowSpec.edges ?? []) {
      const id = `workflow::${edge.from}--${edge.to}`;
      workflowEdges.set(id, { id, source: edge.from, target: edge.to, type: "workflow", frequency: 0 });
    }
  }

  const failureModeCounts = new Map<string, { label: string; count: number }>();
  let completedCount = 0;
  let degradedCount = 0;
  let failedCount = 0;
  let recoveredRunCount = 0;

  for (const run of runs) {
    const runId = run.runRecord.run_id;
    const ts = runTimestamp(run);

    if (run.runRecord.status === "completed") completedCount++;
    else if (run.runRecord.status === "degraded") degradedCount++;
    else if (run.runRecord.status === "failed") failedCount++;

    const runGraph: RunGraph = buildRunGraph({
      runRecord: run.runRecord,
      traceEvents: run.traceEvents,
      toolCalls: run.toolCalls,
      evalResults: run.evalResults,
      specNodes: workflowSpec?.nodes,
      specEdges: workflowSpec?.edges,
      templateName: workflowSpec?.name,
    });

    if (runGraph.issues.some((issue) => issue.recovered)) recoveredRunCount++;
    for (const issue of runGraph.issues) {
      const key = `${issue.stageId ?? ""}::${normalizeMessage(issue.message)}`;
      const existing = failureModeCounts.get(key);
      if (existing) existing.count++;
      else failureModeCounts.set(key, { label: issue.message, count: 1 });
    }

    // Stage nodes (primary + internal/extra).
    for (const node of [...runGraph.nodes, ...runGraph.extraNodes]) {
      let entry = stageNodes.get(node.id);
      if (!entry) {
        entry = newNodeAgg(node.id, PRIMARY_TYPE_MAP[node.type] ?? "stage", node.label, node.order);
        stageNodes.set(node.id, entry);
      } else {
        entry.order = Math.min(entry.order, node.order);
      }

      if (node.status === "not_observed") continue;

      entry.runIdsObserved.add(runId);
      entry.occurrenceCount++;
      entry.statusSummary.observedRuns = entry.runIdsObserved.size;
      if (node.status === "completed") entry.statusSummary.completedRuns++;
      else if (node.status === "warning") entry.statusSummary.warningRuns++;
      else if (node.status === "failed") entry.statusSummary.failedRuns++;
      if (node.attachments.some((a) => a.kind === "issue" && a.recovered)) {
        entry.statusSummary.recoveredRuns++;
      }
      entry.lastSeenAt = latestTimestamp(entry.lastSeenAt, ts);
      addExample(entry, runId, safeSummary(node.outputSummary ?? node.inputSummary));

      // Stage-to-evidence attachments.
      for (const attachment of node.attachments) {
        const mapping = EVIDENCE_TYPE_MAP[attachment.kind];
        const isRecovery = attachment.kind === "issue" && attachment.recovered === true;
        const type: IntegrationBlueprintNodeType = isRecovery ? "recovery" : mapping.type;
        const edgeType: IntegrationBlueprintEdgeType = isRecovery ? "recovers" : mapping.edge;
        const label = evidenceGroupingLabel(attachment);
        const evidenceId = `${type}::${slugify(label)}`;

        let evidenceEntry = evidenceNodes.get(evidenceId);
        if (!evidenceEntry) {
          evidenceEntry = newNodeAgg(evidenceId, type, attachment.kind === "issue" ? attachment.label : label, evidenceOrderCounter++);
          evidenceNodes.set(evidenceId, evidenceEntry);
        }
        evidenceEntry.runIdsObserved.add(runId);
        evidenceEntry.parentIds.add(node.id);
        evidenceEntry.occurrenceCount++;
        evidenceEntry.statusSummary.observedRuns = evidenceEntry.runIdsObserved.size;
        const bucket = evidenceStatusBucket(attachment);
        if (bucket === "completed") evidenceEntry.statusSummary.completedRuns++;
        else if (bucket === "warning") evidenceEntry.statusSummary.warningRuns++;
        else if (bucket === "failed") evidenceEntry.statusSummary.failedRuns++;
        if (isRecovery) evidenceEntry.statusSummary.recoveredRuns++;
        evidenceEntry.lastSeenAt = latestTimestamp(evidenceEntry.lastSeenAt, ts);
        if (!evidenceEntry.commonMetadata) {
          evidenceEntry.commonMetadata = evidenceCommonMetadata(attachment, type);
        }
        addExample(evidenceEntry, runId, safeSummary(attachment.detail ?? attachment.outputSummary ?? attachment.label), attachment.rawEvents[0]?.event_id);

        const evEdgeId = `${node.id}::${edgeType}::${evidenceId}`;
        const evEdge = evidenceEdges.get(evEdgeId) ?? { id: evEdgeId, source: node.id, target: evidenceId, type: edgeType, frequency: 0 };
        evEdge.frequency++;
        evEdge.lastSeenAt = latestTimestamp(evEdge.lastSeenAt, ts);
        evidenceEdges.set(evEdgeId, evEdge);
      }
    }

    // Stage-to-stage workflow edges.
    for (const edge of runGraph.edges) {
      const id = `workflow::${edge.from}--${edge.to}`;
      const entry = workflowEdges.get(id) ?? { id, source: edge.from, target: edge.to, type: "workflow" as const, frequency: 0 };
      entry.frequency++;
      entry.lastSeenAt = latestTimestamp(entry.lastSeenAt, ts);
      workflowEdges.set(id, entry);
    }
  }

  // ── Convert aggregation maps into public node/edge arrays ──────────────────

  function toPublicNode(entry: NodeAgg, role: "primary" | "evidence", frequencyOverride?: number): IntegrationBlueprintNode {
    return {
      id: entry.id,
      type: entry.type,
      role,
      label: entry.label,
      order: entry.order,
      statusSummary: entry.statusSummary,
      frequency: frequencyOverride ?? entry.runIdsObserved.size,
      lastSeenAt: entry.lastSeenAt,
      commonMetadata: entry.commonMetadata,
      examples: entry.examples,
      parentIds: role === "evidence" ? [...entry.parentIds] : undefined,
    };
  }

  const nodes: IntegrationBlueprintNode[] = [
    ...[...stageNodes.values()].map((e) => toPublicNode(e, "primary")),
    // Evidence node "frequency" reflects total occurrences (how often it was used),
    // not just distinct-run presence — more informative for tools/models/evals.
    ...[...evidenceNodes.values()].map((e) => toPublicNode(e, "evidence", e.occurrenceCount)),
  ].sort((a, b) => a.order - b.order);

  const edges: IntegrationBlueprintEdge[] = [
    ...[...workflowEdges.values()],
    ...[...evidenceEdges.values()],
  ].map((e) => ({ id: e.id, source: e.source, target: e.target, type: e.type, frequency: e.frequency, lastSeenAt: e.lastSeenAt }));

  // ── Evidence summary ─────────────────────────────────────────────────────────

  const evidenceSummary = emptyEvidenceSummary();
  const countsByType: Record<string, Map<string, number>> = {
    model: new Map(), tool: new Map(), skill: new Map(), eval: new Map(), artifact: new Map(), issue: new Map(),
  };
  for (const e of evidenceNodes.values()) {
    if (e.type === "model") evidenceSummary.modelCount++;
    else if (e.type === "tool") evidenceSummary.toolCount++;
    else if (e.type === "skill") evidenceSummary.skillCount++;
    else if (e.type === "eval") evidenceSummary.evalCount++;
    else if (e.type === "artifact") evidenceSummary.artifactCount++;
    else if (e.type === "issue") evidenceSummary.issueCount++;
    else if (e.type === "recovery") evidenceSummary.recoveryCount++;

    const bucket = countsByType[e.type];
    if (bucket) bucket.set(e.label, e.occurrenceCount);
  }
  evidenceSummary.topModels = topN(countsByType["model"]!, TOP_N);
  evidenceSummary.topTools = topN(countsByType["tool"]!, TOP_N);
  evidenceSummary.topEvals = topN(countsByType["eval"]!, TOP_N);
  evidenceSummary.topArtifacts = topN(countsByType["artifact"]!, TOP_N);
  evidenceSummary.topIssues = topN(countsByType["issue"]!, TOP_N);

  // ── Health summary ───────────────────────────────────────────────────────────

  const healthSummary = emptyHealthSummary();
  healthSummary.runCount = runs.length;
  healthSummary.completedCount = completedCount;
  healthSummary.degradedCount = degradedCount;
  healthSummary.failedCount = failedCount;
  healthSummary.recoveredCount = recoveredRunCount;
  healthSummary.lastEventAt = lastEventAt;
  healthSummary.lastRunAt = runs.reduce<string | undefined>((latest, r) => latestTimestamp(latest, runTimestamp(r)), undefined);
  healthSummary.commonFailureModes = [...failureModeCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_N)
    .map(({ label, count }) => ({ label, count }));

  // ── Diagnostics summary ──────────────────────────────────────────────────────

  let diagnosticsSummary: IntegrationDiagnosticsSummary | undefined;
  if (diagnostics) {
    const categoryCounts = new Map<string, number>();
    for (const d of diagnostics) {
      categoryCounts.set(d.category, (categoryCounts.get(d.category) ?? 0) + 1);
    }
    diagnosticsSummary = {
      recentErrorCount: diagnostics.length,
      categories: topN(categoryCounts, TOP_N),
    };
  }

  // ── Run window + workflow ids ────────────────────────────────────────────────

  let from: string | undefined;
  let to: string | undefined;
  for (const run of runs) {
    const started = run.runRecord.started_at;
    const completed = run.runRecord.completed_at ?? run.runRecord.started_at;
    if (started && (!from || started < from)) from = started;
    if (completed && (!to || completed > to)) to = completed;
  }

  const workflowIds: string[] = [];
  if (workflowSpec?.workflow_id) workflowIds.push(workflowSpec.workflow_id);
  for (const run of runs) {
    if (!workflowIds.includes(run.runRecord.workflow_id)) workflowIds.push(run.runRecord.workflow_id);
  }

  return {
    integrationId,
    projectId,
    workflowIds,
    mode,
    generatedFromRunIds: runs.map((r) => r.runRecord.run_id),
    runWindow: { count: runs.length, from, to },
    nodes,
    edges,
    evidenceSummary,
    healthSummary,
    diagnosticsSummary,
    generatedAt: new Date().toISOString(),
  };
}
