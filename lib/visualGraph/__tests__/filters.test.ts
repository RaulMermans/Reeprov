import { describe, expect, it } from "vitest";
import { DEFAULT_CANVAS_FILTERS, filterVisualGraph } from "@/lib/visualGraph/filters";
import type { VisualNode, VisualRunGraph } from "@/lib/visualGraph/types";

function node(id: string, type: VisualNode["type"], kind: VisualNode["kind"], parentId?: string): VisualNode {
  return {
    id,
    type,
    kind,
    label: id,
    status: type === "issue" ? "failed" : type === "recovery" ? "recovered" : "completed",
    order: 0,
    groupId: "workflow",
    parentId,
    identity: { title: id, typeLabel: type },
    metrics: {},
    rawEvents: [],
  };
}

function graph(): VisualRunGraph {
  const primary = node("stage-a", "stage", "primary");
  const evidenceTypes: VisualNode["type"][] = ["model", "tool", "skill", "cli", "eval", "artifact", "issue", "recovery", "agent"];
  const evidenceNodes = evidenceTypes.map((type) => node(`${type}-1`, type, "evidence", primary.id));
  return {
    workflowId: "wf",
    projectId: "proj",
    mode: "inferred",
    groups: [{ id: "workflow", label: "Workflow", order: 0, nodeIds: [primary.id] }],
    primaryNodes: [primary],
    internalNodes: [node("internal-a", "stage", "internal")],
    evidenceNodes,
    edges: [{ id: "workflow--stage-a--stage-b--0", from: "stage-a", to: "stage-b", type: "workflow" }],
    evidenceEdges: evidenceNodes.map((evidence) => ({
      id: `edge-${evidence.id}`,
      from: primary.id,
      to: evidence.id,
      type: evidence.type === "artifact" ? "produces" : evidence.type === "eval" ? "evaluates" : evidence.type === "agent" ? "contains" : "uses",
    })),
    summary: {
      totalStages: 1,
      completedStages: 1,
      failedStages: 0,
      warningStages: 0,
      notObservedStages: 0,
      totalModelCalls: 1,
      totalToolCalls: 1,
      totalEvals: 1,
      totalArtifacts: 1,
      totalIssues: 1,
    },
  };
}

describe("visual canvas filters", () => {
  it("toggles each evidence type without removing the primary workflow path", () => {
    const g = graph();
    const cases: Array<[keyof typeof DEFAULT_CANVAS_FILTERS, VisualNode["type"][]]> = [
      ["models", ["model"]],
      ["tools", ["tool"]],
      ["skills", ["skill"]],
      ["cli", ["cli"]],
      ["evals", ["eval"]],
      ["artifacts", ["artifact"]],
      ["issues", ["issue", "recovery"]],
      ["agents", ["agent"]],
    ];
    for (const [key, hiddenTypes] of cases) {
      const filtered = filterVisualGraph(g, { ...DEFAULT_CANVAS_FILTERS, [key]: false });
      expect(filtered.primaryNodes.map((n) => n.id)).toEqual(["stage-a"]);
      for (const type of hiddenTypes) {
        expect(filtered.evidenceNodes.some((node) => node.type === type)).toBe(false);
      }
    }
  });

  it("hides internal nodes independently", () => {
    expect(filterVisualGraph(graph(), { ...DEFAULT_CANVAS_FILTERS, internal: false }).internalNodes).toEqual([]);
  });

  it("can focus failed/recovered evidence without mutating source data", () => {
    const g = graph();
    const filtered = filterVisualGraph(g, { ...DEFAULT_CANVAS_FILTERS, failedOnly: true });
    expect(filtered.evidenceNodes.map((node) => node.type).sort()).toEqual(["issue", "recovery"]);
    expect(g.evidenceNodes).toHaveLength(9);
  });

  it("keeps selected node neighborhood visible when requested", () => {
    const filtered = filterVisualGraph(graph(), { ...DEFAULT_CANVAS_FILTERS, neighborhood: true }, "model-1");
    expect(filtered.evidenceNodes.map((node) => node.id)).toEqual(["model-1"]);
    expect(filtered.primaryNodes.map((node) => node.id)).toEqual(["stage-a"]);
  });
});
