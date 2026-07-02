/**
 * Tests for buildVisualRunGraph — the generic RunGraph → VisualRunGraph
 * re-shaping used by the Visual Execution Canvas.
 *
 * Critical invariants:
 * - No project_id or workflow_id branches anywhere in the builder.
 * - Spec-driven stages become primaryNodes; observed-but-undeclared stages
 *   go to internalNodes, never polluting the primary path.
 * - Every attachment kind maps to the correct evidence node type and edge type.
 * - A recovered issue attachment becomes a "recovery" node, not an "issue" node.
 */

import { describe, expect, it } from "vitest";
import type { EvalResult, RunRecord, ToolCallRecord, TraceEvent, WorkflowNode } from "@/lib/proof-layer/schemas";
import { buildRunGraph } from "@/lib/runs/runGraph";
import type { BuildRunGraphParams } from "@/lib/runs/runGraph";
import { buildVisualRunGraph } from "@/lib/visualGraph/buildVisualRunGraph";

// ── Fixtures (mirrors lib/runs/__tests__/runGraph.test.ts conventions) ────────

function makeRun(partial: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: "run-visual-test",
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
  return { run_id: "run-visual-test", workflow_id: "wf-test", ...partial };
}

function makeToolCall(
  partial: Partial<ToolCallRecord> & Pick<ToolCallRecord, "tool_call_id" | "tool_name" | "node_id">,
): ToolCallRecord {
  return {
    run_id: "run-visual-test",
    permission_class: "read_only",
    status: "completed",
    started_at: "2026-06-01T10:00:00.000Z",
    ...partial,
  };
}

function makeEval(partial: Partial<EvalResult> & Pick<EvalResult, "eval_id" | "name" | "type">): EvalResult {
  return { run_id: "run-visual-test", passed: true, severity: "info", findings: [], ...partial };
}

function baseParams(overrides: Partial<BuildRunGraphParams> = {}): BuildRunGraphParams {
  return { runRecord: makeRun(), traceEvents: [], toolCalls: [], evalResults: [], ...overrides };
}

function buildVisual(params: BuildRunGraphParams) {
  const runGraph = buildRunGraph(params);
  return buildVisualRunGraph({ runGraph, traceEvents: params.traceEvents });
}

// ── Registered spec mode ────────────────────────────────────────────────────

describe("buildVisualRunGraph — registered_spec mode", () => {
  const specNodes: WorkflowNode[] = [
    { id: "stage_a", type: "llm", label: "Stage A" },
    { id: "stage_b", type: "tool", label: "Stage B" },
  ];

  it("maps spec nodes to primaryNodes with kind='primary'", () => {
    const graph = buildVisual(baseParams({ specNodes }));
    expect(graph.mode).toBe("registered_spec");
    expect(graph.primaryNodes).toHaveLength(2);
    expect(graph.primaryNodes.every((n) => n.kind === "primary")).toBe(true);
    expect(graph.primaryNodes.map((n) => n.id)).toEqual(["stage_a", "stage_b"]);
  });

  it("maps spec node types to the correct VisualNodeType", () => {
    const graph = buildVisual(baseParams({ specNodes }));
    const a = graph.primaryNodes.find((n) => n.id === "stage_a")!;
    const b = graph.primaryNodes.find((n) => n.id === "stage_b")!;
    expect(a.type).toBe("model"); // llm -> model
    expect(b.type).toBe("tool"); // tool -> tool
  });

  it("routes observed stages not declared in the spec to internalNodes, not primaryNodes", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "undeclared_stage", timestamp: "2026-06-01T10:00:01.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_completed", node_id: "undeclared_stage", timestamp: "2026-06-01T10:00:02.000Z" }),
    ];
    const graph = buildVisual(baseParams({ specNodes, traceEvents }));
    expect(graph.primaryNodes.map((n) => n.id)).not.toContain("undeclared_stage");
    expect(graph.internalNodes.map((n) => n.id)).toContain("undeclared_stage");
    expect(graph.internalNodes[0]!.kind).toBe("internal");
  });

  it("builds workflow edges from spec edges with type='workflow'", () => {
    const graph = buildVisual(
      baseParams({ specNodes, specEdges: [{ from: "stage_a", to: "stage_b" }] }),
    );
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from: "stage_a", to: "stage_b", type: "workflow" });
  });

  it("computes upstream/downstream ids on primary nodes", () => {
    const graph = buildVisual(
      baseParams({ specNodes, specEdges: [{ from: "stage_a", to: "stage_b" }] }),
    );
    const a = graph.primaryNodes.find((n) => n.id === "stage_a")!;
    const b = graph.primaryNodes.find((n) => n.id === "stage_b")!;
    expect(a.downstreamIds).toEqual(["stage_b"]);
    expect(b.upstreamIds).toEqual(["stage_a"]);
  });
});

