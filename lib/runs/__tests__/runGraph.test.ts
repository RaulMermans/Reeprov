/**
 * Tests for the generic RunGraph engine.
 *
 * Verifies that buildRunGraph produces a correct, integration-agnostic
 * RunGraph from any combination of run records, trace events, tool calls,
 * eval results, and optional WorkflowSpec data.
 *
 * Critical invariants:
 * - No project_id or workflow_id branches anywhere in the engine.
 * - WorkflowSpec nodes drive structure when provided.
 * - Trace events drive structure when no spec is provided.
 * - Lane assignment reads event metadata; falls back to "Workflow".
 * - Stage nodes (not raw events) are the unit of the graph.
 */

import { describe, expect, it } from "vitest";
import type { EvalResult, RunRecord, ToolCallRecord, TraceEvent, WorkflowEdge, WorkflowNode } from "@/lib/proof-layer/schemas";
import { buildRunGraph } from "@/lib/runs/runGraph";
import type { BuildRunGraphParams } from "@/lib/runs/runGraph";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRun(partial: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: "run-test-1",
    workflow_id: "wf-test",
    project_id: "proj-test",
    project_name: "Test Project",
    status: "completed",
    started_at: "2026-06-01T10:00:00.000Z",
    completed_at: "2026-06-01T10:05:00.000Z",
    model_calls_count: 0,
    tool_calls_count: 0,
    evals_passed: 0,
    evals_failed: 0,
    artifact_refs: [],
    summary: "Test run.",
    ...partial,
  };
}

function makeEvent(
  partial: Partial<TraceEvent> & Pick<TraceEvent, "event_id" | "event_type" | "timestamp">,
): TraceEvent {
  return {
    run_id: "run-test-1",
    workflow_id: "wf-test",
    ...partial,
  };
}

function makeToolCall(partial: Partial<ToolCallRecord> & Pick<ToolCallRecord, "tool_call_id" | "tool_name" | "node_id">): ToolCallRecord {
  return {
    run_id: "run-test-1",
    permission_class: "read_only",
    status: "completed",
    started_at: "2026-06-01T10:00:00.000Z",
    ...partial,
  };
}

function makeEval(partial: Partial<EvalResult> & Pick<EvalResult, "eval_id" | "name" | "type">): EvalResult {
  return {
    run_id: "run-test-1",
    passed: true,
    severity: "info",
    findings: [],
    ...partial,
  };
}

function baseParams(overrides: Partial<BuildRunGraphParams> = {}): BuildRunGraphParams {
  return {
    runRecord: makeRun(),
    traceEvents: [],
    toolCalls: [],
    evalResults: [],
    ...overrides,
  };
}

// ── Mode: registered_spec ─────────────────────────────────────────────────────

