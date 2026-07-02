/**
 * Builds a VisualRunGraph from a RunGraph (+ the raw TraceEvents used to
 * build it). Pure and deterministic — no I/O, no project_id or workflow_id
 * branching. RunGraph already aggregates RunRecord, TraceEvents, ToolCalls,
 * EvalResults, and an optional WorkflowSpec; this module only re-shapes that
 * data into the generic visual vocabulary a node-based canvas can render.
 */

import type { TraceEvent } from "@/lib/proof-layer/schemas";
import type {
  RunGraph,
  RunGraphAttachment,
  RunGraphAttachmentKind,
  RunGraphNode,
  RunGraphNodeStatus,
  RunGraphNodeType,
} from "@/lib/runs/runGraph";
import type {
  VisualEdge,
  VisualEdgeType,
  VisualEvidenceCounts,
  VisualGroup,
  VisualNode,
  VisualNodeKind,
  VisualNodeType,
  VisualRunGraph,
} from "@/lib/visualGraph/types";
import {
  resolveEvidenceIdentity,
  resolveEvidenceMetrics,
  resolvePrimaryIdentity,
} from "@/lib/visualGraph/metadataDisplay";

// ── Type mapping ──────────────────────────────────────────────────────────────

const PRIMARY_NODE_TYPE_MAP: Record<RunGraphNodeType, VisualNodeType> = {
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

const ATTACHMENT_TYPE_MAP: Record<RunGraphAttachmentKind, { type: VisualNodeType; edgeType: VisualEdgeType }> = {
  model_call: { type: "model", edgeType: "uses" },
  tool_call: { type: "tool", edgeType: "uses" },
  skill: { type: "skill", edgeType: "uses" },
  cli: { type: "cli", edgeType: "uses" },
  eval: { type: "eval", edgeType: "evaluates" },
  artifact: { type: "artifact", edgeType: "produces" },
  issue: { type: "issue", edgeType: "fails" },
  agent: { type: "agent", edgeType: "contains" },
};

function primaryStatus(status: RunGraphNodeStatus): VisualNode["status"] {
  return status === "skipped" ? "not_observed" : status;
}

function evidenceStatus(attachment: RunGraphAttachment): VisualNode["status"] {
  if (attachment.kind === "issue") {
    if (attachment.recovered) return "recovered";
    if (attachment.status === "critical" || attachment.status === "fail") return "failed";
    return "warning";
  }
  if (attachment.kind === "eval") {
    return attachment.status === "passed" ? "completed" : "failed";
  }
  switch (attachment.status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "started":
    case "running":
      return "running";
    case "blocked":
    case "degraded":
      return "warning";
    case "skipped":
    case "pending":
      return "not_observed";
    default:
      // Artifacts and other status-less attachments default to completed —
      // their presence in the trace already implies success.
      return "completed";
  }
}

// ── Primary/internal node conversion ──────────────────────────────────────────

function toEvidenceCounts(node: RunGraphNode): VisualEvidenceCounts {
  return {
    models: node.modelCallCount,
    tools: node.toolCallCount,
    evals: node.evalCount,
    skills: node.skillCount,
    cli: node.cliCount,
    artifacts: node.artifactCount,
    issues: node.issueCount,
    agents: node.agentCount,
  };
}

function toPrimaryVisualNode(
  node: RunGraphNode,
  kind: VisualNodeKind,
  edges: RunGraph["edges"],
  eventsByNodeId: Map<string, TraceEvent[]>,
): VisualNode {
  return {
    id: node.id,
    type: PRIMARY_NODE_TYPE_MAP[node.type] ?? "stage",
    kind,
    label: node.label,
    status: primaryStatus(node.status),
    order: node.order,
    groupId: node.laneId,
    identity: resolvePrimaryIdentity(node),
    metrics: {},
    durationMs: node.durationMs,
    inputSummary: node.inputSummary,
    outputSummary: node.outputSummary,
    evidenceCounts: toEvidenceCounts(node),
    upstreamIds: edges.filter((e) => e.to === node.id).map((e) => e.from),
    downstreamIds: edges.filter((e) => e.from === node.id).map((e) => e.to),
    notes: node.notes,
    rawEvents: eventsByNodeId.get(node.id) ?? [],
  };
}

// ── Evidence node conversion ───────────────────────────────────────────────────

function toEvidenceVisualNode(
  parent: RunGraphNode,
  attachment: RunGraphAttachment,
  order: number,
): { node: VisualNode; edge: VisualEdge } {
  const isRecovery = attachment.kind === "issue" && attachment.recovered === true;
  const mapping = ATTACHMENT_TYPE_MAP[attachment.kind];
  const type: VisualNodeType = isRecovery ? "recovery" : mapping.type;
  const edgeType: VisualEdgeType = isRecovery ? "recovers" : mapping.edgeType;
  const id = `${parent.id}::${attachment.kind}::${attachment.id}`;

  return {
    node: {
      id,
      type,
      kind: "evidence",
      label: attachment.label,
      status: evidenceStatus(attachment),
      order,
      groupId: parent.laneId,
      parentId: parent.id,
      identity: resolveEvidenceIdentity(attachment, type),
      metrics: resolveEvidenceMetrics(attachment, parent.id),
      metadata: attachment.metadata,
      durationMs: attachment.durationMs,
      costUsd: attachment.costUsd,
      inputSummary: attachment.inputSummary,
      outputSummary: attachment.outputSummary,
      detail: attachment.detail,
      recovered: attachment.recovered,
      rawEvents: attachment.rawEvents,
    },
    edge: {
      id: `${parent.id}--${edgeType}--${id}`,
      from: parent.id,
      to: id,
      type: edgeType,
    },
  };
}

// ── Main builder ──────────────────────────────────────────────────────────────

export interface BuildVisualRunGraphParams {
  runGraph: RunGraph;
  traceEvents: TraceEvent[];
}

export function buildVisualRunGraph({ runGraph, traceEvents }: BuildVisualRunGraphParams): VisualRunGraph {
  const eventsByNodeId = new Map<string, TraceEvent[]>();
  for (const event of traceEvents) {
    if (!event.node_id) continue;
    const list = eventsByNodeId.get(event.node_id);
    if (list) {
      list.push(event);
    } else {
      eventsByNodeId.set(event.node_id, [event]);
    }
  }

  const primaryNodes = runGraph.nodes.map((n) => toPrimaryVisualNode(n, "primary", runGraph.edges, eventsByNodeId));
  const internalNodes = runGraph.extraNodes.map((n) => toPrimaryVisualNode(n, "internal", runGraph.edges, eventsByNodeId));

  const evidenceNodes: VisualNode[] = [];
  const evidenceEdges: VisualEdge[] = [];

  for (const node of [...runGraph.nodes, ...runGraph.extraNodes]) {
    node.attachments.forEach((attachment, index) => {
      const { node: evidenceNode, edge } = toEvidenceVisualNode(node, attachment, index);
      evidenceNodes.push(evidenceNode);
      evidenceEdges.push(edge);
    });
  }

  const edges: VisualEdge[] = runGraph.edges.map((e, index) => ({
    id: `workflow--${e.from}--${e.to}--${index}`,
    from: e.from,
    to: e.to,
    type: "workflow",
    label: e.label,
  }));

  const groups: VisualGroup[] = runGraph.lanes.map((lane) => ({
    id: lane.id,
    label: lane.label,
    order: lane.order,
    nodeIds: lane.nodeIds,
  }));

  return {
    workflowId: runGraph.workflow_id,
    projectId: runGraph.project_id,
    mode: runGraph.mode,
    templateName: runGraph.templateName,
    groups,
    primaryNodes,
    internalNodes,
    evidenceNodes,
    edges,
    evidenceEdges,
    summary: runGraph.summary,
  };
}