// ── Inferred mode ───────────────────────────────────────────────────────────

describe("buildVisualRunGraph — inferred mode", () => {
  it("builds primaryNodes from observed stages with no internalNodes", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_x", timestamp: "2026-06-01T10:00:01.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_completed", node_id: "stage_x", timestamp: "2026-06-01T10:00:02.000Z" }),
    ];
    const graph = buildVisual(baseParams({ traceEvents }));
    expect(graph.mode).toBe("inferred");
    expect(graph.primaryNodes.map((n) => n.id)).toEqual(["stage_x"]);
    expect(graph.internalNodes).toHaveLength(0);
  });
});

// ── Evidence nodes and edges ─────────────────────────────────────────────────

describe("buildVisualRunGraph — evidence attachments", () => {
  const specNodes: WorkflowNode[] = [{ id: "stage_a", type: "agent", label: "Stage A" }];

  function graphWithEvents(traceEvents: TraceEvent[], toolCalls: ToolCallRecord[] = [], evalResults: EvalResult[] = []) {
    return buildVisual(baseParams({ specNodes, traceEvents, toolCalls, evalResults }));
  }

  it("creates a 'model' evidence node with a 'uses' edge for model call events", () => {
    const graph = graphWithEvents([
      makeEvent({
        event_id: "m1",
        event_type: "model_call_completed",
        node_id: "stage_a",
        timestamp: "2026-06-01T10:00:01.000Z",
        cost_usd: 0.0123,
        metadata: { model_provider: "openai", model_name: "gpt-4o", input_tokens: 100, output_tokens: 50, latency_ms: 800 },
      }),
    ]);
    const modelNode = graph.evidenceNodes.find((n) => n.type === "model");
    expect(modelNode).toBeDefined();
    expect(modelNode!.parentId).toBe("stage_a");
    expect(modelNode!.label).toBe("gpt-4o");
    expect(modelNode!.identity.provider).toBe("openai");
    expect(modelNode!.identity.modelName).toBe("gpt-4o");
    expect(modelNode!.metrics.inputTokens).toBe(100);
    expect(modelNode!.metrics.outputTokens).toBe(50);
    expect(modelNode!.metrics.totalTokens).toBe(150);
    expect(modelNode!.metrics.costUsd).toBe(0.0123);
    expect(modelNode!.metrics.latencyMs).toBe(800);
    const edge = graph.evidenceEdges.find((e) => e.to === modelNode!.id);
    expect(edge).toMatchObject({ from: "stage_a", type: "uses" });
  });

  it("creates a 'tool' evidence node with a 'uses' edge for tool calls", () => {
    const graph = graphWithEvents([], [makeToolCall({ tool_call_id: "t1", tool_name: "web_search", node_id: "stage_a" })]);
    const toolNode = graph.evidenceNodes.find((n) => n.type === "tool");
    expect(toolNode).toBeDefined();
    expect(toolNode!.label).toBe("web_search");
    expect(toolNode!.identity.toolSubtype).toBe("web_search");
    expect(graph.evidenceEdges.find((e) => e.to === toolNode!.id)).toMatchObject({ type: "uses" });
  });

  it("creates a 'skill' evidence node for skill_call events", () => {
    const graph = graphWithEvents([
      makeEvent({ event_id: "s1", event_type: "skill_call_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:01.000Z", metadata: { skill_name: "doc-coauthoring" } }),
    ]);
    const skillNode = graph.evidenceNodes.find((n) => n.type === "skill");
    expect(skillNode).toBeDefined();
    expect(skillNode!.label).toBe("doc-coauthoring");
  });

  it("creates a 'cli' evidence node whose label is the actual command, not '$'", () => {
    const graph = graphWithEvents([
      makeEvent({ event_id: "c1", event_type: "cli_call_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:01.000Z", metadata: { cli_command: "npm run build" } }),
    ]);
    const cliNode = graph.evidenceNodes.find((n) => n.type === "cli");
    expect(cliNode).toBeDefined();
    expect(cliNode!.label).toBe("npm run build");
    expect(cliNode!.identity.typeLabel).toBe("CLI");
    expect(cliNode!.identity.badge).toBe("CLI");
    expect(cliNode!.label).not.toBe("$");
  });

  it("creates an 'eval' evidence node with an 'evaluates' edge", () => {
    const graph = graphWithEvents([], [], [makeEval({ eval_id: "ev1", name: "Source grounding", type: "source_grounding", node_id: "stage_a", passed: true })]);
    const evalNode = graph.evidenceNodes.find((n) => n.type === "eval");
    expect(evalNode).toBeDefined();
    expect(evalNode!.status).toBe("completed");
    expect(evalNode!.identity.evalSubtype).toBe("source_evidence");
    expect(graph.evidenceEdges.find((e) => e.to === evalNode!.id)).toMatchObject({ type: "evaluates" });
  });

  it("keeps missing model usage and cost absent instead of inventing zero values", () => {
    const graph = graphWithEvents([
      makeEvent({ event_id: "m1", event_type: "model_call_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:01.000Z", metadata: { model_name: "unknown-model" } }),
    ]);
    const modelNode = graph.evidenceNodes.find((n) => n.type === "model")!;
    expect(modelNode.metrics.inputTokens).toBeUndefined();
    expect(modelNode.metrics.outputTokens).toBeUndefined();
    expect(modelNode.metrics.totalTokens).toBeUndefined();
    expect(modelNode.metrics.costUsd).toBeUndefined();
  });

  it("carries eval score/pass/fail/reason when present", () => {
    const graph = graphWithEvents(
      [],
      [],
      [makeEval({ eval_id: "ev1", name: "Output quality", type: "output_quality", node_id: "stage_a", passed: false, score: 0.42, findings: ["Too vague"] })],
    );
    const evalNode = graph.evidenceNodes.find((n) => n.type === "eval")!;
    expect(evalNode.status).toBe("failed");
    expect(evalNode.metrics.score).toBe(0.42);
    expect(evalNode.metrics.passed).toBe(false);
    expect(evalNode.metrics.reason).toBe("Too vague");
  });

  it("marks a failing eval evidence node as status='failed'", () => {
    const graph = graphWithEvents([], [], [makeEval({ eval_id: "ev1", name: "Source grounding", type: "source_grounding", node_id: "stage_a", passed: false })]);
    const evalNode = graph.evidenceNodes.find((n) => n.type === "eval");
    expect(evalNode!.status).toBe("failed");
  });

  it("creates an 'artifact' evidence node with a 'produces' edge", () => {
    const graph = graphWithEvents([
      makeEvent({ event_id: "a1", event_type: "artifact_created", node_id: "stage_a", timestamp: "2026-06-01T10:00:01.000Z", metadata: { artifact_ref: "report.md" } }),
    ]);
    const artifactNode = graph.evidenceNodes.find((n) => n.type === "artifact");
    expect(artifactNode).toBeDefined();
    expect(artifactNode!.identity.artifactType).toBe("markdown");
    expect(graph.evidenceEdges.find((e) => e.to === artifactNode!.id)).toMatchObject({ type: "produces" });
  });

  it("creates an unrecovered 'issue' evidence node with a 'fails' edge", () => {
    const graph = graphWithEvents([
      makeEvent({ event_id: "err1", event_type: "error", node_id: "stage_a", timestamp: "2026-06-01T10:00:01.000Z", output_summary: "Timeout" }),
    ]);
    const issueNode = graph.evidenceNodes.find((n) => n.type === "issue");
    expect(issueNode).toBeDefined();
    expect(issueNode!.status).not.toBe("recovered");
    expect(issueNode!.identity.typeLabel).toBe("Issue");
    expect(issueNode!.identity.badge).toBe("warning");
    expect(graph.evidenceEdges.find((e) => e.to === issueNode!.id)).toMatchObject({ type: "fails" });
  });

  it("creates a 'recovery' evidence node (not 'issue') with a 'recovers' edge when the issue was recovered", () => {
    const graph = graphWithEvents([
      makeEvent({ event_id: "err1", event_type: "tool_call_failed", node_id: "stage_a", timestamp: "2026-06-01T10:00:01.000Z", output_summary: "Rate limited" }),
      makeEvent({ event_id: "ok1", event_type: "tool_call_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:02.000Z" }),
    ]);
    const recoveryNode = graph.evidenceNodes.find((n) => n.type === "recovery");
    expect(recoveryNode).toBeDefined();
    expect(recoveryNode!.status).toBe("recovered");
    expect(recoveryNode!.identity.typeLabel).toBe("Recovery");
    expect(recoveryNode!.identity.badge).toBe("recovered");
    expect(graph.evidenceNodes.find((n) => n.type === "issue")).toBeUndefined();
    expect(graph.evidenceEdges.find((e) => e.to === recoveryNode!.id)).toMatchObject({ type: "recovers" });
  });
});