describe("buildRunGraph — registered_spec mode", () => {
  it("sets mode to registered_spec when specNodes are provided", () => {
    const specNodes: WorkflowNode[] = [
      { id: "stage_a", type: "llm", label: "Stage A" },
    ];
    const graph = buildRunGraph(baseParams({ specNodes }));
    expect(graph.mode).toBe("registered_spec");
  });

  it("derives node order from spec, not from trace timestamps", () => {
    const specNodes: WorkflowNode[] = [
      { id: "stage_c", type: "llm", label: "Stage C" },
      { id: "stage_a", type: "llm", label: "Stage A" },
      { id: "stage_b", type: "llm", label: "Stage B" },
    ];
    // Events arrive chronologically a→b→c, but spec order is c→a→b
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_completed", node_id: "stage_a", timestamp: "2026-06-01T10:01:00.000Z" }),
      makeEvent({ event_id: "e3", event_type: "node_started", node_id: "stage_b", timestamp: "2026-06-01T10:02:00.000Z" }),
      makeEvent({ event_id: "e4", event_type: "node_completed", node_id: "stage_b", timestamp: "2026-06-01T10:03:00.000Z" }),
      makeEvent({ event_id: "e5", event_type: "node_started", node_id: "stage_c", timestamp: "2026-06-01T10:04:00.000Z" }),
      makeEvent({ event_id: "e6", event_type: "node_completed", node_id: "stage_c", timestamp: "2026-06-01T10:05:00.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ specNodes, traceEvents }));
    expect(graph.nodes.map((n) => n.id)).toEqual(["stage_c", "stage_a", "stage_b"]);
  });

  it("marks spec nodes with no observed events as not_observed", () => {
    const specNodes: WorkflowNode[] = [
      { id: "stage_a", type: "llm", label: "Stage A" },
      { id: "stage_b", type: "llm", label: "Stage B" },
      { id: "stage_c", type: "llm", label: "Stage C" },
    ];
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_completed", node_id: "stage_a", timestamp: "2026-06-01T10:01:00.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ specNodes, traceEvents }));
    expect(graph.nodes.find((n) => n.id === "stage_b")?.status).toBe("not_observed");
    expect(graph.nodes.find((n) => n.id === "stage_c")?.status).toBe("not_observed");
    expect(graph.nodes.find((n) => n.id === "stage_a")?.status).toBe("completed");
  });

  it("places observed stages not in the spec in extraNodes, not the primary nodes array", () => {
    const specNodes: WorkflowNode[] = [
      { id: "stage_a", type: "llm", label: "Stage A" },
    ];
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_completed", node_id: "stage_a", timestamp: "2026-06-01T10:01:00.000Z" }),
      makeEvent({ event_id: "e3", event_type: "node_started", node_id: "extra_stage", timestamp: "2026-06-01T10:02:00.000Z" }),
      makeEvent({ event_id: "e4", event_type: "node_completed", node_id: "extra_stage", timestamp: "2026-06-01T10:03:00.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ specNodes, traceEvents }));
    // Primary nodes contain only spec nodes.
    expect(graph.nodes.map((n) => n.id)).toEqual(["stage_a"]);
    // Extra observed nodes are in extraNodes, accessible for the inspector.
    expect(graph.extraNodes.map((n) => n.id)).toContain("extra_stage");
  });

  it("uses spec edges when provided", () => {
    const specNodes: WorkflowNode[] = [
      { id: "stage_a", type: "llm", label: "A" },
      { id: "stage_b", type: "llm", label: "B" },
    ];
    const specEdges: WorkflowEdge[] = [
      { from: "stage_a", to: "stage_b", condition: "on_success" },
    ];
    const graph = buildRunGraph(baseParams({ specNodes, specEdges }));
    expect(graph.edges).toEqual([{ from: "stage_a", to: "stage_b", label: "on_success" }]);
  });

  it("sets templateName when provided", () => {
    const specNodes: WorkflowNode[] = [{ id: "s", type: "llm", label: "S" }];
    const graph = buildRunGraph(baseParams({ specNodes, templateName: "My Workflow" }));
    expect(graph.templateName).toBe("My Workflow");
  });

  it("maps spec node type to graph node type generically", () => {
    const specNodes: WorkflowNode[] = [
      { id: "llm_node", type: "llm", label: "LLM" },
      { id: "agent_node", type: "agent", label: "Agent" },
      { id: "tool_node", type: "tool", label: "Tool" },
      { id: "eval_node", type: "evaluator", label: "Eval" },
      { id: "artifact_node", type: "artifact", label: "Artifact" },
      { id: "trigger_node", type: "trigger", label: "Trigger" },
    ];
    const graph = buildRunGraph(baseParams({ specNodes }));
    const typeById = new Map(graph.nodes.map((n) => [n.id, n.type]));
    expect(typeById.get("llm_node")).toBe("model_call");
    expect(typeById.get("agent_node")).toBe("agent");
    expect(typeById.get("tool_node")).toBe("tool_call");
    expect(typeById.get("eval_node")).toBe("eval");
    expect(typeById.get("artifact_node")).toBe("artifact");
    expect(typeById.get("trigger_node")).toBe("stage");
  });

  it("does not branch on project_id — same engine used regardless of project", () => {
    const specNodes: WorkflowNode[] = [{ id: "step1", type: "llm", label: "Step 1" }];
    const graphA = buildRunGraph(baseParams({ specNodes, runRecord: makeRun({ project_id: "proj-blogagent" }) }));
    const graphB = buildRunGraph(baseParams({ specNodes, runRecord: makeRun({ project_id: "proj-campaign" }) }));
    // Both graphs have the same structure from spec, regardless of project_id
    expect(graphA.nodes.map((n) => n.id)).toEqual(graphB.nodes.map((n) => n.id));
    expect(graphA.mode).toBe(graphB.mode);
  });

  it("does not branch on workflow_id — same engine used regardless of workflow", () => {
    const specNodes: WorkflowNode[] = [{ id: "step1", type: "llm", label: "Step 1" }];
    const graphA = buildRunGraph(baseParams({ specNodes, runRecord: makeRun({ workflow_id: "blog-agent-v1" }) }));
    const graphB = buildRunGraph(baseParams({ specNodes, runRecord: makeRun({ workflow_id: "campaign-sandbox-v2" }) }));
    expect(graphA.nodes.map((n) => n.id)).toEqual(graphB.nodes.map((n) => n.id));
    expect(graphA.mode).toBe(graphB.mode);
  });
});

// ── Mode: inferred ────────────────────────────────────────────────────────────

describe("buildRunGraph — inferred mode", () => {
  it("sets mode to inferred when no specNodes are provided", () => {
    const graph = buildRunGraph(baseParams());
    expect(graph.mode).toBe("inferred");
  });

  it("sets mode to inferred when specNodes is an empty array", () => {
    const graph = buildRunGraph(baseParams({ specNodes: [] }));
    expect(graph.mode).toBe("inferred");
  });

  it("infers stages from observed trace events in chronological order", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "fetch_data", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_completed", node_id: "fetch_data", timestamp: "2026-06-01T10:01:00.000Z" }),
      makeEvent({ event_id: "e3", event_type: "node_started", node_id: "process_data", timestamp: "2026-06-01T10:02:00.000Z" }),
      makeEvent({ event_id: "e4", event_type: "node_completed", node_id: "process_data", timestamp: "2026-06-01T10:03:00.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    expect(graph.nodes.map((n) => n.id)).toEqual(["fetch_data", "process_data"]);
    expect(graph.nodes[0].status).toBe("completed");
  });

  it("returns an empty graph for a run with no node-level events", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "run_started", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "run_completed", timestamp: "2026-06-01T10:05:00.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    expect(graph.nodes).toHaveLength(0);
    expect(graph.lanes).toHaveLength(0);
  });

  it("infers sequential edges between all nodes", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_started", node_id: "b", timestamp: "2026-06-01T10:01:00.000Z" }),
      makeEvent({ event_id: "e3", event_type: "node_started", node_id: "c", timestamp: "2026-06-01T10:02:00.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    expect(graph.edges).toEqual([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ]);
  });

  it("does not create a node for every raw trace event — only one per stage", () => {
    // 8 events for 2 stages → 2 nodes
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "model_call_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:01.000Z" }),
      makeEvent({ event_id: "e3", event_type: "model_call_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:05.000Z" }),
      makeEvent({ event_id: "e4", event_type: "node_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:06.000Z" }),
      makeEvent({ event_id: "e5", event_type: "node_started", node_id: "stage_b", timestamp: "2026-06-01T10:01:00.000Z" }),
      makeEvent({ event_id: "e6", event_type: "tool_call_started", node_id: "stage_b", timestamp: "2026-06-01T10:01:01.000Z" }),
      makeEvent({ event_id: "e7", event_type: "tool_call_completed", node_id: "stage_b", timestamp: "2026-06-01T10:01:05.000Z" }),
      makeEvent({ event_id: "e8", event_type: "node_completed", node_id: "stage_b", timestamp: "2026-06-01T10:01:06.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0].id).toBe("stage_a");
    expect(graph.nodes[1].id).toBe("stage_b");
  });

  it("unknown integration still gets a usable graph", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "step1", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_completed", node_id: "step1", timestamp: "2026-06-01T10:01:00.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents, runRecord: makeRun({ project_id: "unknown-project", workflow_id: "unknown-workflow" }) }));
    expect(graph.nodes).toHaveLength(1);
    expect(graph.lanes).toHaveLength(1);
    expect(graph.mode).toBe("inferred");
  });
});

