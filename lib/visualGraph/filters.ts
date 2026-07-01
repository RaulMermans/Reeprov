import type { VisualNode, VisualRunGraph } from "@/lib/visualGraph/types";

export interface CanvasFilterState {
  models: boolean;
  tools: boolean;
  skills: boolean;
  cli: boolean;
  evals: boolean;
  artifacts: boolean;
  issues: boolean;
  internal: boolean;
  failedOnly: boolean;
  neighborhood: boolean;
}

export const DEFAULT_CANVAS_FILTERS: CanvasFilterState = {
  models: true,
  tools: true,
  skills: true,
  cli: true,
  evals: true,
  artifacts: true,
  issues: true,
  internal: true,
  failedOnly: false,
  neighborhood: false,
};

function evidenceTypeVisible(node: VisualNode, filters: CanvasFilterState): boolean {
  if (node.type === "model") return filters.models;
  if (node.type === "tool") return filters.tools;
  if (node.type === "skill") return filters.skills;
  if (node.type === "cli") return filters.cli;
  if (node.type === "eval") return filters.evals;
  if (node.type === "artifact") return filters.artifacts;
  if (node.type === "issue" || node.type === "recovery") return filters.issues;
  return true;
}

function isFailedOrRecovered(node: VisualNode): boolean {
  return node.status === "failed" || node.status === "warning" || node.status === "recovered";
}

function neighborhoodIds(graph: VisualRunGraph, selectedId: string | null): Set<string> | undefined {
  if (!selectedId) return undefined;
  const ids = new Set<string>([selectedId]);
  for (const edge of [...graph.edges, ...graph.evidenceEdges]) {
    if (edge.from === selectedId) ids.add(edge.to);
    if (edge.to === selectedId) ids.add(edge.from);
  }
  const selectedEvidence = graph.evidenceNodes.find((node) => node.id === selectedId);
  if (selectedEvidence?.parentId) ids.add(selectedEvidence.parentId);
  return ids;
}

export function filterVisualGraph(
  graph: VisualRunGraph,
  filters: CanvasFilterState,
  selectedId: string | null = null,
): VisualRunGraph {
  const neighborhood = filters.neighborhood ? neighborhoodIds(graph, selectedId) : undefined;
  const visibleEvidence = graph.evidenceNodes.filter((node) => {
    if (!evidenceTypeVisible(node, filters)) return false;
    if (filters.failedOnly && !isFailedOrRecovered(node)) return false;
    if (neighborhood) {
      const selectedPrimary = selectedId ? graph.primaryNodes.some((primary) => primary.id === selectedId) : false;
      const attachedToSelectedPrimary = selectedPrimary && node.parentId === selectedId;
      if (!neighborhood.has(node.id) && !attachedToSelectedPrimary) return false;
    }
    return true;
  });
  const visibleEvidenceIds = new Set(visibleEvidence.map((node) => node.id));

  return {
    ...graph,
    primaryNodes: graph.primaryNodes,
    internalNodes: filters.internal ? graph.internalNodes : [],
    evidenceNodes: visibleEvidence,
    evidenceEdges: graph.evidenceEdges.filter((edge) => visibleEvidenceIds.has(edge.to)),
    edges: graph.edges,
  };
}
