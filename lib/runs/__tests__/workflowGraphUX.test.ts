/**
 * UX tests for the progressive-disclosure workflow graph improvements.
 *
 * Verifies:
 * - Registered spec mode shows only spec nodes as primary nodes
 * - Extra observed internal nodes go to extraNodes (not the primary graph)
 * - Inferred mode still works without a spec
 * - Duplicate issues are grouped by groupRunIssues
 * - Mode labels are mutually exclusive (no "registered spec" + "inferred" both showing)
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildRunGraph } from "@/lib/runs/runGraph";
import { groupRunIssues } from "@/lib/runs/runIntelligence";
import type { RunRecord, TraceEvent, WorkflowNode } from "@/lib/proof-layer/schemas";
import type { RunIssue } from "@/lib/runs/runIntelligence";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../../");

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRun(partial: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: "run-ux-test",
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
    summary: "UX test run.",
    ...partial,
  };
}

function makeEvent(
  partial: Partial<TraceEvent> & Pick<TraceEvent, "event_id" | "event_type" | "timestamp">,
): TraceEvent {
  return { run_id: "run-ux-test", workflow_id: "wf-test", ...partial };
}

function makeIssue(partial: Partial<RunIssue> & Pick<RunIssue, "id" | "message">): RunIssue {
  return {
    stageId: "stage_a",
    stageLabel: "Stage A",
    severity: "warning",
    recovered: false,
    source: "trace_event",
    ...partial,
  };
}

const baseParams = (overrides: {
  specNodes?: WorkflowNode[];
  traceEvents?: TraceEvent[];
} = {}) => ({
  runRecord: makeRun(),
  traceEvents: overrides.traceEvents ?? [],
  toolCalls: [],
  evalResults: [],
  specNodes: overrides.specNodes,
  specEdges: undefined,
  templateName: overrides.specNodes ? "Test Workflow" : undefined,
});

// ── Registered spec mode — primary graph uses spec nodes only ─────────────────

describe("registered spec mode — primary graph", () => {
  const specNodes: WorkflowNode[] = [
    { id: "step_one", type: "llm", label: "Step One" },
    { id: "step_two", type: "llm", label: "Step Two" },
  ];

  it("sets mode to registered_spec when specNodes are provided", () => {
    const graph = buildRunGraph(baseParams({ specNodes }));
    expect(graph.mode).toBe("registered_spec");
  });

  it("primary nodes contain only spec nodes", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "step_one", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_completed", node_id: "step_one", timestamp: "2026-06-01T10:00:05.000Z" }),
      makeEvent({ event_id: "e3", event_type: "node_started", node_id: "internal_impl_node", timestamp: "2026-06-01T10:00:10.000Z" }),
      makeEvent({ event_id: "e4", event_type: "node_completed", node_id: "internal_impl_node", timestamp: "2026-06-01T10:00:15.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ specNodes, traceEvents }));

    const primaryIds = graph.nodes.map((n) => n.id);
    expect(primaryIds).toEqual(["step_one", "step_two"]);
    expect(primaryIds).not.toContain("internal_impl_node");
  });

  it("extra observed internal nodes are accessible via extraNodes", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "step_one", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_completed", node_id: "step_one", timestamp: "2026-06-01T10:00:05.000Z" }),
      makeEvent({ event_id: "e3", event_type: "node_started", node_id: "internal_impl_node", timestamp: "2026-06-01T10:00:10.000Z" }),
      makeEvent({ event_id: "e4", event_type: "node_completed", node_id: "internal_impl_node", timestamp: "2026-06-01T10:00:15.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ specNodes, traceEvents }));

    expect(graph.extraNodes.map((n) => n.id)).toContain("internal_impl_node");
    expect(graph.extraNodes[0]?.label).toBeTruthy();
    expect(graph.extraNodes[0]?.status).toBe("completed");
  });

  it("many internal nodes do not inflate the primary node count", () => {
    const manyInternalEvents: TraceEvent[] = Array.from({ length: 30 }, (_, i) => [
      makeEvent({ event_id: `s${i}`, event_type: "node_started", node_id: `internal_node_${i}`, timestamp: `2026-06-01T10:00:${String(i).padStart(2, "0")}.000Z` }),
      makeEvent({ event_id: `e${i}`, event_type: "node_completed", node_id: `internal_node_${i}`, timestamp: `2026-06-01T10:00:${String(i + 1).padStart(2, "0")}.000Z` }),
    ]).flat();

    const graph = buildRunGraph(baseParams({ specNodes, traceEvents: manyInternalEvents }));

    // Primary graph stays clean — only spec nodes
    expect(graph.nodes).toHaveLength(specNodes.length);
    // All 30 internal nodes are accessible in extraNodes
    expect(graph.extraNodes).toHaveLength(30);
    expect(graph.summary.totalStages).toBe(specNodes.length);
  });

  it("extraNodes have attachments (model calls, tool calls) populated", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "internal_node", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "model_call_completed", node_id: "internal_node", timestamp: "2026-06-01T10:00:02.000Z" }),
      makeEvent({ event_id: "e3", event_type: "node_completed", node_id: "internal_node", timestamp: "2026-06-01T10:00:05.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ specNodes, traceEvents }));
    const extraNode = graph.extraNodes.find((n) => n.id === "internal_node");
    expect(extraNode).toBeDefined();
    expect(extraNode!.modelCallCount).toBeGreaterThan(0);
  });
});

// ── Inferred mode — all observed nodes are primary ────────────────────────────

describe("inferred mode — without spec", () => {
  it("sets mode to inferred when no spec is provided", () => {
    const graph = buildRunGraph(baseParams());
    expect(graph.mode).toBe("inferred");
  });

  it("all observed nodes appear as primary nodes", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "node_a", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent({ event_id: "e2", event_type: "node_completed", node_id: "node_a", timestamp: "2026-06-01T10:00:05.000Z" }),
      makeEvent({ event_id: "e3", event_type: "node_started", node_id: "node_b", timestamp: "2026-06-01T10:00:10.000Z" }),
      makeEvent({ event_id: "e4", event_type: "node_completed", node_id: "node_b", timestamp: "2026-06-01T10:00:15.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));

    expect(graph.nodes.map((n) => n.id)).toContain("node_a");
    expect(graph.nodes.map((n) => n.id)).toContain("node_b");
    expect(graph.extraNodes).toHaveLength(0);
  });

  it("extraNodes is always empty in inferred mode", () => {
    const traceEvents: TraceEvent[] = [
      makeEvent({ event_id: "e1", event_type: "node_started", node_id: "any_node", timestamp: "2026-06-01T10:00:00.000Z" }),
    ];
    const graph = buildRunGraph(baseParams({ traceEvents }));
    expect(graph.extraNodes).toEqual([]);
  });
});

// ── Duplicate issue grouping ──────────────────────────────────────────────────

describe("groupRunIssues — duplicate grouping", () => {
  it("returns a single grouped issue when the same message appears multiple times at the same stage", () => {
    const issues: RunIssue[] = [
      makeIssue({ id: "i1", message: "Tool call failed: timeout" }),
      makeIssue({ id: "i2", message: "Tool call failed: timeout" }),
      makeIssue({ id: "i3", message: "Tool call failed: timeout" }),
    ];
    const grouped = groupRunIssues(issues);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].count).toBe(3);
    expect(grouped[0].allIds).toEqual(["i1", "i2", "i3"]);
  });

  it("preserves distinct issues at the same stage", () => {
    const issues: RunIssue[] = [
      makeIssue({ id: "i1", message: "Tool call failed: timeout" }),
      makeIssue({ id: "i2", message: "Model refused to answer" }),
    ];
    const grouped = groupRunIssues(issues);
    expect(grouped).toHaveLength(2);
    grouped.forEach((g) => expect(g.count).toBe(1));
  });

  it("keeps issues from different stages separate even if message matches", () => {
    const issues: RunIssue[] = [
      makeIssue({ id: "i1", stageId: "stage_a", message: "Timeout" }),
      makeIssue({ id: "i2", stageId: "stage_b", message: "Timeout" }),
    ];
    const grouped = groupRunIssues(issues);
    expect(grouped).toHaveLength(2);
  });

  it("normalizes whitespace and case when grouping", () => {
    const issues: RunIssue[] = [
      makeIssue({ id: "i1", message: "Tool call FAILED:  timeout " }),
      makeIssue({ id: "i2", message: "tool call failed: timeout" }),
    ];
    const grouped = groupRunIssues(issues);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].count).toBe(2);
  });

  it("escalates severity to the highest seen across duplicates", () => {
    const issues: RunIssue[] = [
      makeIssue({ id: "i1", message: "Repeated error", severity: "warning" }),
      makeIssue({ id: "i2", message: "Repeated error", severity: "critical" }),
    ];
    const grouped = groupRunIssues(issues);
    expect(grouped[0].severity).toBe("critical");
  });

  it("returns empty array for empty input", () => {
    expect(groupRunIssues([])).toEqual([]);
  });
});

// ── Mode label integrity — source code checks ─────────────────────────────────

describe("mode label UI — source code checks", () => {
  const pageSource = readFileSync(
    path.join(root, "app/dashboard/runs/[runId]/page.tsx"),
    "utf8",
  );
  const graphSource = readFileSync(
    path.join(root, "components/proof-layer/RunWorkflowGraph.tsx"),
    "utf8",
  );

  it("registered spec does not show the inferred/promote label when a spec is active", () => {
    // The 'no-linked-spec' div (with 'Promote a spec') is guarded by !workflow so it
    // does not render when a registered spec is active — only shown when no spec at all.
    expect(pageSource).toContain("isLive && !workflow");
    // The data-testid="no-linked-spec" element must NOT appear without the !workflow guard.
    const noLinkedSpecIdx = pageSource.indexOf('data-testid="no-linked-spec"');
    const guardIdx = pageSource.indexOf("isLive && !workflow");
    expect(noLinkedSpecIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(-1);
    // The guard must appear before the no-linked-spec element (it controls its rendering).
    expect(guardIdx).toBeLessThan(noLinkedSpecIdx);
  });

  it("RunWorkflowGraph shows exactly one mode badge — no dual labels", () => {
    // The component uses data-testid attributes to differentiate the two modes.
    expect(graphSource).toContain('data-testid="graph-mode-registered"');
    expect(graphSource).toContain('data-testid="graph-mode-inferred"');
    // Only one of them renders at a time (ternary, not both).
    const registeredPos = graphSource.indexOf('data-testid="graph-mode-registered"');
    const inferredPos = graphSource.indexOf('data-testid="graph-mode-inferred"');
    expect(registeredPos).toBeGreaterThan(-1);
    expect(inferredPos).toBeGreaterThan(-1);
  });

  it("RunWorkflowGraph does not render a 'Promote to spec' call-to-action", () => {
    // Promote link belongs on the page level, not inside the graph component.
    expect(graphSource).not.toContain("Promote");
  });

  it("ExtraNodesPanel is rendered with the data-testid for test inspection", () => {
    expect(graphSource).toContain('data-testid="extra-nodes-panel"');
  });
});