// ── Lane inference ────────────────────────────────────────────────────────────

describe("buildRunGraph — lane inference", () => {
  it("uses a default lane named 'Workflow' when no lane metadata exists", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "step1", timestamp: "2026-06-01T10:00:00.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    expect(graph.lanes).toHaveLength(1);
    expect(graph.lanes[0].label).toBe("Workflow");
    expect(graph.lanes[0].nodeIds).toContain("step1");
  });

  it("reads lane from metadata.lane on trace events", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "research_step", timestamp: "2026-06-01T10:00:00.000Z", metadata: { lane: "Research" } }),
      makeEvent({ event_id: "e2", event_type: "node_started", node_id: "writing_step", timestamp: "2026-06-01T10:01:00.000Z", metadata: { lane: "Writing" } }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const laneLabels = graph.lanes.map((l) => l.label);
    expect(laneLabels).toContain("Research");
    expect(laneLabels).toContain("Writing");
    expect(graph.lanes.find((l) => l.label === "Research")?.nodeIds).toContain("research_step");
    expect(graph.lanes.find((l) => l.label === "Writing")?.nodeIds).toContain("writing_step");
  });

  it("reads lane from metadata.agent on trace events", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "step1", timestamp: "2026-06-01T10:00:00.000Z", metadata: { agent: "Researcher Agent" } }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    expect(graph.lanes[0].label).toBe("Researcher Agent");
  });

  it("reads lane from metadata.role on trace events", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "step1", timestamp: "2026-06-01T10:00:00.000Z", metadata: { role: "editor" } }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    expect(graph.lanes[0].label).toBe("editor");
  });

  it("reads lane from metadata.stage_group on trace events", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "step1", timestamp: "2026-06-01T10:00:00.000Z", metadata: { stage_group: "Data Pipeline" } }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    expect(graph.lanes[0].label).toBe("Data Pipeline");
  });

  it("reads lane from metadata.owner on trace events", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "step1", timestamp: "2026-06-01T10:00:00.000Z", metadata: { owner: "search-agent" } }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    expect(graph.lanes[0].label).toBe("search-agent");
  });

  it("groups multiple nodes into the same lane when they share a lane value", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "step1", timestamp: "2026-06-01T10:00:00.000Z", metadata: { lane: "Processing" } }),
      makeEvent({ event_id: "e2", event_type: "node_started", node_id: "step2", timestamp: "2026-06-01T10:01:00.000Z", metadata: { lane: "Processing" } }),
      makeEvent({ event_id: "e3", event_type: "node_started", node_id: "step3", timestamp: "2026-06-01T10:02:00.000Z", metadata: { lane: "Output" } }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    expect(graph.lanes).toHaveLength(2);
    const processing = graph.lanes.find((l) => l.label === "Processing");
    expect(processing?.nodeIds).toEqual(["step1", "step2"]);
  });

  it("falls back to 'Workflow' lane for nodes with no lane metadata, even when other nodes have lanes", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "step1", timestamp: "2026-06-01T10:00:00.000Z", metadata: { lane: "Research" } }),
      makeEvent({ event_id: "e2", event_type: "node_started", node_id: "step2", timestamp: "2026-06-01T10:01:00.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const node2 = graph.nodes.find((n) => n.id === "step2");
    expect(node2?.laneId).toBe("workflow");
  });
});

