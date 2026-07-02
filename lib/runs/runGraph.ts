/**
 * Generic RunGraph engine.
 *
 * Converts a RunRecord, TraceEvents, ToolCalls, EvalResults, and an optional
 * WorkflowSpec into a RunGraph that any visual component can render without
 * knowing anything about a specific integration.
 *
 * Design constraints:
 * - No project_id or workflow_id branches.
 * - WorkflowSpec nodes drive structure and order when available.
 * - Event metadata drives lane assignment; "Workflow" is the default lane.
 * - Stage nodes (not raw events) are the unit of the graph.
 */

import type {
  EvalResult,
  RunRecord,
  ToolCallRecord,
  TraceEvent,
  WorkflowEdge,
  WorkflowNode,
} from "@/lib/proof-layer/schemas";
import {
  buildArtifactCards,
  extractRunIssues,
  groupTraceEventsIntoStages,
} from "@/lib/runs/runIntelligence";
import type { ArtifactCard, RunIssue, RunStage } from "@/lib/runs/runIntelligence";
import { extractAgentNotes } from "@/lib/runs/agentNotes";
import type { AgentNote } from "@/lib/runs/agentNotes";

// ── Node types ────────────────────────────────────────────────────────────────

export type RunGraphNodeType =
  | "stage"
  | "agent"
  | "model_call"
  | "tool_call"
  | "skill"
  | "eval"
  | "artifact"
  | "issue"
  | "unknown";

export type RunGraphNodeStatus =
  | "completed"
  | "warning"
  | "failed"
  | "running"
  | "skipped"
  | "not_observed";

// ── Attachments — sub-items associated with a graph node ─────────────────────

export type RunGraphAttachmentKind = "model_call" | "tool_call" | "skill" | "cli" | "eval" | "artifact" | "issue" | "agent";

export interface RunGraphAttachment {
  id: string;
  kind: RunGraphAttachmentKind;
  label: string;
  status?: string;
  durationMs?: number;
  costUsd?: number;
  inputSummary?: string;
  outputSummary?: string;
  detail?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  /** True when an issue attachment was recovered later in the same stage. */
  recovered?: boolean;
  rawEvents: TraceEvent[];
}

// ── Nodes ─────────────────────────────────────────────────────────────────────

export interface RunGraphNode {
  id: string;
  type: RunGraphNodeType;
  label: string;
  laneId: string;
  status: RunGraphNodeStatus;
  order: number;
  durationMs?: number;
  inputSummary?: string;
  outputSummary?: string;
  modelCallCount: number;
  toolCallCount: number;
  evalCount: number;
  skillCount: number;
  cliCount: number;
  artifactCount: number;
  issueCount: number;
  agentCount: number;
  attachments: RunGraphAttachment[];
  /** User-safe reasoning/decision notes attributed to this node, if any were emitted. */
  notes: AgentNote[];
}

// ── Edges ─────────────────────────────────────────────────────────────────────

export interface RunGraphEdge {
  from: string;
  to: string;
  label?: string;
}

// ── Lanes ─────────────────────────────────────────────────────────────────────

export interface RunGraphLane {
  id: string;
  label: string;
  order: number;
  nodeIds: string[];
}

// ── Summary metrics ───────────────────────────────────────────────────────────

export interface RunGraphSummary {
  totalStages: number;
  completedStages: number;
  failedStages: number;
  warningStages: number;
  notObservedStages: number;
  totalModelCalls: number;
  totalToolCalls: number;
  totalEvals: number;
  totalArtifacts: number;
  totalIssues: number;
}

// ── Top-level RunGraph ────────────────────────────────────────────────────────

