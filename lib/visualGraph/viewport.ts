import type { VisualRunGraph } from "@/lib/visualGraph/types";

export const INITIAL_VIEWPORT_STAGE_COUNT = 3;
export const READABLE_CANVAS_ZOOM = 1;
export const MIN_READABLE_CANVAS_ZOOM = 0.82;
export const INITIAL_VIEWPORT_PADDING = 0.18;
export const ACTIVE_NODE_FOCUS_DURATION_MS = 250;

export interface InitialViewportPlan {
  mode: "readable_segment" | "fit_graph";
  nodeIds: string[];
  padding: number;
  minZoom?: number;
  maxZoom?: number;
  duration: number;
}

export function initialViewportPlan(graph: Pick<VisualRunGraph, "primaryNodes">): InitialViewportPlan {
  const nodeIds = graph.primaryNodes
    .slice()
    .sort((a, b) => a.order - b.order)
    .slice(0, INITIAL_VIEWPORT_STAGE_COUNT)
    .map((node) => node.id);

  if (nodeIds.length === 0) {
    return {
      mode: "fit_graph",
      nodeIds: [],
      padding: 0.15,
      maxZoom: READABLE_CANVAS_ZOOM,
      duration: 0,
    };
  }

  return {
    mode: "readable_segment",
    nodeIds,
    padding: INITIAL_VIEWPORT_PADDING,
    minZoom: MIN_READABLE_CANVAS_ZOOM,
    maxZoom: READABLE_CANVAS_ZOOM,
    duration: 0,
  };
}

export interface ActiveFocusParams {
  activeNodeId?: string | null;
  replayPlaying: boolean;
  liveRun: boolean;
  followEnabled: boolean;
}

export function shouldFocusActiveNode({
  activeNodeId,
  replayPlaying,
  liveRun,
  followEnabled,
}: ActiveFocusParams): boolean {
  if (!activeNodeId) return false;
  if (!followEnabled) return false;
  return replayPlaying || liveRun;
}
