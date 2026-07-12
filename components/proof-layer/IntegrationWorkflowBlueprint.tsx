"use client";

/**
 * Integration Workflow Blueprint — aggregate, read-only map of what a
 * connected project's workflow generally looks like across its recent runs.
 *
 * This is deliberately NOT the Visual Execution Canvas: no replay, no
 * scrubber, no per-event timeline, and no @xyflow/react graph. It renders a
 * condensed stage map (one chip per stable stage) with aggregate evidence
 * counts, and expands into per-node detail only on click — the run canvas
 * already covers the single-run, every-event view.
 */

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { visualNodeStatusDefinition, visualNodeTypeDefinition } from "@/lib/visualGraph/nodeRegistry";
import type { VisualNodeStatus } from "@/lib/visualGraph/types";
import { IntegrationBlueprintInspector } from "@/components/proof-layer/IntegrationBlueprintInspector";
import type {
  IntegrationBlueprintMode,
  IntegrationBlueprintNode,
  IntegrationWorkflowBlueprint as IntegrationWorkflowBlueprintData,
} from "@/lib/integrations/integrationBlueprintTypes";

// ── Mode badge ────────────────────────────────────────────────────────────────

function modeBadge(mode: IntegrationBlueprintMode): { label: string; tone: "success" | "info" | "neutral" } {
  switch (mode) {
    case "registered_spec":
      return { label: "WorkflowSpec-backed", tone: "success" };
    case "inferred_from_runs":
      return { label: "Inferred from recent runs", tone: "info" };
    case "insufficient_data":
      return { label: "Waiting for runs", tone: "neutral" };
  }
}

// ── Dominant status derivation (aggregate counts → single display status) ────

function dominantStatus(node: IntegrationBlueprintNode): VisualNodeStatus {
  const { observedRuns, completedRuns, warningRuns, failedRuns, recoveredRuns } = node.statusSummary;
  if (observedRuns === 0) return "not_observed";
  if (node.type === "recovery") return "recovered";
  if (failedRuns > 0 && failedRuns >= completedRuns) return "failed";
  if (failedRuns > 0 || warningRuns > 0) return "warning";
  if (recoveredRuns > 0 && completedRuns === 0) return "recovered";
  if (completedRuns > 0) return "completed";
  return "not_observed";
}

// ── Node chip ─────────────────────────────────────────────────────────────────