export interface RunGraph {
  workflow_id: string;
  project_id: string;
  mode: "registered_spec" | "inferred";
  templateName?: string;
  lanes: RunGraphLane[];
  /** Primary nodes: spec nodes (registered_spec mode) or all observed stages (inferred mode). */
  nodes: RunGraphNode[];
  /**
   * Extra observed nodes that are not declared in the WorkflowSpec.
   * Only populated in registered_spec mode. Empty in inferred mode.
   * These are internal implementation nodes accessible via the inspector.
   */
  extraNodes: RunGraphNode[];
  edges: RunGraphEdge[];
  issues: RunIssue[];
  artifacts: ArtifactCard[];
  summary: RunGraphSummary;
}

// ── Builder input ─────────────────────────────────────────────────────────────

export interface BuildRunGraphParams {
  runRecord: RunRecord;
  traceEvents: TraceEvent[];
  toolCalls: ToolCallRecord[];
  evalResults: EvalResult[];
  specNodes?: WorkflowNode[];
  specEdges?: WorkflowEdge[];
  templateName?: string;
}

// ── Lane inference ────────────────────────────────────────────────────────────

const LANE_META_KEYS = ["lane", "agent", "role", "stage_group", "owner"] as const;
const DEFAULT_LANE_ID = "workflow";
const DEFAULT_LANE_LABEL = "Workflow";

function inferLaneEntry(events: TraceEvent[]): { id: string; label: string } {
  for (const event of events) {
    for (const key of LANE_META_KEYS) {
      const value = event.metadata?.[key];
      if (typeof value === "string" && value.trim()) {
        const label = value.trim();
        return {
          id: label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
          label,
        };
      }
    }
  }
  return { id: DEFAULT_LANE_ID, label: DEFAULT_LANE_LABEL };
}

// ── Spec node type mapping ────────────────────────────────────────────────────

function specNodeTypeToGraphType(type: WorkflowNode["type"]): RunGraphNodeType {
  switch (type) {
    case "agent":
      return "agent";
    case "tool":
      return "tool_call";
    case "evaluator":
      return "eval";
    case "artifact":
      return "artifact";
    case "llm":
      return "model_call";
    default:
      return "stage";
  }
}

// ── Attachment builders ───────────────────────────────────────────────────────

function buildModelCallAttachments(events: TraceEvent[]): RunGraphAttachment[] {
  return events
    .filter(
      (e) =>
        e.event_type === "model_call_completed" || e.event_type === "model_call_started",
    )
    .map((e) => {
      const modelName =
        typeof e.metadata?.["model_name"] === "string" ? e.metadata["model_name"] :
        typeof e.metadata?.["model_provider"] === "string" ? e.metadata["model_provider"] :
        "Model call";
      const latencyMs = typeof e.metadata?.["latency_ms"] === "number"
        ? Number(e.metadata["latency_ms"])
        : undefined;
      return {
        id: e.event_id,
        kind: "model_call" as const,
        label: String(modelName),
        status: e.status,
        durationMs: typeof e.duration_ms === "number" && e.duration_ms > 0
          ? e.duration_ms
          : latencyMs,
        costUsd: typeof e.cost_usd === "number" ? e.cost_usd : undefined,
        inputSummary: e.input_summary,
        outputSummary: e.output_summary,
        detail: e.output_summary,
        metadata: e.metadata,
        rawEvents: [e],
      };
    });
}

function buildToolCallAttachments(
  nodeId: string,
  toolCalls: ToolCallRecord[],
  events: TraceEvent[],
): RunGraphAttachment[] {
  return toolCalls
    .filter((tc) => tc.node_id === nodeId)
    .map((tc) => {
      const matchingEvents = events.filter((event) => {
        if (!event.event_type.startsWith("tool_call_")) return false;
        if (event.node_id !== nodeId) return false;
        const eventToolCallId = event.metadata?.["tool_call_id"];
        const eventToolName = event.metadata?.["tool_name"];
        return eventToolCallId === tc.tool_call_id || eventToolName === tc.tool_name;
      });
      const fallbackEvents = matchingEvents.length > 0
        ? matchingEvents
        : events.filter((event) => event.node_id === nodeId && event.event_type.startsWith("tool_call_"));
      return {
        id: tc.tool_call_id,
        kind: "tool_call" as const,
        label: tc.tool_name,
        status: tc.status,
        durationMs: tc.duration_ms,
        inputSummary: tc.input_summary,
        outputSummary: tc.output_summary,
        detail: tc.output_summary ?? tc.input_summary,
        error: tc.error,
        metadata: {
          tool_name: tc.tool_name,
          permission_class: tc.permission_class,
          error: tc.error,
          input_summary: tc.input_summary,
          output_summary: tc.output_summary,
        },
        rawEvents: fallbackEvents,
      };
    });
}