// ── Groups and summary passthrough ──────────────────────────────────────────

describe("buildVisualRunGraph — groups and summary", () => {
  it("mirrors RunGraph lanes as VisualGroups", () => {
    const specNodes: WorkflowNode[] = [{ id: "stage_a", type: "agent", label: "Stage A" }];
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:01.000Z", metadata: { lane: "Research" } }),
    ];
    const graph = buildVisual(baseParams({ specNodes, traceEvents }));
    expect(graph.groups).toHaveLength(1);
    expect(graph.groups[0]).toMatchObject({ label: "Research", nodeIds: ["stage_a"] });
  });

  it("passes RunGraph summary through unchanged", () => {
    const specNodes: WorkflowNode[] = [{ id: "stage_a", type: "agent", label: "Stage A" }];
    const runGraph = buildRunGraph(baseParams({ specNodes }));
    const graph = buildVisualRunGraph({ runGraph, traceEvents: [] });
    expect(graph.summary).toBe(runGraph.summary);
  });

  it("handles an empty run gracefully", () => {
    const graph = buildVisual(baseParams());
    expect(graph.primaryNodes).toEqual([]);
    expect(graph.internalNodes).toEqual([]);
    expect(graph.evidenceNodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.evidenceEdges).toEqual([]);
  });
});