function NodeChip({
  node,
  evidenceCounts,
  selected,
  onSelect,
}: {
  node: IntegrationBlueprintNode;
  evidenceCounts?: Array<{ type: string; label: string; count: number }>;
  selected: boolean;
  onSelect: () => void;
}) {
  const typeDef = visualNodeTypeDefinition(node.type);
  const statusDef = visualNodeStatusDefinition(dominantStatus(node));
  const Icon = typeDef.icon;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex min-w-[180px] flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left transition ${
        selected ? "border-teal-400 ring-1 ring-teal-300" : `${typeDef.borderClass} hover:border-teal-300`
      } ${typeDef.bgClass}`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusDef.dotClass}`} title={statusDef.label} />
        <Icon className={`h-3.5 w-3.5 shrink-0 ${typeDef.accentClass}`} aria-hidden="true" />
        <span className="truncate text-xs font-semibold text-slate-800">{node.label}</span>
      </div>
      <p className="text-[11px] text-slate-500">
        Observed {node.statusSummary.observedRuns}× in window
        {node.statusSummary.recoveredRuns > 0 && ` · ${node.statusSummary.recoveredRuns} recovered`}
      </p>
      {evidenceCounts && evidenceCounts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {evidenceCounts.map((ec) => (
            <span key={ec.type} className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              {ec.label} {ec.count}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

// ── Evidence summary list ────────────────────────────────────────────────────

function EvidenceCountList({ title, items }: { title: string; items: Array<{ label: string; count: number }> }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold text-slate-600">{title}</h3>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge key={item.label} tone="neutral">
            {item.label} <span className="ml-1 text-slate-400">×{item.count}</span>
          </Badge>
        ))}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export interface IntegrationWorkflowBlueprintProps {
  blueprint: IntegrationWorkflowBlueprintData;
}

export function IntegrationWorkflowBlueprint({ blueprint }: IntegrationWorkflowBlueprintProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showDetailedEvidence, setShowDetailedEvidence] = useState(false);

  const primaryNodes = useMemo(
    () => blueprint.nodes.filter((n) => n.role === "primary").sort((a, b) => a.order - b.order),
    [blueprint.nodes],
  );
  const evidenceNodes = useMemo(
    () => blueprint.nodes.filter((n) => n.role === "evidence").sort((a, b) => b.frequency - a.frequency),
    [blueprint.nodes],
  );
  const nodesById = useMemo(() => new Map(blueprint.nodes.map((n) => [n.id, n])), [blueprint.nodes]);

  const evidenceCountsByStage = useMemo(() => {
    const map = new Map<string, Map<string, { type: string; label: string; count: number }>>();
    for (const edge of blueprint.edges) {
      if (edge.type === "workflow") continue;
      const target = nodesById.get(edge.target);
      if (!target) continue;
      const typeDef = visualNodeTypeDefinition(target.type);
      const bucket = map.get(edge.source) ?? new Map();
      const existing = bucket.get(target.type);
      bucket.set(target.type, { type: target.type, label: typeDef.pluralLabel, count: (existing?.count ?? 0) + edge.frequency });
      map.set(edge.source, bucket);
    }
    return map;
  }, [blueprint.edges, nodesById]);

  const badge = modeBadge(blueprint.mode);
  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null;

  const runWindowText = blueprint.runWindow.count > 0
    ? `Built from latest ${blueprint.runWindow.count} run${blueprint.runWindow.count === 1 ? "" : "s"}`
    : "No runs sampled yet";

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Workflow Blueprint</h2>
          <p className="text-xs text-slate-500">{runWindowText}</p>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>

      {blueprint.mode === "insufficient_data" ? (
        <div className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          Run this integration once to infer a workflow blueprint.
        </div>
      ) : (
        <>
          {primaryNodes.length === 0 ? (
            <p className="text-sm text-slate-500">No stages observed in the sampled run window yet.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {primaryNodes.map((node, index) => (
                <div key={node.id} className="flex items-center gap-2">
                  <NodeChip
                    node={node}
                    evidenceCounts={[...(evidenceCountsByStage.get(node.id)?.values() ?? [])]}
                    selected={selectedNodeId === node.id}
                    onSelect={() => setSelectedNodeId(selectedNodeId === node.id ? null : node.id)}
                  />
                  {index < primaryNodes.length - 1 && <span className="shrink-0 text-slate-300">→</span>}
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-3">
            <EvidenceCountList title="Top models" items={blueprint.evidenceSummary.topModels} />
            <EvidenceCountList title="Top tools" items={blueprint.evidenceSummary.topTools} />
            <EvidenceCountList title="Top evals" items={blueprint.evidenceSummary.topEvals} />
            <EvidenceCountList title="Artifacts produced" items={blueprint.evidenceSummary.topArtifacts} />
            <EvidenceCountList title="Common issues" items={blueprint.evidenceSummary.topIssues} />
          </div>

          {evidenceNodes.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setShowDetailedEvidence((v) => !v)}
                className="text-xs font-medium text-teal-700 hover:underline"
              >
                {showDetailedEvidence ? "Hide detailed evidence" : `Show detailed evidence (${evidenceNodes.length})`}
              </button>
              {showDetailedEvidence && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {evidenceNodes.map((node) => {
                    const typeDef = visualNodeTypeDefinition(node.type);
                    const Icon = typeDef.icon;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => setSelectedNodeId(selectedNodeId === node.id ? null : node.id)}
                        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition ${
                          selectedNodeId === node.id ? "border-teal-400 ring-1 ring-teal-300" : typeDef.borderClass
                        } ${typeDef.bgClass}`}
                      >
                        <Icon className={`h-3.5 w-3.5 ${typeDef.accentClass}`} aria-hidden="true" />
                        <span className="truncate text-slate-700">{node.label}</span>
                        <span className="text-slate-400">×{node.frequency}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {selectedNode && (
            <div className="mt-4">
              <IntegrationBlueprintInspector
                node={selectedNode}
                labelForNodeId={(id) => nodesById.get(id)?.label}
                onClose={() => setSelectedNodeId(null)}
              />
            </div>
          )}
        </>
      )}
    </Card>
  );
}