function buildEvalAttachments(
  nodeId: string,
  evalResults: EvalResult[],
): RunGraphAttachment[] {
  return evalResults
    .filter((er) => er.node_id === nodeId)
    .map((er) => ({
      id: er.eval_id,
      kind: "eval" as const,
      label: er.name,
      status: er.passed ? "passed" : "failed",
      detail: er.findings[0] ?? er.recommendation,
      outputSummary: er.findings[0] ?? er.recommendation,
      metadata: {
        eval_name: er.name,
        eval_type: er.type,
        score: er.score,
        passed: er.passed,
        severity: er.severity,
        findings: er.findings,
        recommendation: er.recommendation,
      },
      rawEvents: [],
    }));
}

function buildArtifactAttachments(events: TraceEvent[]): RunGraphAttachment[] {
  return events
    .filter((e) => e.event_type === "artifact_created")
    .map((e) => {
      const ref =
        typeof e.metadata?.["artifact_ref"] === "string"
          ? e.metadata["artifact_ref"]
          : typeof e.metadata?.["title"] === "string"
          ? e.metadata["title"]
          : "Artifact";
      return {
        id: e.event_id,
        kind: "artifact" as const,
        label: String(ref),
        status: e.status,
        inputSummary: e.input_summary,
        outputSummary: e.output_summary,
        detail: e.output_summary,
        metadata: e.metadata,
        rawEvents: [e],
      };
    });
}

function buildSkillAttachments(events: TraceEvent[]): RunGraphAttachment[] {
  return events
    .filter(
      (e) =>
        e.event_type === "skill_call_completed" ||
        e.event_type === "skill_call_started" ||
        typeof e.metadata?.["skill_name"] === "string" ||
        typeof e.metadata?.["skill"] === "string",
    )
    .filter(
      (e) =>
        e.event_type !== "model_call_completed" &&
        e.event_type !== "model_call_started" &&
        e.event_type !== "tool_call_completed" &&
        e.event_type !== "tool_call_started",
    )
    .map((e) => {
      const name =
        typeof e.metadata?.["skill_name"] === "string"
          ? e.metadata["skill_name"]
          : typeof e.metadata?.["skill"] === "string"
          ? e.metadata["skill"]
          : "Skill";
      return {
        id: e.event_id,
        kind: "skill" as const,
        label: String(name),
        status: e.status,
        durationMs:
          typeof e.duration_ms === "number" && e.duration_ms > 0
            ? e.duration_ms
            : undefined,
        inputSummary: e.input_summary,
        outputSummary: e.output_summary,
        detail: e.output_summary,
        metadata: e.metadata,
        rawEvents: [e],
      };
    });
}

function buildCLIAttachments(events: TraceEvent[]): RunGraphAttachment[] {
  return events
    .filter(
      (e) =>
        e.event_type === "cli_call_completed" ||
        e.event_type === "cli_call_started" ||
        typeof e.metadata?.["cli_command"] === "string",
    )
    .map((e) => {
      const cmd =
        typeof e.metadata?.["cli_command"] === "string"
          ? e.metadata["cli_command"]
          : "CLI command";
      return {
        id: e.event_id,
        kind: "cli" as const,
        label: String(cmd),
        status: e.status,
        durationMs:
          typeof e.duration_ms === "number" && e.duration_ms > 0
            ? e.duration_ms
            : undefined,
        inputSummary: e.input_summary,
        outputSummary: e.output_summary,
        detail: e.output_summary,
        metadata: e.metadata,
        rawEvents: [e],
      };
    });
}