// ── Agent visibility ─────────────────────────────────────────────────────────

describe("buildVisualRunGraph — agent visibility", () => {
  const specNodes: WorkflowNode[] = [{ id: "stage_a", type: "llm", label: "Stage A" }];

  it("creates an 'agent' evidence node with a 'contains' edge when agent metadata is present", () => {
    const graph = buildVisual(
      baseParams({
        specNodes,
        traceEvents: [
          makeEvent({
            event_id: "e1",
            event_type: "node_started",
            node_id: "stage_a",
            timestamp: "2026-06-01T10:00:01.000Z",
            metadata: { agent_name: "Writer Agent", role: "writer", owner: "content-team" },
          }),
        ],
      }),
    );
    const agentNode = graph.evidenceNodes.find((n) => n.type === "agent");
    expect(agentNode).toBeDefined();
    expect(agentNode!.parentId).toBe("stage_a");
    expect(agentNode!.identity.agentName).toBe("Writer Agent");
    expect(agentNode!.identity.agentRole).toBe("writer");
    expect(agentNode!.identity.agentOwner).toBe("content-team");
    const edge = graph.evidenceEdges.find((e) => e.to === agentNode!.id);
    expect(edge).toMatchObject({ from: "stage_a", type: "contains" });
  });

  it("also surfaces agent identity directly on the owning stage node", () => {
    const graph = buildVisual(
      baseParams({
        specNodes,
        traceEvents: [
          makeEvent({
            event_id: "e1",
            event_type: "node_started",
            node_id: "stage_a",
            timestamp: "2026-06-01T10:00:01.000Z",
            metadata: { agent: "Researcher Agent", role: "researcher" },
          }),
        ],
      }),
    );
    const stage = graph.primaryNodes.find((n) => n.id === "stage_a")!;
    expect(stage.identity.agentName).toBe("Researcher Agent");
    expect(stage.identity.agentRole).toBe("researcher");
  });

  it("never invents an agent node when no agent metadata is present", () => {
    const graph = buildVisual(
      baseParams({
        specNodes,
        traceEvents: [
          makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:01.000Z" }),
        ],
      }),
    );
    expect(graph.evidenceNodes.some((n) => n.type === "agent")).toBe(false);
    const stage = graph.primaryNodes.find((n) => n.id === "stage_a")!;
    expect(stage.identity.agentName).toBeUndefined();
  });
});

