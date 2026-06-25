/**
 * Tests for the visual execution graph improvements:
 * - skill / CLI attachment extraction
 * - recovered issue attachment flag
 * - cliCount and skillCount fields
 * - stable edge generation
 * - no hard-coded integration branching
 * - extra internal nodes stay out of the primary spec graph
 * - fallback inferred layout
 * - source code checks for visual component data-testids
 *
 * These tests complement the existing runGraph.test.ts and workflowGraphUX.test.ts.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildRunGraph } from "@/lib/runs/runGraph";
import type {
  EvalResult,
  RunRecord,
  ToolCallRecord,
  TraceEvent,
  WorkflowEdge,
  WorkflowNode,
} from "@/lib/proof-layer/schemas";
import type { BuildRunGraphParams } from "@/lib/runs/runGraph";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../../");

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRun(partial: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: "run-visual-test",
    workflow_id: "wf-visual",
    project_id: "proj-visual",
    project_name: "Visual Test Project",
    status: "completed",
    started_at: "2026-06-01T10:00:00.000Z",
    completed_at: "2026-06-01T10:05:00.000Z",
    model_calls_count: 0,
    tool_calls_count: 0,
    evals_passed: 0,
    evals_failed: 0,
    artifact_refs: [],
    summary: "Visual graph test run.",
    ...partial,
  };
}

function makeEvent(
  partial: Partial<TraceEvent> & Pick<TraceEvent, "event_id" | "event_type" | "timestamp">,
): TraceEvent {
  return { run_id: "run-visual-test", workflow_id: "wf-visual", ...partial };
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

// ── Skill attachment extraction ───────────────────────────────────────────────

describe("skill attachment extraction", () => {
  it("extracts skill attachments from skill_call_completed events", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({
        event_id: "e2",
        event_type: "skill_call_completed",
        node_id: "stage_a",
        timestamp: "2026-06-01T10:00:02.000Z",
        metadata: { skill_name: "web_search_skill" },
        duration_ms: 1200,
        output_summary: "Retrieved 5 results.",
      }),
      makeEvent({ event_id: "e3", event_type: "node_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:05.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const node = graph.nodes.find((n) => n.id === "stage_a")!;

    expect(node.skillCount).toBeGreaterThan(0);
    const skillAttachment = node.attachments.find((a) => a.kind === "skill");
    expect(skillAttachment).toBeDefined();
    expect(skillAttachment?.label).toBe("web_search_skill");
    expect(skillAttachment?.durationMs).toBe(1200);
  });

  it("extracts skill attachments from skill_call_started events", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({
        event_id: "e2",
        event_type: "skill_call_started",
        node_id: "stage_a",
        timestamp: "2026-06-01T10:00:01.000Z",
        metadata: { skill_name: "citation_skill" },
      }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const node = graph.nodes.find((n) => n.id === "stage_a")!;
    expect(node.skillCount).toBeGreaterThan(0);
    expect(node.attachments.find((a) => a.kind === "skill")?.label).toBe("citation_skill");
  });

  it("extracts skill name from metadata.skill when skill_name absent", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({
        event_id: "e2",
        event_type: "skill_call_completed",
        node_id: "stage_a",
        timestamp: "2026-06-01T10:00:02.000Z",
        metadata: { skill: "outline_generator" },
      }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const node = graph.nodes.find((n) => n.id === "stage_a")!;
    expect(node.attachments.find((a) => a.kind === "skill")?.label).toBe("outline_generator");
  });

  it("extracts skill from metadata.skill_name without explicit event_type", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({
        event_id: "e2",
        event_type: "node_completed",
        node_id: "stage_a",
        timestamp: "2026-06-01T10:00:02.000Z",
        metadata: { skill_name: "summarizer_skill" },
      }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const node = graph.nodes.find((n) => n.id === "stage_a")!;
    expect(node.attachments.find((a) => a.kind === "skill")?.label).toBe("summarizer_skill");
  });

  it("does not extract skills from model_call events even if metadata.skill_name is set", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({
        event_id: "e2",
        event_type: "model_call_completed",
        node_id: "stage_a",
        timestamp: "2026-06-01T10:00:02.000Z",
        metadata: { model_name: "gemini-2.5-flash", skill_name: "should-be-ignored" },
      }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const node = graph.nodes.find((n) => n.id === "stage_a")!;
    // model_call events are extracted as model calls, not skills
    expect(node.attachments.filter((a) => a.kind === "skill")).toHaveLength(0);
    expect(node.attachments.filter((a) => a.kind === "model_call")).toHaveLength(1);
  });

  it("skillCount reflects the number of skill attachments", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "skill_call_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:01.000Z", metadata: { skill_name: "skill_1" } }),
      makeEvent({ event_id: "e3", event_type: "skill_call_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:02.000Z", metadata: { skill_name: "skill_2" } }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const node = graph.nodes.find((n) => n.id === "stage_a")!;
    expect(node.skillCount).toBe(2);
  });
});

// ── CLI attachment extraction ─────────────────────────────────────────────────

describe("CLI attachment extraction", () => {
  it("extracts CLI attachments from cli_call_completed events", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({
        event_id: "e2",
        event_type: "cli_call_completed",
        node_id: "stage_a",
        timestamp: "2026-06-01T10:00:02.000Z",
        metadata: { cli_command: "npm run build" },
        duration_ms: 4500,
        output_summary: "Build succeeded in 4.5s.",
      }),
      makeEvent({ event_id: "e3", event_type: "node_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:10.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const node = graph.nodes.find((n) => n.id === "stage_a")!;

    expect(node.cliCount).toBeGreaterThan(0);
    const cliAttachment = node.attachments.find((a) => a.kind === "cli");
    expect(cliAttachment).toBeDefined();
    expect(cliAttachment?.label).toBe("npm run build");
    expect(cliAttachment?.durationMs).toBe(4500);
  });

  it("extracts CLI attachments from cli_call_started events", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({
        event_id: "e2",
        event_type: "cli_call_started",
        node_id: "stage_a",
        timestamp: "2026-06-01T10:00:01.000Z",
        metadata: { cli_command: "python train.py" },
      }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const node = graph.nodes.find((n) => n.id === "stage_a")!;
    expect(node.cliCount).toBeGreaterThan(0);
    expect(node.attachments.find((a) => a.kind === "cli")?.label).toBe("python train.py");
  });

  it("extracts CLI from metadata.cli_command on any event type", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({
        event_id: "e2",
        event_type: "node_completed",
        node_id: "stage_a",
        timestamp: "2026-06-01T10:00:02.000Z",
        metadata: { cli_command: "git diff --stat" },
      }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const node = graph.nodes.find((n) => n.id === "stage_a")!;
    expect(node.attachments.find((a) => a.kind === "cli")?.label).toBe("git diff --stat");
  });

  it("cliCount reflects the number of CLI attachments", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "cli_call_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:01.000Z", metadata: { cli_command: "cmd1" } }),
      makeEvent({ event_id: "e3", event_type: "cli_call_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:02.000Z", metadata: { cli_command: "cmd2" } }),
      makeEvent({ event_id: "e4", event_type: "cli_call_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:03.000Z", metadata: { cli_command: "cmd3" } }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const node = graph.nodes.find((n) => n.id === "stage_a")!;
    expect(node.cliCount).toBe(3);
  });
});

// ── Recovered issue attachment ────────────────────────────────────────────────

describe("recovered issue attachment", () => {
  it("marks issue attachments as recovered when the node later completes", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "tool_call_failed", node_id: "stage_a", timestamp: "2026-06-01T10:00:02.000Z", output_summary: "Timeout." }),
      makeEvent({ event_id: "e3", event_type: "node_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:10.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const node = graph.nodes.find((n) => n.id === "stage_a")!;
    const issueAttachment = node.attachments.find((a) => a.kind === "issue");
    expect(issueAttachment).toBeDefined();
    expect(issueAttachment?.recovered).toBe(true);
  });

  it("does not mark issue as recovered when the node also fails", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "tool_call_failed", node_id: "stage_a", timestamp: "2026-06-01T10:00:02.000Z", output_summary: "Timeout." }),
      makeEvent({ event_id: "e3", event_type: "node_failed", node_id: "stage_a", timestamp: "2026-06-01T10:00:05.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    const node = graph.nodes.find((n) => n.id === "stage_a")!;
    const issueAttachments = node.attachments.filter((a) => a.kind === "issue");
    // At least one issue should not be recovered
    expect(issueAttachments.some((a) => !a.recovered)).toBe(true);
  });
});

// ── Mixed skill / CLI / tool attachments ──────────────────────────────────────

describe("mixed skill, CLI, and tool attachments in the same stage", () => {
  it("correctly separates skill, CLI, tool, and model attachments by kind", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "stage_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "model_call_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:01.000Z", metadata: { model_name: "gpt-4o" } }),
      makeEvent({ event_id: "e3", event_type: "skill_call_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:02.000Z", metadata: { skill_name: "fact_checker" } }),
      makeEvent({ event_id: "e4", event_type: "cli_call_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:03.000Z", metadata: { cli_command: "git log --oneline -5" } }),
      makeEvent({ event_id: "e5", event_type: "node_completed", node_id: "stage_a", timestamp: "2026-06-01T10:00:05.000Z" }),
    ];
    const toolCalls = [
      {
        tool_call_id: "tc1",
        run_id: "run-visual-test",
        tool_name: "web_search",
        node_id: "stage_a",
        permission_class: "read_only" as const,
        status: "completed" as const,
        started_at: "2026-06-01T10:00:01.500Z",
      },
    ];
    const graph = buildRunGraph(baseParams({ traceEvents, toolCalls }));
    const node = graph.nodes.find((n) => n.id === "stage_a")!;

    expect(node.modelCallCount).toBe(1);
    expect(node.toolCallCount).toBe(1);
    expect(node.skillCount).toBe(1);
    expect(node.cliCount).toBe(1);

    const kinds = node.attachments.map((a) => a.kind);
    expect(kinds).toContain("model_call");
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("skill");
    expect(kinds).toContain("cli");
  });
});

// ── Stable edge generation ─────────────────────────────────────────────────────

describe("stable edge generation", () => {
  it("produces the same edges for the same spec regardless of project_id", () => {
    const specNodes: WorkflowNode[] = [
      { id: "a", type: "llm", label: "A" },
      { id: "b", type: "llm", label: "B" },
      { id: "c", type: "llm", label: "C" },
    ];
    const specEdges: WorkflowEdge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];

    const graphX = buildRunGraph(baseParams({ specNodes, specEdges, runRecord: makeRun({ project_id: "proj-x" }) }));
    const graphY = buildRunGraph(baseParams({ specNodes, specEdges, runRecord: makeRun({ project_id: "proj-y" }) }));

    expect(graphX.edges).toEqual(graphY.edges);
  });

  it("inferred mode produces sequential edges for observed nodes", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "node_1", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_started", node_id: "node_2", timestamp: "2026-06-01T10:01:00.000Z" }),
      makeEvent({ event_id: "e3", event_type: "node_started", node_id: "node_3", timestamp: "2026-06-01T10:02:00.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    expect(graph.edges).toEqual([
      { from: "node_1", to: "node_2" },
      { from: "node_2", to: "node_3" },
    ]);
  });

  it("inferred mode with a single node produces no edges", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "solo_node", timestamp: "2026-06-01T10:00:00.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    expect(graph.edges).toHaveLength(0);
  });

  it("spec edges that reference missing nodes are filtered out", () => {
    const specNodes: WorkflowNode[] = [
      { id: "a", type: "llm", label: "A" },
      { id: "b", type: "llm", label: "B" },
    ];
    const specEdges: WorkflowEdge[] = [
      { from: "a", to: "b" },
      { from: "a", to: "ghost_node" },  // ghost_node not in primary nodes
    ];
    const graph = buildRunGraph(baseParams({ specNodes, specEdges }));
    // Only valid edges (both ends in primary node set) are kept
    expect(graph.edges.every((e) => {
      const ids = graph.nodes.map((n) => n.id);
      return ids.includes(e.from) && ids.includes(e.to);
    })).toBe(true);
  });
});

// ── Extra nodes out of primary graph ──────────────────────────────────────────

describe("extra internal nodes stay out of the primary spec graph", () => {
  it("internal nodes not in spec appear in extraNodes, not in nodes", () => {
    const specNodes: WorkflowNode[] = [
      { id: "spec_a", type: "llm", label: "Spec A" },
      { id: "spec_b", type: "llm", label: "Spec B" },
    ];
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "spec_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_completed", node_id: "spec_a", timestamp: "2026-06-01T10:00:05.000Z" }),
      makeEvent({ event_id: "e3", event_type: "node_started", node_id: "internal_step_1", timestamp: "2026-06-01T10:00:06.000Z" }),
      makeEvent({ event_id: "e4", event_type: "node_completed", node_id: "internal_step_1", timestamp: "2026-06-01T10:00:08.000Z" }),
      makeEvent({ event_id: "e5", event_type: "node_started", node_id: "internal_step_2", timestamp: "2026-06-01T10:00:09.000Z" }),
      makeEvent({ event_id: "e6", event_type: "node_completed", node_id: "internal_step_2", timestamp: "2026-06-01T10:00:11.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ specNodes, traceEvents }));

    // Primary graph: only spec nodes
    expect(graph.nodes.map((n) => n.id)).toEqual(["spec_a", "spec_b"]);
    // Internal nodes: in extraNodes
    const extraIds = graph.extraNodes.map((n) => n.id);
    expect(extraIds).toContain("internal_step_1");
    expect(extraIds).toContain("internal_step_2");
  });

  it("extraNodes have skill and CLI attachments populated", () => {
    const specNodes: WorkflowNode[] = [
      { id: "spec_a", type: "llm", label: "Spec A" },
    ];
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "internal_node", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "skill_call_completed", node_id: "internal_node", timestamp: "2026-06-01T10:00:01.000Z", metadata: { skill_name: "internal_skill" } }),
      makeEvent({ event_id: "e3", event_type: "cli_call_completed", node_id: "internal_node", timestamp: "2026-06-01T10:00:02.000Z", metadata: { cli_command: "ls -la" } }),
      makeEvent({ event_id: "e4", event_type: "node_completed", node_id: "internal_node", timestamp: "2026-06-01T10:00:03.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ specNodes, traceEvents }));

    const extraNode = graph.extraNodes.find((n) => n.id === "internal_node");
    expect(extraNode).toBeDefined();
    expect(extraNode!.skillCount).toBe(1);
    expect(extraNode!.cliCount).toBe(1);
  });
});

// ── Fallback inferred layout ──────────────────────────────────────────────────

describe("fallback inferred layout", () => {
  it("unknown project/workflow falls back to inferred mode with all nodes primary", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "step1", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_completed", node_id: "step1", timestamp: "2026-06-01T10:00:05.000Z" }),
      makeEvent({ event_id: "e3", event_type: "node_started", node_id: "step2", timestamp: "2026-06-01T10:01:00.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({
      traceEvents,
      runRecord: makeRun({ project_id: "unknown-project", workflow_id: "unknown-workflow" }),
    }));

    expect(graph.mode).toBe("inferred");
    expect(graph.nodes.map((n) => n.id)).toContain("step1");
    expect(graph.nodes.map((n) => n.id)).toContain("step2");
    expect(graph.extraNodes).toHaveLength(0);
  });

  it("inferred mode with no node events produces an empty graph (not a crash)", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "run_started", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "run_completed", timestamp: "2026-06-01T10:05:00.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));

    expect(graph.nodes).toHaveLength(0);
    expect(graph.extraNodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.summary.totalStages).toBe(0);
  });

  it("inferred mode assigns default lane label 'Workflow' when no lane metadata present", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "step_x", timestamp: "2026-06-01T10:00:00.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    expect(graph.lanes[0]?.label).toBe("Workflow");
  });
});

// ── No hard-coded integration branching ───────────────────────────────────────

describe("no hard-coded integration branching", () => {
  it("same spec produces identical graphs for any project_id", () => {
    const specNodes: WorkflowNode[] = [
      { id: "intake", type: "trigger", label: "Intake" },
      { id: "process", type: "llm", label: "Process" },
      { id: "output", type: "artifact", label: "Output" },
    ];

    const graphA = buildRunGraph(baseParams({ specNodes, runRecord: makeRun({ project_id: "proj-alpha" }) }));
    const graphB = buildRunGraph(baseParams({ specNodes, runRecord: makeRun({ project_id: "proj-beta-v2" }) }));
    const graphC = buildRunGraph(baseParams({ specNodes, runRecord: makeRun({ project_id: "proj-unknown-xyz" }) }));

    expect(graphA.nodes.map((n) => n.id)).toEqual(graphB.nodes.map((n) => n.id));
    expect(graphB.nodes.map((n) => n.id)).toEqual(graphC.nodes.map((n) => n.id));
    expect(graphA.mode).toBe(graphB.mode);
    expect(graphB.mode).toBe(graphC.mode);
  });

  it("same spec produces identical graphs for any workflow_id", () => {
    const specNodes: WorkflowNode[] = [
      { id: "n1", type: "llm", label: "N1" },
      { id: "n2", type: "llm", label: "N2" },
    ];
    const graphX = buildRunGraph(baseParams({ specNodes, runRecord: makeRun({ workflow_id: "wf-blog-v1" }) }));
    const graphY = buildRunGraph(baseParams({ specNodes, runRecord: makeRun({ workflow_id: "wf-campaign-v3" }) }));

    expect(graphX.nodes.map((n) => n.id)).toEqual(graphY.nodes.map((n) => n.id));
  });
});

// ── Visual component source code checks ───────────────────────────────────────

describe("RunWorkflowGraph visual component — source code checks", () => {
  const graphSource = readFileSync(
    path.join(root, "components/proof-layer/RunWorkflowGraph.tsx"),
    "utf8",
  );

  it("has data-testid for the main graph container", () => {
    expect(graphSource).toContain('data-testid="run-workflow-graph"');
  });

  it("has data-testid for the registered spec mode badge", () => {
    expect(graphSource).toContain('data-testid="graph-mode-registered"');
  });

  it("has data-testid for the inferred mode badge", () => {
    expect(graphSource).toContain('data-testid="graph-mode-inferred"');
  });

  it("renders exactly one mode badge (ternary, not both)", () => {
    // Both testids exist in the source, and exactly one condition governs them
    const registeredPos = graphSource.indexOf('data-testid="graph-mode-registered"');
    const inferredPos = graphSource.indexOf('data-testid="graph-mode-inferred"');
    expect(registeredPos).toBeGreaterThan(-1);
    expect(inferredPos).toBeGreaterThan(-1);
    // Only one occurrence of each (no duplication)
    expect(graphSource.indexOf('data-testid="graph-mode-registered"', registeredPos + 1)).toBe(-1);
    expect(graphSource.indexOf('data-testid="graph-mode-inferred"', inferredPos + 1)).toBe(-1);
  });

  it("has data-testid for the extra-nodes accordion panel", () => {
    expect(graphSource).toContain('data-testid="extra-nodes-panel"');
  });

  it("has data-testid for the stage inspector", () => {
    expect(graphSource).toContain('data-testid="stage-inspector"');
  });

  it("has data-testid for node cards using the node id", () => {
    expect(graphSource).toContain('data-testid={`run-graph-node-${node.id}`}');
  });

  it("does not contain any hard-coded 'Promote' text", () => {
    expect(graphSource).not.toContain("Promote");
  });

  it("has a DAG canvas section with the graph-canvas testid", () => {
    expect(graphSource).toContain('data-testid="graph-canvas"');
  });

  it("renders skill count chips with readable 'Skills' label", () => {
    expect(graphSource).toContain("skillCount");
    expect(graphSource).toContain("Skills");
  });

  it("renders CLI count chips with readable 'CLI' label, not '$'", () => {
    expect(graphSource).toContain("cliCount");
    expect(graphSource).toContain("CLI");
    // The chip label must not use $ as the CLI indicator
    expect(graphSource).not.toContain("{node.cliCount}$");
  });

  it("attachment count pills use fully readable labels for all types", () => {
    expect(graphSource).toContain("Models");
    expect(graphSource).toContain("Tools");
    expect(graphSource).toContain("Evals");
    expect(graphSource).toContain("Skills");
    expect(graphSource).toContain("Artifact");
    expect(graphSource).toContain("Issues");
    expect(graphSource).toContain("CLI");
  });

  it("NodeCard does not render laneId as a visible chip or header", () => {
    const nodeCardStart = graphSource.indexOf("function NodeCard(");
    const nodeCardEnd = graphSource.indexOf("\nfunction ", nodeCardStart + 1);
    const nodeCardSource = graphSource.slice(nodeCardStart, nodeCardEnd);
    expect(nodeCardSource).not.toContain("laneId");
  });

  it("inspector shows Upstream and Downstream connection labels", () => {
    expect(graphSource).toContain("Upstream");
    expect(graphSource).toContain("Downstream");
  });

  it("AttachmentRow uses CLI label not $ for cli kind", () => {
    const rowStart = graphSource.indexOf("function AttachmentRow(");
    const rowEnd = graphSource.indexOf("\nfunction ", rowStart + 1);
    const rowSource = graphSource.slice(rowStart, rowEnd);
    expect(rowSource).toContain("CLI");
    expect(rowSource).not.toContain('"$"');
  });

  it("inspector shows Skills section", () => {
    expect(graphSource).toContain('"Skills"');
  });

  it("inspector shows CLI Commands section", () => {
    expect(graphSource).toContain('"CLI Commands"');
  });

  it("has a GraphLegend component", () => {
    expect(graphSource).toContain("GraphLegend");
  });

  it("has SVG edge layer with arrowhead marker", () => {
    expect(graphSource).toContain("bezierEdgePath");
    expect(graphSource).toContain("run-graph-arrow");
  });

  it("uses absolute positioning for node cards on the canvas", () => {
    expect(graphSource).toContain("absolute");
    expect(graphSource).toContain("pos.x");
    expect(graphSource).toContain("pos.y");
  });

  it("has expand/collapse for extra nodes", () => {
    expect(graphSource).toContain("extra-nodes-toggle");
    expect(graphSource).toContain("aria-expanded");
  });

  it("shows recovered badge for recovered issues", () => {
    expect(graphSource).toContain("recovered");
  });
});

// ── Workflow tab duration derivation ──────────────────────────────────────────

describe("Workflow tab duration — source code check", () => {
  const pageSource = readFileSync(
    path.join(root, "app/dashboard/runs/[runId]/page.tsx"),
    "utf8",
  );

  it("imports deriveRunDurationMs for consistent duration display", () => {
    expect(pageSource).toContain("deriveRunDurationMs");
  });

  it("uses deriveRunDurationMs in the Cost and Latency section", () => {
    // Should call deriveRunDurationMs(run) not just run.total_duration_ms
    expect(pageSource).toContain("deriveRunDurationMs(run)");
    // Raw total_duration_ms must not be the sole argument to formatDuration
    expect(pageSource).not.toContain("formatDuration(run.total_duration_ms)");
  });
});