function buildIssueAttachments(
  nodeId: string,
  issues: RunIssue[],
): RunGraphAttachment[] {
  return issues
    .filter((iss) => iss.stageId === nodeId)
    .map((iss) => ({
      id: iss.id,
      kind: "issue" as const,
      label: iss.message.slice(0, 80),
      status: iss.severity,
      detail: iss.recommendedFix,
      outputSummary: iss.message,
      metadata: {
        severity: iss.severity,
        recovered: iss.recovered,
        recommended_fix: iss.recommendedFix,
      },
      recovered: iss.recovered,
      rawEvents: [],
    }));
}

// ── Agent attachment builder ──────────────────────────────────────────────────
//
// Surfaces agent identity when a stage's trace events carry generic agent
// metadata (agent/agent_id/agent_name/role/owner/actor). Purely metadata-key
// driven — never invents an agent when no such metadata is present, and
// supports more than one agent per stage should the events reflect that.

const AGENT_NAME_KEYS = ["agent_name", "agent", "actor", "agent_id"] as const;

function resolveAgentName(metadata: Record<string, unknown> | undefined): string | undefined {
  for (const key of AGENT_NAME_KEYS) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function buildAgentAttachments(events: TraceEvent[]): RunGraphAttachment[] {
  const byName = new Map<string, { events: TraceEvent[]; role?: string; owner?: string }>();

  for (const event of events) {
    const name = resolveAgentName(event.metadata);
    if (!name) continue;
    const role = typeof event.metadata?.["role"] === "string" ? (event.metadata["role"] as string) : undefined;
    const owner = typeof event.metadata?.["owner"] === "string" ? (event.metadata["owner"] as string) : undefined;
    const entry = byName.get(name);
    if (entry) {
      entry.events.push(event);
      entry.role = entry.role ?? role;
      entry.owner = entry.owner ?? owner;
    } else {
      byName.set(name, { events: [event], role, owner });
    }
  }

  return [...byName.entries()].map(([name, entry]) => ({
    id: `agent_${slugify(name)}`,
    kind: "agent" as const,
    label: name,
    detail: `${entry.events.length} action${entry.events.length === 1 ? "" : "s"}`,
    metadata: {
      agent_name: name,
      role: entry.role,
      owner: entry.owner,
      action_count: entry.events.length,
    },
    rawEvents: entry.events,
  }));
}

// ── Edge builder ──────────────────────────────────────────────────────────────

function buildEdges(
  nodes: RunGraphNode[],
  specEdges: WorkflowEdge[] | undefined,
): RunGraphEdge[] {
  if (specEdges && specEdges.length > 0) {
    const nodeIds = new Set(nodes.map((n) => n.id));
    return specEdges
      .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
      .map((e) => ({ from: e.from, to: e.to, label: e.condition }));
  }
  const edges: RunGraphEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i].id, to: nodes[i + 1].id });
  }
  return edges;
}

// ── Lane builder ──────────────────────────────────────────────────────────────

function buildLanes(
  nodes: RunGraphNode[],
  laneEntries: Map<string, { id: string; label: string }>,
): RunGraphLane[] {
  const seen = new Map<string, { label: string; order: number; nodeIds: string[] }>();
  let orderCounter = 0;

  for (const node of nodes) {
    const entry = laneEntries.get(node.id) ?? { id: DEFAULT_LANE_ID, label: DEFAULT_LANE_LABEL };
    if (!seen.has(entry.id)) {
      seen.set(entry.id, { label: entry.label, order: orderCounter++, nodeIds: [] });
    }
    seen.get(entry.id)!.nodeIds.push(node.id);
  }

  return [...seen.entries()]
    .map(([id, { label, order, nodeIds }]) => ({ id, label, order, nodeIds }))
    .sort((a, b) => a.order - b.order);
}