// ── Reasoning / decision notes ───────────────────────────────────────────────

describe("buildVisualRunGraph — reasoning notes", () => {
  const specNodes: WorkflowNode[] = [{ id: "stage_a", type: "llm", label: "Stage A" }];

  it("carries user-safe agent notes onto the owning primary node", () => {
    const graph = buildVisual(
      baseParams({
        specNodes,
        traceEvents: [
          makeEvent({
            event_id: "note1",
            event_type: "agent_note_recorded",
            node_id: "stage_a",
            timestamp: "2026-06-01T10:00:01.000Z",
            metadata: { note_type: "plan", agent: "Writer Agent", summary: "Outline before drafting.", confidence: "high", visibility: "user_safe" },
          }),
        ],
      }),
    );
    const stage = graph.primaryNodes.find((n) => n.id === "stage_a")!;
    expect(stage.notes).toHaveLength(1);
    expect(stage.notes![0]).toMatchObject({ noteType: "plan", agent: "Writer Agent", summary: "Outline before drafting.", confidence: "high" });
  });

  it("drops notes without visibility: user_safe", () => {
    const graph = buildVisual(
      baseParams({
        specNodes,
        traceEvents: [
          makeEvent({
            event_id: "note1",
            event_type: "agent_note_recorded",
            node_id: "stage_a",
            timestamp: "2026-06-01T10:00:01.000Z",
            metadata: { note_type: "plan", summary: "Should not render.", visibility: "internal_only" },
          }),
        ],
      }),
    );
    const stage = graph.primaryNodes.find((n) => n.id === "stage_a")!;
    expect(stage.notes).toEqual([]);
  });

  it("defaults to an empty notes array when no notes are emitted", () => {
    const graph = buildVisual(baseParams({ specNodes }));
    const stage = graph.primaryNodes.find((n) => n.id === "stage_a")!;
    expect(stage.notes).toEqual([]);
  });
});