// ── Attachment association ────────────────────────────────────────────────────

describe("buildRunGraph — attachments", () => {
  it("associates model call events with the correct stage node", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "draft", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({
        event_id: "e2",
        event_type: "model_call_completed",
        node_id: "draft",
        timestamp: "2026-06-01T10:00:03.000Z",
        metadata: { model_name: "gemini-2.5-flash", model_provider: "google" },
        cost_usd: 0.001,
        duration_ms: 1800,
      }),
      makeEvent({ event_id: "e3", event_type: "node_completed", node_id: "draft", timestamp: "2026-06-01T10:00:05.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const node = graph.nodes.find((n) => n.id === "draft")!;
    expect(node.modelCallCount).toBeGreaterThan(0);
    const modelAttachment = node.attachments.find((a) => a.kind === "model_call");
    expect(modelAttachment).toBeDefined();
    expect(modelAttachment?.label).toBe("gemini-2.5-flash");
    expect(modelAttachment?.costUsd).toBe(0.001);
  });

  it("associates tool call records with the correct stage node", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "research", timestamp: "2026-06-01T10:00:00.000Z" }),
    ];
    const toolCalls: ToolCallRecord[] = [
      makeToolCall({ tool_call_id: "tc1", tool_name: "web_search", node_id: "research", output_summary: "Found 5 sources." }),
      makeToolCall({ tool_call_id: "tc2", tool_name: "web_search", node_id: "other_node", output_summary: "Other." }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents, toolCalls }));
    const node = graph.nodes.find((n) => n.id === "research")!;
    const toolAttachments = node.attachments.filter((a) => a.kind === "tool_call");
    expect(toolAttachments).toHaveLength(1);
    expect(toolAttachments[0].label).toBe("web_search");
  });

  it("associates eval results with the correct stage node", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "draft", timestamp: "2026-06-01T10:00:00.000Z" }),
    ];
    const evalResults: EvalResult[] = [
      makeEval({ eval_id: "ev1", name: "Quality check", type: "output_quality", node_id: "draft", passed: true }),
      makeEval({ eval_id: "ev2", name: "Safety check", type: "safety", node_id: "other_node", passed: true }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents, evalResults }));
    const node = graph.nodes.find((n) => n.id === "draft")!;
    const evalAttachments = node.attachments.filter((a) => a.kind === "eval");
    expect(evalAttachments).toHaveLength(1);
    expect(evalAttachments[0].label).toBe("Quality check");
  });

  it("associates artifact_created events with the correct stage node", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "packaging", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({
        event_id: "e2",
        event_type: "artifact_created",
        node_id: "packaging",
        timestamp: "2026-06-01T10:00:05.000Z",
        metadata: { artifact_ref: "article_markdown", artifact_type: "article_markdown" },
        output_summary: "Generated blog article.",
      }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const node = graph.nodes.find((n) => n.id === "packaging")!;
    const artifactAttachments = node.attachments.filter((a) => a.kind === "artifact");
    expect(artifactAttachments).toHaveLength(1);
    expect(artifactAttachments[0].label).toBe("article_markdown");
  });

  it("associates issue attachments with the stage that generated the error", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "web_extract", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({
        event_id: "e2",
        event_type: "tool_call_failed",
        node_id: "web_extract",
        timestamp: "2026-06-01T10:00:03.000Z",
        output_summary: "Timeout after 30s.",
      }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const node = graph.nodes.find((n) => n.id === "web_extract")!;
    const issueAttachments = node.attachments.filter((a) => a.kind === "issue");
    expect(issueAttachments.length).toBeGreaterThan(0);
    expect(node.issueCount).toBeGreaterThan(0);
  });
});

