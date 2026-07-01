import { describe, expect, it } from "vitest";
import type { TraceEvent } from "@/lib/proof-layer/schemas";
import { buildReplayFrame, deriveVisualReplayEvents } from "@/lib/visualGraph/replay";
import type { VisualNode, VisualRunGraph } from "@/lib/visualGraph/types";

function event(partial: Partial<TraceEvent> & Pick<TraceEvent, "event_id" | "event_type" | "timestamp">): TraceEvent {
  return { run_id: "run", workflow_id: "wf", node_id: "stage-a", ...partial };
}

function node(partial: Partial<VisualNode> & Pick<VisualNode, "id" | "type" | "kind" | "label">): VisualNode {
  return {
    status: "completed",
    order: 0,
    groupId: "workflow",
    identity: { title: partial.label, typeLabel: partial.type === "model" ? "Model" : "Stage" },
    metrics: {},
    rawEvents: [],
    ...partial,
  };
}

function graph(overrides: Partial<VisualRunGraph> = {}): VisualRunGraph {
  const primary = node({
    id: "stage-a",
    type: "stage",
    kind: "primary",
    label: "Stage A",
    rawEvents: [
      event({ event_id: "stage-start", event_type: "node_started", timestamp: "2026-06-01T10:00:00.000Z" }),
      event({ event_id: "stage-end", event_type: "node_completed", timestamp: "2026-06-01T10:00:05.000Z" }),
    ],
  });
  const model = node({
    id: "stage-a::model_call::m1",
    type: "model",
    kind: "evidence",
    label: "gpt",
    parentId: "stage-a",
    identity: { title: "gpt", typeLabel: "Model", provider: "openai", providerLabel: "OpenAI", modelName: "gpt" },
    rawEvents: [
      event({ event_id: "model-start", event_type: "model_call_started", timestamp: "2026-06-01T10:00:01.000Z" }),
      event({ event_id: "model-end", event_type: "model_call_completed", timestamp: "2026-06-01T10:00:03.000Z" }),
    ],
  });
  const recovery = node({
    id: "stage-a::issue::err1",
    type: "recovery",
    kind: "evidence",
    label: "Recovered timeout",
    parentId: "stage-a",
    status: "recovered",
    identity: { title: "Recovered timeout", typeLabel: "Recovery", badge: "recovered" },
    rawEvents: [
      event({ event_id: "err1", event_type: "tool_call_failed", timestamp: "2026-06-01T10:00:02.000Z" }),
      event({ event_id: "tool-ok", event_type: "tool_call_completed", timestamp: "2026-06-01T10:00:04.000Z" }),
    ],
  });
  return {
    workflowId: "wf",
    projectId: "proj",
    mode: "inferred",
    groups: [{ id: "workflow", label: "Workflow", order: 0, nodeIds: ["stage-a"] }],
    primaryNodes: [primary],
    internalNodes: [],
    evidenceNodes: [model, recovery],
    edges: [],
    evidenceEdges: [
      { id: "stage-a--uses--stage-a::model_call::m1", from: "stage-a", to: model.id, type: "uses" },
      { id: "stage-a--recovers--stage-a::issue::err1", from: "stage-a", to: recovery.id, type: "recovers" },
    ],
    summary: {
      totalStages: 1,
      completedStages: 1,
      failedStages: 0,
      warningStages: 0,
      notObservedStages: 0,
      totalModelCalls: 1,
      totalToolCalls: 0,
      totalEvals: 0,
      totalArtifacts: 0,
      totalIssues: 1,
    },
    ...overrides,
  };
}

describe("visual replay foundation", () => {
  it("derives deterministic stable timeline ordering", () => {
    const eventsA = deriveVisualReplayEvents(graph());
    const eventsB = deriveVisualReplayEvents(graph());
    expect(eventsA.map((event) => event.id)).toEqual(eventsB.map((event) => event.id));
    expect(eventsA.map((event) => event.order)).toEqual(eventsA.map((_, index) => index));
  });

  it("reveals model/tool/artifact-like evidence according to trace timing", () => {
    const events = deriveVisualReplayEvents(graph());
    const reveal = events.find((event) => event.kind === "node_reveal" && event.nodeId === "stage-a::model_call::m1");
    expect(reveal?.label).toContain("Model started");
    const frame = buildReplayFrame(graph(), events, events.findIndex((event) => event.id === reveal?.id));
    expect(frame.visibleNodeIds.has("stage-a::model_call::m1")).toBe(true);
    expect(frame.nodeStatuses.get("stage-a::model_call::m1")).toBe("running");
  });

  it("applies status transitions including failed to recovered", () => {
    const g = graph();
    const events = deriveVisualReplayEvents(g);
    const failedIndex = events.findIndex((event) => event.sourceEventId === "err1" && event.kind === "node_status");
    const recoveredIndex = events.findIndex((event) => event.sourceEventId === "tool-ok" && event.kind === "node_status");
    expect(buildReplayFrame(g, events, failedIndex).nodeStatuses.get("stage-a::issue::err1")).toBe("recovered");
    expect(buildReplayFrame(g, events, recoveredIndex).nodeStatuses.get("stage-a::issue::err1")).toBe("recovered");
  });

  it("reset and final frames expose expected graph states", () => {
    const g = graph();
    const events = deriveVisualReplayEvents(g);
    const reset = buildReplayFrame(g, events, -1);
    expect(reset.visibleNodeIds.has("stage-a")).toBe(true);
    expect(reset.visibleNodeIds.has("stage-a::model_call::m1")).toBe(false);
    const final = buildReplayFrame(g, events, events.length - 1);
    expect(final.visibleNodeIds.has("stage-a::model_call::m1")).toBe(true);
    expect(final.nodeStatuses.get("stage-a")).toBe("completed");
  });
});
