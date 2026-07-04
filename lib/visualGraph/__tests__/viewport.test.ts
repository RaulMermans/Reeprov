import { describe, expect, it } from "vitest";
import {
  INITIAL_VIEWPORT_STAGE_COUNT,
  MIN_READABLE_CANVAS_ZOOM,
  READABLE_CANVAS_ZOOM,
  initialViewportPlan,
  shouldFocusActiveNode,
} from "@/lib/visualGraph/viewport";
import type { VisualNode } from "@/lib/visualGraph/types";

function primaryNode(id: string, order: number): VisualNode {
  return {
    id,
    type: "stage",
    kind: "primary",
    label: id,
    status: "completed",
    order,
    groupId: "workflow",
    identity: { title: id, typeLabel: "Stage" },
    metrics: {},
    rawEvents: [],
  };
}

describe("visual graph viewport policy", () => {
  it("focuses the first readable workflow segment instead of fitting every stage", () => {
    const plan = initialViewportPlan({
      primaryNodes: [
        primaryNode("stage-4", 4),
        primaryNode("stage-1", 1),
        primaryNode("stage-2", 2),
        primaryNode("stage-3", 3),
        primaryNode("stage-5", 5),
      ],
    });

    expect(plan.mode).toBe("readable_segment");
    expect(plan.nodeIds).toEqual(["stage-1", "stage-2", "stage-3"]);
    expect(plan.nodeIds).toHaveLength(INITIAL_VIEWPORT_STAGE_COUNT);
    expect(plan.minZoom).toBe(MIN_READABLE_CANVAS_ZOOM);
    expect(plan.maxZoom).toBe(READABLE_CANVAS_ZOOM);
  });

  it("falls back to fit-graph when no primary nodes exist", () => {
    const plan = initialViewportPlan({ primaryNodes: [] });
    expect(plan.mode).toBe("fit_graph");
    expect(plan.nodeIds).toEqual([]);
    expect(plan.maxZoom).toBe(READABLE_CANVAS_ZOOM);
  });

  it("focuses active nodes only for replay/live follow states", () => {
    expect(shouldFocusActiveNode({
      activeNodeId: "stage-1",
      replayPlaying: true,
      liveRun: false,
      followEnabled: true,
    })).toBe(true);

    expect(shouldFocusActiveNode({
      activeNodeId: "stage-1",
      replayPlaying: false,
      liveRun: true,
      followEnabled: true,
    })).toBe(true);

    expect(shouldFocusActiveNode({
      activeNodeId: "stage-1",
      replayPlaying: true,
      liveRun: false,
      followEnabled: false,
    })).toBe(false);

    expect(shouldFocusActiveNode({
      activeNodeId: "stage-1",
      replayPlaying: false,
      liveRun: false,
      followEnabled: true,
    })).toBe(false);
  });
});