// ── Summary metrics ───────────────────────────────────────────────────────────

describe("buildRunGraph — summary metrics", () => {
  it("counts completed, failed, warning, and not_observed stages correctly", () => {
    const specNodes: WorkflowNode[] = [
      { id: "s_completed", type: "llm", label: "Completed" },
      { id: "s_failed", type: "llm", label: "Failed" },
      { id: "s_not_observed", type: "llm", label: "Not Observed" },
    ];
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "s_completed", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_completed", node_id: "s_completed", timestamp: "2026-06-01T10:00:05.000Z" }),
      makeEvent({ event_id: "e3", event_type: "node_started", node_id: "s_failed", timestamp: "2026-06-01T10:01:00.000Z" }),
      makeEvent({ event_id: "e4", event_type: "node_failed", node_id: "s_failed", timestamp: "2026-06-01T10:01:05.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ specNodes, traceEvents }));
    expect(graph.summary.completedStages).toBe(1);
    expect(graph.summary.failedStages).toBe(1);
    expect(graph.summary.notObservedStages).toBe(1);
    expect(graph.summary.totalStages).toBe(3);
  });

  it("counts total model calls, tool calls, and evals across all stages", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "model_call_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:02.000Z" }),
      makeEvent({ event_id: "e3", event_type: "model_call_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:04.000Z" }),
      makeEvent({ event_id: "e4", event_type: "node_started", node_id: "stage_b", timestamp: "2026-06-01T10:01:00.000Z" }),
      makeEvent({ event_id: "e5", event_type: "model_call_completed", node_id: "stage_b", timestamp: "2026-06-01T10:01:02.000Z" }),
    ];
    const evalResults: EvalResult[] = [
      makeEval({ eval_id: "ev1", name: "Quality", type: "output_quality", node_id: "stage_a" }),
      makeEval({ eval_id: "ev2", name: "Safety", type: "safety", node_id: "stage_b" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents, evalResults }));
    expect(graph.summary.totalModelCalls).toBe(3);
    expect(graph.summary.totalEvals).toBe(2);
  });
});