// ── Main builder ──────────────────────────────────────────────────────────────

export function buildRunGraph(params: BuildRunGraphParams): RunGraph {
  const {
    runRecord,
    traceEvents,
    toolCalls,
    evalResults,
    specNodes,
    specEdges,
    templateName,
  } = params;

  const hasSpec = Boolean(specNodes && specNodes.length > 0);
  const mode: RunGraph["mode"] = hasSpec ? "registered_spec" : "inferred";

  // Step 1: Group trace events into stages; extract issues and artifacts.
  const { stages } = groupTraceEventsIntoStages(traceEvents, specNodes);
  const stageById = new Map<string, RunStage>(stages.map((s) => [s.id, s]));
  const issues = extractRunIssues(traceEvents, evalResults, specNodes);
  const artifacts = buildArtifactCards(traceEvents, runRecord.artifact_refs);

  // Step 2: Build ordered node candidates.
  // Spec mode: spec nodes are primary (candidates); extra observed stages go to extraCandidates.
  // Inferred mode: observed stages in chronological order; no extraCandidates.
  interface Candidate {
    id: string;
    label: string;
    stage?: RunStage;
    specType?: WorkflowNode["type"];
    order: number;
  }

  const candidates: Candidate[] = [];
  const extraCandidates: Candidate[] = [];

  if (hasSpec && specNodes) {
    specNodes.forEach((node, index) => {
      candidates.push({
        id: node.id,
        label: node.label,
        stage: stageById.get(node.id),
        specType: node.type,
        order: index,
      });
    });
    // Extra observed stages not declared in the spec stay out of the primary graph.
    // They go to extraNodes so the inspector can surface them without cluttering the view.
    const specNodeIds = new Set(specNodes.map((n) => n.id));
    stages.forEach((stage, index) => {
      if (!specNodeIds.has(stage.id)) {
        extraCandidates.push({
          id: stage.id,
          label: stage.label,
          stage,
          order: index,
        });
      }
    });
  } else {
    stages.forEach((stage, index) => {
      candidates.push({
        id: stage.id,
        label: stage.label,
        stage,
        order: index,
      });
    });
  }

  // Step 3: Assign lanes from event metadata (primary + extra candidates).
  const laneEntries = new Map<string, { id: string; label: string }>();
  for (const c of [...candidates, ...extraCandidates]) {
    laneEntries.set(c.id, inferLaneEntry(c.stage?.events ?? []));
  }

  // Step 4: Build nodes.
  const nodes: RunGraphNode[] = candidates.map((c) => {
    const stageEvents = c.stage?.events ?? [];
    const modelAttachments = buildModelCallAttachments(stageEvents);
    const toolAttachments = buildToolCallAttachments(c.id, toolCalls, stageEvents);
    const skillAttachments = buildSkillAttachments(stageEvents);
    const cliAttachments = buildCLIAttachments(stageEvents);
    const evalAttachments = buildEvalAttachments(c.id, evalResults);
    const artifactAttachments = buildArtifactAttachments(stageEvents);
    const issueAttachments = buildIssueAttachments(c.id, issues);
    const agentAttachments = buildAgentAttachments(stageEvents);

    const status: RunGraphNodeStatus = c.stage
      ? (c.stage.status as RunGraphNodeStatus)
      : "not_observed";

    const type: RunGraphNodeType = c.specType
      ? specNodeTypeToGraphType(c.specType)
      : "stage";

    const lane = laneEntries.get(c.id) ?? { id: DEFAULT_LANE_ID, label: DEFAULT_LANE_LABEL };

    return {
      id: c.id,
      type,
      label: c.label,
      laneId: lane.id,
      status,
      order: c.order,
      durationMs: c.stage?.durationMs,
      inputSummary: c.stage?.inputSummary,
      outputSummary: c.stage?.outputSummary,
      modelCallCount: modelAttachments.length || c.stage?.modelCallCount || 0,
      toolCallCount: toolAttachments.length || c.stage?.toolCallCount || 0,
      evalCount: evalAttachments.length || c.stage?.evalCount || 0,
      skillCount: skillAttachments.length,
      cliCount: cliAttachments.length,
      artifactCount: artifactAttachments.length,
      issueCount: issueAttachments.length,
      agentCount: agentAttachments.length,
      attachments: [
        ...modelAttachments,
        ...toolAttachments,
        ...skillAttachments,
        ...cliAttachments,
        ...evalAttachments,
        ...artifactAttachments,
        ...issueAttachments,
        ...agentAttachments,
      ],
      notes: extractAgentNotes(stageEvents),
    };
  });

  // Step 4b: Build extra nodes (spec mode only — internal observed nodes not in spec).
  const extraNodes: RunGraphNode[] = extraCandidates.map((c) => {
    const stageEvents = c.stage?.events ?? [];
    const modelAttachments = buildModelCallAttachments(stageEvents);
    const toolAttachments = buildToolCallAttachments(c.id, toolCalls, stageEvents);
    const skillAttachments = buildSkillAttachments(stageEvents);
    const cliAttachments = buildCLIAttachments(stageEvents);
    const evalAttachments = buildEvalAttachments(c.id, evalResults);
    const artifactAttachments = buildArtifactAttachments(stageEvents);
    const issueAttachments = buildIssueAttachments(c.id, issues);
    const agentAttachments = buildAgentAttachments(stageEvents);
    const lane = laneEntries.get(c.id) ?? { id: DEFAULT_LANE_ID, label: DEFAULT_LANE_LABEL };

    return {
      id: c.id,
      type: "stage" as const,
      label: c.label,
      laneId: lane.id,
      status: (c.stage?.status ?? "completed") as RunGraphNodeStatus,
      order: c.order,
      durationMs: c.stage?.durationMs,
      inputSummary: c.stage?.inputSummary,
      outputSummary: c.stage?.outputSummary,
      modelCallCount: modelAttachments.length || c.stage?.modelCallCount || 0,
      toolCallCount: toolAttachments.length || c.stage?.toolCallCount || 0,
      evalCount: evalAttachments.length || c.stage?.evalCount || 0,
      skillCount: skillAttachments.length,
      cliCount: cliAttachments.length,
      artifactCount: artifactAttachments.length,
      issueCount: issueAttachments.length,
      agentCount: agentAttachments.length,
      attachments: [
        ...modelAttachments,
        ...toolAttachments,
        ...skillAttachments,
        ...cliAttachments,
        ...evalAttachments,
        ...artifactAttachments,
        ...issueAttachments,
        ...agentAttachments,
      ],
      notes: extractAgentNotes(stageEvents),
    };
  });

  // Step 5: Build edges and lanes.
  const edges = buildEdges(nodes, specEdges);
  const lanes = buildLanes(nodes, laneEntries);

  // Step 6: Summary metrics.
  const summary: RunGraphSummary = {
    totalStages: nodes.length,
    completedStages: nodes.filter((n) => n.status === "completed").length,
    failedStages: nodes.filter((n) => n.status === "failed").length,
    warningStages: nodes.filter((n) => n.status === "warning").length,
    notObservedStages: nodes.filter((n) => n.status === "not_observed").length,
    totalModelCalls: nodes.reduce((sum, n) => sum + n.modelCallCount, 0),
    totalToolCalls: nodes.reduce((sum, n) => sum + n.toolCallCount, 0),
    totalEvals: nodes.reduce((sum, n) => sum + n.evalCount, 0),
    totalArtifacts: artifacts.length,
    totalIssues: issues.length,
  };

  return {
    workflow_id: runRecord.workflow_id,
    project_id: runRecord.project_id,
    mode,
    templateName,
    lanes,
    nodes,
    extraNodes,
    edges,
    issues,
    artifacts,
    summary,
  };
}
