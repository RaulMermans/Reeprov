import type { TraceEvent } from "@/lib/proof-layer/schemas";
import type { VisualEdge, VisualNode, VisualNodeStatus, VisualRunGraph } from "@/lib/visualGraph/types";

export type VisualReplayEventKind =
  | "node_reveal"
  | "node_status"
  | "edge_active"
  | "run_completed";

export interface VisualReplayEvent {
  id: string;
  kind: VisualReplayEventKind;
  order: number;
  timestamp?: string;
  label: string;
  nodeId?: string;
  edgeId?: string;
  status?: VisualNodeStatus;
  sourceEventId?: string;
}

export interface VisualReplayFrame {
  currentIndex: number;
  currentEvent?: VisualReplayEvent;
  visibleNodeIds: Set<string>;
  nodeStatuses: Map<string, VisualNodeStatus>;
  activeNodeId?: string;
  activeEdgeId?: string;
}

function eventTimeValue(event: Pick<VisualReplayEvent, "timestamp" | "order">): number {
  if (!event.timestamp) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(event.timestamp);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function sortReplayEvents(events: VisualReplayEvent[]): VisualReplayEvent[] {
  return [...events]
    .sort((a, b) => {
      const time = eventTimeValue(a) - eventTimeValue(b);
      if (time !== 0) return time;
      return a.order - b.order || a.id.localeCompare(b.id);
    })
    .map((event, order) => ({ ...event, order }));
}

function statusForTraceEvent(event: TraceEvent): VisualNodeStatus | undefined {
  switch (event.event_type) {
    case "node_started":
    case "model_call_started":
    case "tool_call_started":
    case "skill_call_started":
    case "cli_call_started":
    case "eval_started":
    case "retry_started":
      return "running";
    case "node_completed":
    case "model_call_completed":
    case "tool_call_completed":
    case "skill_call_completed":
    case "cli_call_completed":
    case "eval_completed":
    case "artifact_created":
      if (event.status === "failed") return "failed";
      if (event.status === "degraded" || event.status === "blocked") return "warning";
      return "completed";
    case "node_failed":
    case "tool_call_failed":
    case "skill_call_failed":
    case "cli_call_failed":
    case "run_failed":
    case "error":
      return "failed";
    case "run_completed":
      return "completed";
    default:
      return undefined;
  }
}

function eventVerb(event: TraceEvent): string {
  if (event.event_type.endsWith("_started")) return "started";
  if (event.event_type.endsWith("_completed")) return "completed";
  if (event.event_type.endsWith("_failed")) return "failed";
  if (event.event_type === "artifact_created") return "created";
  if (event.event_type === "retry_started") return "retry";
  if (event.event_type === "error") return "issue";
  return event.event_type.replaceAll("_", " ");
}

function evidenceRevealLabel(node: VisualNode, event: TraceEvent): string {
  if (node.type === "artifact") return `Artifact created: ${node.identity.title}`;
  if (node.type === "issue") return `Issue detected: ${node.identity.title}`;
  if (node.type === "recovery") return `Recovery detected: ${node.identity.title}`;
  return `${node.identity.typeLabel} ${eventVerb(event)}: ${node.identity.title}`;
}

function firstTraceEvent(node: VisualNode): TraceEvent | undefined {
  return node.rawEvents
    .slice()
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.event_id.localeCompare(b.event_id))[0];
}

function edgeForEvidenceNode(graph: VisualRunGraph, nodeId: string): VisualEdge | undefined {
  return graph.evidenceEdges.find((edge) => edge.to === nodeId);
}