// ── BlogAgent fixture — spec-driven, not hard-coded ───────────────────────────

describe("buildRunGraph — BlogAgent fixture via WorkflowSpec data", () => {
  const BLOGAGENT_SPEC_NODES: WorkflowNode[] = [
    { id: "intake_request_parsing", type: "trigger", label: "Intake Request Parsing" },
    { id: "generate_research_questions", type: "llm", label: "Generate Research Questions" },
    { id: "topic_product_research", type: "agent", label: "Topic/Product Research" },
    { id: "extract_webpages", type: "tool", label: "Extract Webpages" },
    { id: "score_sources", type: "evaluator", label: "Score Sources" },
    { id: "outline_generation", type: "llm", label: "Outline Generation" },
    { id: "draft_writing", type: "llm", label: "Draft Writing" },
    { id: "seo_optimization", type: "llm", label: "SEO Optimization" },
    { id: "reviewer_critic_pass", type: "evaluator", label: "Reviewer/Critic Pass" },
    { id: "final_article_packaging", type: "artifact", label: "Final Article Packaging" },
  ];

  it("renders BlogAgent workflow from spec data — no hard-coded stage order in the engine", () => {
    // Simulated BlogAgent trace with out-of-order events
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "draft_writing", timestamp: "2026-06-01T10:06:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_completed", node_id: "draft_writing", timestamp: "2026-06-01T10:07:00.000Z" }),
      makeEvent({ event_id: "e3", event_type: "node_started", node_id: "intake_request_parsing", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e4", event_type: "node_completed", node_id: "intake_request_parsing", timestamp: "2026-06-01T10:00:05.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ specNodes: BLOGAGENT_SPEC_NODES, traceEvents }));

    // Structure comes from spec — not from hard-coded engine logic
    expect(graph.mode).toBe("registered_spec");
    expect(graph.nodes.map((n) => n.id)).toEqual(BLOGAGENT_SPEC_NODES.map((n) => n.id));
    expect(graph.nodes.find((n) => n.id === "draft_writing")?.status).toBe("completed");
    expect(graph.nodes.find((n) => n.id === "outline_generation")?.status).toBe("not_observed");
    expect(graph.summary.notObservedStages).toBe(8);
  });

  it("BlogAgent internal nodes go to extraNodes so the primary graph stays clean", () => {
    // Internal implementation nodes (build_query_contract_node etc.) not in spec
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "draft_writing", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_completed", node_id: "draft_writing", timestamp: "2026-06-01T10:01:00.000Z" }),
      makeEvent({ event_id: "e3", event_type: "node_started", node_id: "build_query_contract_node", timestamp: "2026-06-01T10:01:05.000Z" }),
      makeEvent({ event_id: "e4", event_type: "node_completed", node_id: "build_query_contract_node", timestamp: "2026-06-01T10:01:10.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ specNodes: BLOGAGENT_SPEC_NODES, traceEvents }));

    // Primary nodes are only spec nodes — no internal noise in the main graph.
    const primaryIds = graph.nodes.map((n) => n.id);
    expect(primaryIds).toEqual(BLOGAGENT_SPEC_NODES.map((n) => n.id));
    expect(primaryIds).not.toContain("build_query_contract_node");

    // Internal node is accessible via extraNodes for the inspector.
    const extraIds = graph.extraNodes.map((n) => n.id);
    expect(extraIds).toContain("build_query_contract_node");
  });

  it("same BlogAgent spec works for any project_id or run_id — engine is generic", () => {
    const graphA = buildRunGraph(baseParams({
      specNodes: BLOGAGENT_SPEC_NODES,
      runRecord: makeRun({ project_id: "proj-blogagent", workflow_id: "blog-agent-v2" }),
    }));
    const graphB = buildRunGraph(baseParams({
      specNodes: BLOGAGENT_SPEC_NODES,
      runRecord: makeRun({ project_id: "proj-blog-v2", workflow_id: "blog-generation-v3" }),
    }));
    // Identical graph structure for any project/workflow when spec is the same
    expect(graphA.nodes.map((n) => n.id)).toEqual(graphB.nodes.map((n) => n.id));
    expect(graphA.nodes.map((n) => n.type)).toEqual(graphB.nodes.map((n) => n.type));
  });
});