export function deriveVisualReplayEvents(graph: VisualRunGraph): VisualReplayEvent[] {
  const events: VisualReplayEvent[] = [];
  let order = 0;

  for (const node of graph.primaryNodes) {
    const rawEvents = node.rawEvents.length > 0 ? node.rawEvents : [];
    for (const event of rawEvents) {
      const status = statusForTraceEvent(event);
      if (!status) continue;
      events.push({
        id: `replay:${event.event_id}:${node.id}:status`,
        kind: "node_status",
        order: order++,
        timestamp: event.timestamp,
        label: `${node.identity.title} ${eventVerb(event)}`,
        nodeId: node.id,
        status,
        sourceEventId: event.event_id,
      });
      const workflowEdge = graph.edges.find((edge) => edge.from === node.id);
      if (event.event_type === "node_completed" && workflowEdge) {
        events.push({
          id: `replay:${event.event_id}:${workflowEdge.id}:edge`,
          kind: "edge_active",
          order: order++,
          timestamp: event.timestamp,
          label: `Next: ${workflowEdge.label ?? "workflow"}`,
          edgeId: workflowEdge.id,
          sourceEventId: event.event_id,
        });
      }
    }
  }

  for (const node of graph.evidenceNodes) {
    const rawEvents = node.rawEvents.length > 0 ? node.rawEvents : [];
    const revealEvent = firstTraceEvent(node);
    if (revealEvent) {
      events.push({
        id: `replay:${revealEvent.event_id}:${node.id}:reveal`,
        kind: "node_reveal",
        order: order++,
        timestamp: revealEvent.timestamp,
        label: evidenceRevealLabel(node, revealEvent),
        nodeId: node.id,
        status: statusForTraceEvent(revealEvent) ?? node.status,
        sourceEventId: revealEvent.event_id,
      });
      const edge = edgeForEvidenceNode(graph, node.id);
      if (edge) {
        events.push({
          id: `replay:${revealEvent.event_id}:${edge.id}:edge`,
          kind: "edge_active",
          order: order++,
          timestamp: revealEvent.timestamp,
          label: edge.label ?? edge.type,
          edgeId: edge.id,
          sourceEventId: revealEvent.event_id,
        });
      }
    } else {
      events.push({
        id: `replay:fallback:${node.id}:reveal`,
        kind: "node_reveal",
        order: order++,
        label: `${node.identity.typeLabel} observed: ${node.identity.title}`,
        nodeId: node.id,
        status: node.status,
      });
    }

    for (const event of rawEvents) {
      const status = statusForTraceEvent(event);
      if (!status) continue;
      events.push({
        id: `replay:${event.event_id}:${node.id}:status`,
        kind: "node_status",
        order: order++,
        timestamp: event.timestamp,
        label: evidenceRevealLabel(node, event),
        nodeId: node.id,
        status: node.type === "recovery" ? "recovered" : status,
        sourceEventId: event.event_id,
      });
    }
  }

  const runCompleted = [...graph.primaryNodes, ...graph.evidenceNodes]
    .flatMap((node) => node.rawEvents)
    .find((event) => event.event_type === "run_completed");
  events.push({
    id: "replay:run:completed",
    kind: "run_completed",
    order: order++,
    timestamp: runCompleted?.timestamp,
    label: "Run completed",
  });

  return sortReplayEvents(events);
}

export function buildReplayFrame(
  graph: VisualRunGraph,
  events: VisualReplayEvent[],
  currentIndex: number,
): VisualReplayFrame {
  const visibleNodeIds = new Set<string>(graph.primaryNodes.map((node) => node.id));
  const nodeStatuses = new Map<string, VisualNodeStatus>();
  for (const node of graph.primaryNodes) nodeStatuses.set(node.id, currentIndex >= events.length - 1 ? node.status : "not_observed");

  let activeNodeId: string | undefined;
  let activeEdgeId: string | undefined;

  events.slice(0, Math.max(0, currentIndex + 1)).forEach((event) => {
    if (event.kind === "node_reveal" && event.nodeId) {
      visibleNodeIds.add(event.nodeId);
      if (event.status) nodeStatuses.set(event.nodeId, event.status);
      activeNodeId = event.nodeId;
    }
    if (event.kind === "node_status" && event.nodeId) {
      visibleNodeIds.add(event.nodeId);
      if (event.status) nodeStatuses.set(event.nodeId, event.status);
      activeNodeId = event.nodeId;
    }
    if (event.kind === "edge_active" && event.edgeId) {
      activeEdgeId = event.edgeId;
    }
  });

  if (currentIndex >= events.length - 1) {
    for (const node of [...graph.primaryNodes, ...graph.internalNodes, ...graph.evidenceNodes]) {
      visibleNodeIds.add(node.id);
      nodeStatuses.set(node.id, node.status);
    }
  }

  return {
    currentIndex,
    currentEvent: events[currentIndex],
    visibleNodeIds,
    nodeStatuses,
    activeNodeId,
    activeEdgeId,
  };
}