// ── Graph metadata ────────────────────────────────────────────────────────────

describe("buildRunGraph — graph metadata", () => {
  it("copies workflow_id and project_id from the run record", () => {
    const graph = buildRunGraph(baseParams({
      runRecord: makeRun({ workflow_id: "my-wf", project_id: "my-proj" }),
    }));
    expect(graph.workflow_id).toBe("my-wf");
    expect(graph.project_id).toBe("my-proj");
  });

  it("does not set templateName when not provided", () => {
    const graph = buildRunGraph(baseParams());
    expect(graph.templateName).toBeUndefined();
  });

  it("surfaces global issues (errors across all stages)", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "step1", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({
        event_id: "e2",
        event_type: "node_failed",
        node_id: "step1",
        timestamp: "2026-06-01T10:00:05.000Z",
        output_summary: "Critical failure.",
      }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    expect(graph.issues.length).toBeGreaterThan(0);
    expect(graph.summary.totalIssues).toBeGreaterThan(0);
  });

  it("surfaces artifact cards from artifact_created events", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "output", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({
        event_id: "e2",
        event_type: "artifact_created",
        node_id: "output",
        timestamp: "2026-06-01T10:00:05.000Z",
        metadata: { artifact_ref: "report", artifact_type: "pdf_report" },
      }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    expect(graph.artifacts.length).toBeGreaterThan(0);
    expect(graph.summary.totalArtifacts).toBeGreaterThan(0);
  });
});
