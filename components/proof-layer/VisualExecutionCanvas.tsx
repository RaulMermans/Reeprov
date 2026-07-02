"use client";

/**
 * Visual Execution Canvas — read-only, n8n-style node canvas for a run's
 * workflow execution. Renders the primary workflow path (stages/agents) as
 * large nodes with real pan/zoom/fit-view (via @xyflow/react), and attaches
 * observed evidence (models/tools/skills/CLI/evals/artifacts/issues/
 * recoveries) as connected child nodes.
 *
 * This is a proof/debugging layer, not a workflow builder: nodes are not
 * draggable or connectable, and there is no execute/run/edit action anywhere
 * in this file.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { CanvasFilters } from "@/components/proof-layer/CanvasFilters";
import { ReplayControls } from "@/components/proof-layer/ReplayControls";
import { formatDuration, formatCurrency, formatDateTime, formatPercent } from "@/components/proof-layer/format";
import type { RunGraph } from "@/lib/runs/runGraph";
import type { RunRecord, TraceEvent } from "@/lib/proof-layer/schemas";
import type { AgentNote } from "@/lib/runs/agentNotes";
import type { AgentNoteType } from "@/lib/proof-layer/schemas";
import { buildVisualRunGraph } from "@/lib/visualGraph/buildVisualRunGraph";
import type { VisualEdgeType, VisualNode, VisualNodeType, VisualRunGraph } from "@/lib/visualGraph/types";
import { DEFAULT_CANVAS_FILTERS, filterVisualGraph } from "@/lib/visualGraph/filters";
import { buildReplayFrame, deriveVisualReplayEvents, type VisualReplayFrame } from "@/lib/visualGraph/replay";
import { visualNodeIcon } from "@/lib/visualGraph/iconResolvers";
import {
  evidenceCountLabel,
  VISUAL_NODE_REGISTRY,
  visualNodeStatusDefinition,
  visualNodeTypeDefinition,
} from "@/lib/visualGraph/nodeRegistry";

// ── Layout constants ──────────────────────────────────────────────────────────

const STAGE_W = 252;
const STAGE_H = 124;
const EVIDENCE_W = 214;
const EVIDENCE_H = 78;
const EVIDENCE_COLS = 2;
const EVIDENCE_GAP = 8;
const H_GAP = 90;
const ROW_GAP = 40;
const CANVAS_PAD = 40;

const EVIDENCE_EDGE_COLOR: Record<VisualEdgeType, string> = {
  workflow: "#64748b",
  uses: "#a5b4fc",
  produces: "#fbbf24",
  evaluates: "#5eead4",
  fails: "#fca5a5",
  recovers: "#6ee7b7",
  contains: "#cbd5e1",
};

// ── DAG layout (primary nodes only — internal nodes stay off-canvas) ──────────

function computePrimaryColumns(nodes: VisualNode[], edges: VisualRunGraph["edges"]): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const parents = new Map<string, Set<string>>();
  for (const n of nodes) parents.set(n.id, new Set());
  for (const e of edges) {
    if (ids.has(e.from) && ids.has(e.to)) parents.get(e.to)?.add(e.from);
  }
  const col = new Map<string, number>();
  const visiting = new Set<string>();
  function resolve(id: string): number {
    if (col.has(id)) return col.get(id)!;
    if (visiting.has(id)) {
      col.set(id, 0);
      return 0;
    }
    visiting.add(id);
    const parentIds = [...(parents.get(id) ?? [])];
    const value = parentIds.length > 0 ? Math.max(...parentIds.map(resolve)) + 1 : 0;
    col.set(id, value);
    visiting.delete(id);
    return value;
  }
  for (const n of nodes) resolve(n.id);
  return col;
}

interface CanvasLayout {
  primaryPositions: Map<string, { x: number; y: number }>;
  evidencePositions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

function layoutVisualGraph(graph: VisualRunGraph): CanvasLayout {
  const nodes = graph.primaryNodes;
  const evidenceByParent = new Map<string, VisualNode[]>();
  for (const e of graph.evidenceNodes) {
    if (!e.parentId) continue;
    const list = evidenceByParent.get(e.parentId);
    if (list) list.push(e);
    else evidenceByParent.set(e.parentId, [e]);
  }

  if (nodes.length === 0) {
    return { primaryPositions: new Map(), evidencePositions: new Map(), width: CANVAS_PAD * 2, height: CANVAS_PAD * 2 };
  }

  const colMap = computePrimaryColumns(nodes, graph.edges);
  const colGroups = new Map<number, VisualNode[]>();
  for (const n of nodes) {
    const c = colMap.get(n.id) ?? 0;
    const list = colGroups.get(c);
    if (list) list.push(n);
    else colGroups.set(c, [n]);
  }
  const rowMap = new Map<string, number>();
  for (const group of colGroups.values()) {
    group.sort((a, b) => a.order - b.order);
    group.forEach((n, i) => rowMap.set(n.id, i));
  }

  let maxBlockHeight = STAGE_H;
  const evidenceColWidth = EVIDENCE_COLS * EVIDENCE_W + (EVIDENCE_COLS - 1) * EVIDENCE_GAP;
  for (const n of nodes) {
    const count = evidenceByParent.get(n.id)?.length ?? 0;
    const rows = count > 0 ? Math.ceil(count / EVIDENCE_COLS) : 0;
    const h = STAGE_H + (rows > 0 ? EVIDENCE_GAP + rows * (EVIDENCE_H + EVIDENCE_GAP) : 0);
    if (h > maxBlockHeight) maxBlockHeight = h;
  }
  const vStep = maxBlockHeight + ROW_GAP;
  const hStep = Math.max(STAGE_W, evidenceColWidth) + H_GAP;

  const primaryPositions = new Map<string, { x: number; y: number }>();
  const evidencePositions = new Map<string, { x: number; y: number }>();
  let maxCol = 0;
  let maxRow = 0;

  for (const n of nodes) {
    const c = colMap.get(n.id) ?? 0;
    const r = rowMap.get(n.id) ?? 0;
    maxCol = Math.max(maxCol, c);
    maxRow = Math.max(maxRow, r);
    const x = CANVAS_PAD + c * hStep;
    const y = CANVAS_PAD + r * vStep;
    primaryPositions.set(n.id, { x, y });

    const evidence = evidenceByParent.get(n.id) ?? [];
    evidence.forEach((ev, i) => {
      const evCol = i % EVIDENCE_COLS;
      const evRow = Math.floor(i / EVIDENCE_COLS);
      evidencePositions.set(ev.id, {
        x: x + evCol * (EVIDENCE_W + EVIDENCE_GAP),
        y: y + STAGE_H + EVIDENCE_GAP + evRow * (EVIDENCE_H + EVIDENCE_GAP),
      });
    });
  }

  return {
    primaryPositions,
    evidencePositions,
    width: CANVAS_PAD * 2 + (maxCol + 1) * hStep,
    height: CANVAS_PAD * 2 + (maxRow + 1) * vStep,
  };
}

// ── React Flow node data ───────────────────────────────────────────────────────

type CanvasNodeData = { visualNode: VisualNode; replayStatus?: VisualNode["status"]; active?: boolean };
type PrimaryFlowNode = RFNode<CanvasNodeData, "primary">;
type EvidenceFlowNode = RFNode<CanvasNodeData, "evidence">;

function formatTokens(value?: number): string | undefined {
  if (typeof value !== "number") return undefined;
  return `${value.toLocaleString()} tok`;
}

function metricChips(node: VisualNode): string[] {
  const chips: string[] = [];
  if (typeof node.metrics.inputTokens === "number") chips.push(`in ${formatTokens(node.metrics.inputTokens)}`);
  if (typeof node.metrics.outputTokens === "number") chips.push(`out ${formatTokens(node.metrics.outputTokens)}`);
  if (typeof node.metrics.totalTokens === "number") chips.push(formatTokens(node.metrics.totalTokens)!);
  if (typeof node.metrics.costUsd === "number") chips.push(formatCurrency(node.metrics.costUsd));
  if (typeof node.metrics.latencyMs === "number") chips.push(formatDuration(node.metrics.latencyMs));
  if (typeof node.metrics.retryCount === "number" && node.metrics.retryCount > 0) chips.push(`${node.metrics.retryCount} retries`);
  if (typeof node.metrics.errorCount === "number" && node.metrics.errorCount > 0) chips.push(`${node.metrics.errorCount} errors`);
  if (typeof node.metrics.score === "number") chips.push(`score ${formatPercent(node.metrics.score)}`);
  if (typeof node.metrics.passed === "boolean") chips.push(node.metrics.passed ? "pass" : "fail");
  if (typeof node.metrics.threshold === "number") chips.push(`threshold ${formatPercent(node.metrics.threshold)}`);
  if (typeof node.metrics.sizeBytes === "number") chips.push(`${node.metrics.sizeBytes.toLocaleString()} bytes`);
  if (node.metrics.contentStatus) chips.push(node.metrics.contentStatus);
  return chips;
}

function visualNodeWithReplayStatus(node: VisualNode, replayFrame: VisualReplayFrame): VisualNode {
  return { ...node, status: replayFrame.nodeStatuses.get(node.id) ?? node.status };
}

function EvidencePill({ type, count }: { type: VisualNodeType; count: number }) {
  const def = visualNodeTypeDefinition(type);
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${def.bgClass} ${def.accentClass}`}>
      {evidenceCountLabel(type, count)}
    </span>
  );
}

function PrimaryNodeCard({ data, selected }: NodeProps<PrimaryFlowNode>) {
  const node = { ...data.visualNode, status: data.replayStatus ?? data.visualNode.status };
  const typeDef = visualNodeTypeDefinition(node.type);
  const statusDef = visualNodeStatusDefinition(node.status);
  const Icon = visualNodeIcon(node);
  const counts = node.evidenceCounts;
  const hasEvidence = Boolean(counts && Object.values(counts).some((c) => c > 0));

  return (
    <div
      data-testid={`canvas-node-${node.id}`}
      data-status={node.status}
      data-node-kind={node.kind}
      data-active={data.active ? "true" : "false"}
      className={[
        "visual-run-node rounded-xl border border-l-4 bg-white px-3 py-2.5 text-left shadow-sm transition-all",
        statusDef.borderClass,
        data.active ? "visual-run-node-active ring-2 ring-cyan-300" : "",
        selected ? "ring-2 ring-teal-400 shadow-md" : "border-slate-200 hover:shadow-md",
      ].join(" ")}
      style={{ width: STAGE_W }}
    >
      <Handle type="target" position={Position.Left} id="left-target" className="!h-2 !w-2 !bg-slate-400" />
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 shrink-0 rounded-md p-1 ${typeDef.bgClass}`}>
          <Icon className={`h-3.5 w-3.5 ${typeDef.accentClass}`} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-xs font-semibold leading-tight text-slate-900">{node.identity.title}</p>
          {node.identity.agentName && (
            <p className="mt-0.5 truncate text-[10px] text-indigo-600">
              Agent: {node.identity.agentName}
              {node.identity.agentRole ? ` · role: ${node.identity.agentRole}` : ""}
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              {node.identity.typeLabel}
            </span>
            {node.identity.badge && (
              <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">
                {node.identity.badge}
              </span>
            )}
            <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">
              {statusDef.label}
            </span>
          </div>
        </div>
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${statusDef.dotClass}`} aria-hidden="true" />
      </div>
      {typeof node.durationMs === "number" && (
        <p className="mt-1 text-[10px] text-slate-400">{formatDuration(node.durationMs)}</p>
      )}
      {counts && (
        <div className="mt-2 flex flex-wrap gap-1">
          {counts.agents > 0 && <EvidencePill type="agent" count={counts.agents} />}
          {counts.models > 0 && <EvidencePill type="model" count={counts.models} />}
          {counts.tools > 0 && <EvidencePill type="tool" count={counts.tools} />}
          {counts.evals > 0 && <EvidencePill type="eval" count={counts.evals} />}
          {counts.skills > 0 && <EvidencePill type="skill" count={counts.skills} />}
          {counts.cli > 0 && <EvidencePill type="cli" count={counts.cli} />}
          {counts.artifacts > 0 && <EvidencePill type="artifact" count={counts.artifacts} />}
          {counts.issues > 0 && <EvidencePill type="issue" count={counts.issues} />}
        </div>
      )}
      <Handle type="source" position={Position.Right} id="right-source" className="!h-2 !w-2 !bg-slate-400" />
      {hasEvidence && (
        <Handle type="source" position={Position.Bottom} id="bottom-source" className="!h-2 !w-2 !bg-slate-300" />
      )}
    </div>
  );
}

function EvidenceNodeChip({ data, selected }: NodeProps<EvidenceFlowNode>) {
  const node = { ...data.visualNode, status: data.replayStatus ?? data.visualNode.status };
  const typeDef = visualNodeTypeDefinition(node.type);
  const statusDef = visualNodeStatusDefinition(node.status);
  const Icon = visualNodeIcon(node);
  const chips = metricChips(node).slice(0, 3);

  return (
    <div
      data-testid={`canvas-evidence-${node.id}`}
      data-status={node.status}
      data-node-type={node.type}
      data-active={data.active ? "true" : "false"}
      className={[
        "visual-run-node visual-run-evidence-node rounded-lg border px-2 py-1.5 text-left shadow-sm transition-all",
        typeDef.bgClass,
        typeDef.borderClass,
        data.active ? "visual-run-node-active ring-2 ring-cyan-300" : "",
        selected ? "ring-2 ring-teal-400" : "",
      ].join(" ")}
      style={{ width: EVIDENCE_W }}
    >
      <Handle type="target" position={Position.Top} id="top-target" className="!h-1.5 !w-1.5 !bg-slate-300" />
      <div className="flex items-start gap-1.5">
        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${typeDef.accentClass}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-800">{node.identity.title}</span>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDef.dotClass}`} aria-hidden="true" />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="rounded bg-white/70 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
              {node.identity.typeLabel}
            </span>
            {node.identity.badge && (
              <span className="rounded bg-white/70 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
                {node.identity.badge}
              </span>
            )}
            <span className="rounded bg-white/70 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
              {statusDef.label}
            </span>
          </div>
          {chips.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {chips.map((chip) => (
                <span key={chip} className="rounded bg-white/70 px-1 py-0.5 text-[9px] text-slate-500">
                  {chip}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const NODE_TYPES = { primary: PrimaryNodeCard, evidence: EvidenceNodeChip };

// ── React Flow node/edge builders ──────────────────────────────────────────────

function toFlowNodes(graph: VisualRunGraph, layout: CanvasLayout, replayFrame: VisualReplayFrame): RFNode[] {
  const primary: PrimaryFlowNode[] = graph.primaryNodes.map((n) => ({
    id: n.id,
    type: "primary",
    position: layout.primaryPositions.get(n.id) ?? { x: 0, y: 0 },
    data: {
      visualNode: n,
      replayStatus: replayFrame.nodeStatuses.get(n.id),
      active: replayFrame.activeNodeId === n.id,
    },
    draggable: false,
    connectable: false,
    style: { width: STAGE_W },
  }));
  const evidence: EvidenceFlowNode[] = graph.evidenceNodes
    .filter((n) => layout.evidencePositions.has(n.id))
    .filter((n) => replayFrame.visibleNodeIds.has(n.id))
    .map((n) => ({
      id: n.id,
      type: "evidence",
      position: layout.evidencePositions.get(n.id) ?? { x: 0, y: 0 },
      data: {
        visualNode: n,
        replayStatus: replayFrame.nodeStatuses.get(n.id),
        active: replayFrame.activeNodeId === n.id,
      },
      draggable: false,
      connectable: false,
      style: { width: EVIDENCE_W },
    }));
  return [...primary, ...evidence];
}

function toFlowEdges(graph: VisualRunGraph, replayFrame: VisualReplayFrame): RFEdge[] {
  const workflowEdges: RFEdge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    sourceHandle: "right-source",
    targetHandle: "left-target",
    type: "smoothstep",
    label: e.label ?? "workflow",
    labelStyle: { fontSize: 10, fill: "#64748b" },
    labelBgStyle: { fill: "#ffffff", fillOpacity: 0.85 },
    className: replayFrame.activeEdgeId === e.id ? "visual-run-edge-active" : "",
    style: {
      stroke: replayFrame.activeEdgeId === e.id ? "#0f766e" : EVIDENCE_EDGE_COLOR.workflow,
      strokeWidth: replayFrame.activeEdgeId === e.id ? 3 : 2,
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: EVIDENCE_EDGE_COLOR.workflow },
  }));
  const visibleNodeIds = replayFrame.visibleNodeIds;
  const evidenceEdges: RFEdge[] = graph.evidenceEdges
    .filter((e) => visibleNodeIds.has(e.to))
    .map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      sourceHandle: "bottom-source",
      targetHandle: "top-target",
      type: "straight",
      label: e.label ?? e.type,
      labelStyle: { fontSize: 9, fill: EVIDENCE_EDGE_COLOR[e.type] },
      labelBgStyle: { fill: "#ffffff", fillOpacity: 0.85 },
      className: replayFrame.activeEdgeId === e.id ? "visual-run-edge-active" : "",
      style: {
        stroke: replayFrame.activeEdgeId === e.id ? "#0f766e" : EVIDENCE_EDGE_COLOR[e.type],
        strokeWidth: replayFrame.activeEdgeId === e.id ? 2.5 : 1.5,
        strokeDasharray: "4 3",
      },
    }));
  return [...workflowEdges, ...evidenceEdges];
}

// ── Inspector ────────────────────────────────────────────────────────────────

function findNode(graph: VisualRunGraph, id: string): VisualNode | undefined {
  return (
    graph.primaryNodes.find((n) => n.id === id) ??
    graph.internalNodes.find((n) => n.id === id) ??
    graph.evidenceNodes.find((n) => n.id === id)
  );
}

function RawEventRow({ event }: { event: TraceEvent }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs">
      <span className="font-mono text-slate-500">{event.event_type}</span>
      {event.status && <Badge tone="neutral" className="text-[10px]">{event.status}</Badge>}
      <span className="text-slate-400">{formatDateTime(event.timestamp)}</span>
      {event.output_summary && <span className="min-w-0 truncate text-slate-600">{event.output_summary}</span>}
    </div>
  );
}

function EvidenceGroup({ type, items }: { type: VisualNodeType; items: VisualNode[] }) {
  if (!items.length) return null;
  const def = visualNodeTypeDefinition(type);
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{def.pluralLabel}</p>
      <div className="grid gap-1.5">
        {items.map((item) => {
          const statusDef = visualNodeStatusDefinition(item.status);
          const chips = metricChips(item).slice(0, 4);
          return (
            <div key={item.id} className="flex flex-wrap items-start gap-2 rounded border border-slate-100 bg-slate-50 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{item.identity.title}</span>
              {item.identity.badge && <Badge tone="neutral" className="text-[10px]">{item.identity.badge}</Badge>}
              <Badge tone={statusDef.badgeTone} className="text-[10px]">{statusDef.label}</Badge>
              {typeof item.durationMs === "number" && (
                <Badge tone="neutral" className="text-[10px]">{formatDuration(item.durationMs)}</Badge>
              )}
              {typeof item.costUsd === "number" && (
                <Badge tone="neutral" className="text-[10px]">{formatCurrency(item.costUsd)}</Badge>
              )}
              {chips.map((chip) => <Badge key={chip} tone="neutral" className="text-[10px]">{chip}</Badge>)}
              {item.detail && <p className="w-full text-xs text-slate-500 line-clamp-2">{item.detail}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const NOTE_TYPE_LABELS: Record<AgentNoteType, string> = {
  plan: "Plan",
  decision: "Decision",
  critique: "Critique",
  recovery: "Recovery note",
  confidence: "Confidence",
  risk: "Risk",
};

/**
 * Reasoning / Decision Log — renders only structured, integration-authored,
 * user-safe note summaries (never hidden chain-of-thought). Always renders,
 * with a clean empty state, so the feature's presence is never ambiguous.
 */
function ReasoningLog({ notes }: { notes?: AgentNote[] }) {
  const list = notes ?? [];
  return (
    <div className="mt-4" data-testid="reasoning-log">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Reasoning / Decision Log</p>
      {list.length === 0 ? (
        <p className="text-xs text-slate-400" data-testid="reasoning-log-empty">
          No reasoning notes recorded for this run.
        </p>
      ) : (
        <div className="grid gap-1.5">
          {list.map((note) => (
            <div key={note.id} className="rounded border border-slate-100 bg-slate-50 px-3 py-2" data-testid={`reasoning-note-${note.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral" className="text-[10px]">{NOTE_TYPE_LABELS[note.noteType]}</Badge>
                {note.agent && <span className="text-xs text-slate-500">{note.agent}</span>}
                {note.confidence && (
                  <Badge
                    tone={note.confidence === "high" ? "success" : note.confidence === "low" ? "warning" : "neutral"}
                    className="text-[10px]"
                  >
                    {note.confidence} confidence
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-700">{note.summary}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | number | boolean | null }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex gap-3 border-b border-slate-100 py-1.5 text-xs">
      <dt className="w-32 shrink-0 text-slate-400">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-slate-700">{String(value)}</dd>
    </div>
  );
}

function MetricBadges({ node }: { node: VisualNode }) {
  const chips = metricChips(node);
  if (chips.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {chips.map((chip) => <Badge key={chip} tone="neutral">{chip}</Badge>)}
    </div>
  );
}

function MetadataFallback({ node }: { node: VisualNode }) {
  if (!node.metadata || Object.keys(node.metadata).length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Metadata</p>
      <pre className="mt-1 max-h-48 overflow-auto rounded border border-slate-100 bg-slate-50 p-2 text-xs text-slate-600">
        {JSON.stringify(node.metadata, null, 2)}
      </pre>
    </div>
  );
}

function CanvasInspector({
  node,
  graph,
  onClose,
}: {
  node: VisualNode;
  graph: VisualRunGraph;
  onClose: () => void;
}) {
  const typeDef = visualNodeTypeDefinition(node.type);
  const statusDef = visualNodeStatusDefinition(node.status);

  if (node.kind === "evidence") {
    const parent = node.parentId ? findNode(graph, node.parentId) : undefined;
    const statusValue = visualNodeStatusDefinition(node.status).label;
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-lg" data-testid="canvas-inspector">
        <InspectorHeader label={node.identity.title} id={node.id} statusDef={statusDef} onClose={onClose} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone="neutral">{typeDef.label}</Badge>
          {node.identity.badge && <Badge tone="neutral">{node.identity.badge}</Badge>}
          <Badge tone={statusDef.badgeTone}>{statusValue}</Badge>
          {typeof node.durationMs === "number" && <Badge tone="neutral">{formatDuration(node.durationMs)}</Badge>}
          {typeof node.costUsd === "number" && <Badge tone="neutral">{formatCurrency(node.costUsd)}</Badge>}
        </div>
        <MetricBadges node={node} />
        {parent && (
          <p className="mt-3 text-xs text-slate-500">
            Parent stage: <span className="font-medium text-slate-700">{parent.label}</span>
          </p>
        )}
        <dl className="mt-4">
          {node.type === "model" && (
            <>
              <DetailRow label="Provider" value={node.identity.providerLabel ?? "unknown"} />
              <DetailRow label="Model" value={node.identity.modelName ?? "unknown"} />
              <DetailRow label="Input tokens" value={node.metrics.inputTokens} />
              <DetailRow label="Output tokens" value={node.metrics.outputTokens} />
              <DetailRow label="Total tokens" value={node.metrics.totalTokens} />
              <DetailRow label="Cost" value={typeof node.metrics.costUsd === "number" ? formatCurrency(node.metrics.costUsd) : undefined} />
              <DetailRow label="Latency" value={typeof node.metrics.latencyMs === "number" ? formatDuration(node.metrics.latencyMs) : undefined} />
            </>
          )}
          {node.type === "tool" && (
            <>
              <DetailRow label="Tool name" value={node.identity.toolName ?? node.identity.title} />
              <DetailRow label="Subtype" value={node.identity.badge ?? "unknown tool"} />
              <DetailRow label="Status" value={statusValue} />
              <DetailRow label="Latency" value={typeof node.metrics.latencyMs === "number" ? formatDuration(node.metrics.latencyMs) : undefined} />
              <DetailRow label="Retries" value={node.metrics.retryCount} />
              <DetailRow label="Errors" value={node.metrics.errorCount} />
            </>
          )}
          {node.type === "cli" && (
            <>
              <DetailRow label="Command" value={node.identity.commandSummary ?? node.identity.title} />
              <DetailRow label="Type" value="CLI" />
              <DetailRow label="Status" value={statusValue} />
              <DetailRow label="Latency" value={typeof node.metrics.latencyMs === "number" ? formatDuration(node.metrics.latencyMs) : undefined} />
            </>
          )}
          {node.type === "eval" && (
            <>
              <DetailRow label="Eval name" value={node.identity.evalName ?? node.identity.title} />
              <DetailRow label="Subtype" value={node.identity.badge ?? "unknown eval"} />
              <DetailRow label="Score" value={typeof node.metrics.score === "number" ? formatPercent(node.metrics.score) : undefined} />
              <DetailRow label="Result" value={typeof node.metrics.passed === "boolean" ? (node.metrics.passed ? "pass" : "fail") : statusValue} />
              <DetailRow label="Threshold" value={typeof node.metrics.threshold === "number" ? formatPercent(node.metrics.threshold) : undefined} />
              <DetailRow label="Reason" value={node.metrics.reason} />
            </>
          )}
          {node.type === "artifact" && (
            <>
              <DetailRow label="Artifact name" value={node.identity.artifactName ?? node.identity.title} />
              <DetailRow label="Artifact type" value={node.identity.badge ?? "unknown artifact"} />
              <DetailRow label="Size" value={typeof node.metrics.sizeBytes === "number" ? `${node.metrics.sizeBytes.toLocaleString()} bytes` : undefined} />
              <DetailRow label="Content status" value={node.metrics.contentStatus} />
              <DetailRow label="Producing stage" value={parent?.label ?? node.metrics.producingStageId} />
            </>
          )}
          {(node.type === "issue" || node.type === "recovery") && (
            <>
              <DetailRow label="State" value={node.type === "recovery" ? "recovered" : statusValue} />
              <DetailRow label="Reason" value={node.metrics.reason ?? node.detail} />
              <DetailRow label="Recovered" value={node.recovered} />
            </>
          )}
          {node.type === "agent" && (
            <>
              <DetailRow label="Agent" value={node.identity.agentName ?? node.identity.title} />
              <DetailRow label="Role" value={node.identity.agentRole} />
              <DetailRow label="Owner" value={node.identity.agentOwner} />
              <DetailRow label="Actions" value={node.identity.agentActionCount} />
            </>
          )}
        </dl>
        {node.inputSummary && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Input Summary</p>
            <p className="mt-1 text-sm text-slate-700">{node.inputSummary}</p>
          </div>
        )}
        {node.outputSummary && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {node.type === "artifact" ? "Preview" : "Output Summary"}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{node.outputSummary}</p>
          </div>
        )}
        {node.detail && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Detail</p>
            <p className="mt-1 text-sm text-slate-700">{node.detail}</p>
          </div>
        )}
        {!node.outputSummary && node.type === "artifact" && <MetadataFallback node={node} />}
        {node.type !== "artifact" && <MetadataFallback node={node} />}
        {node.rawEvents.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Raw Trace Events</p>
            <div className="grid gap-1.5">
              {node.rawEvents.map((e) => (
                <RawEventRow key={e.event_id} event={e} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Primary / internal node.
  const agents = graph.evidenceNodes.filter((n) => n.parentId === node.id && n.type === "agent");
  const models = graph.evidenceNodes.filter((n) => n.parentId === node.id && n.type === "model");
  const tools = graph.evidenceNodes.filter((n) => n.parentId === node.id && n.type === "tool");
  const skills = graph.evidenceNodes.filter((n) => n.parentId === node.id && n.type === "skill");
  const cli = graph.evidenceNodes.filter((n) => n.parentId === node.id && n.type === "cli");
  const evals = graph.evidenceNodes.filter((n) => n.parentId === node.id && n.type === "eval");
  const artifacts = graph.evidenceNodes.filter((n) => n.parentId === node.id && n.type === "artifact");
  const issues = graph.evidenceNodes.filter((n) => n.parentId === node.id && n.type === "issue");
  const recoveries = graph.evidenceNodes.filter((n) => n.parentId === node.id && n.type === "recovery");

  const upstream = (node.upstreamIds ?? []).map((id) => findNode(graph, id)).filter((n): n is VisualNode => Boolean(n));
  const downstream = (node.downstreamIds ?? []).map((id) => findNode(graph, id)).filter((n): n is VisualNode => Boolean(n));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-lg" data-testid="canvas-inspector">
      <InspectorHeader label={node.identity.title} id={node.id} statusDef={statusDef} onClose={onClose} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone="neutral">{typeDef.label}</Badge>
        {node.identity.badge && <Badge tone="neutral">{node.identity.badge}</Badge>}
        <Badge tone={statusDef.badgeTone}>{statusDef.label}</Badge>
        {node.kind === "internal" && <Badge tone="neutral">Not in spec</Badge>}
        {typeof node.durationMs === "number" && <Badge tone="neutral">{formatDuration(node.durationMs)}</Badge>}
      </div>

      {node.identity.agentName && (
        <div className="mt-3 rounded border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
          <span className="font-medium">Agent:</span> {node.identity.agentName}
          {node.identity.agentRole ? <span> · role: {node.identity.agentRole}</span> : null}
          {node.identity.agentOwner ? <span> · owner: {node.identity.agentOwner}</span> : null}
        </div>
      )}

      {(node.inputSummary || node.outputSummary) && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Summary</p>
          <p className="mt-1 text-sm text-slate-700">{node.outputSummary ?? node.inputSummary}</p>
        </div>
      )}

      {(upstream.length > 0 || downstream.length > 0) && (
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="font-medium text-slate-500">Upstream</span>
            <ConnectionList nodes={upstream} />
          </div>
          <div>
            <span className="font-medium text-slate-500">Downstream</span>
            <ConnectionList nodes={downstream} />
          </div>
        </div>
      )}

      {node.inputSummary && node.outputSummary && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Input</p>
          <p className="mt-1 text-sm text-slate-700">{node.inputSummary}</p>
        </div>
      )}
      {node.outputSummary && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Output</p>
          <p className="mt-1 text-sm text-slate-700">{node.outputSummary}</p>
        </div>
      )}

      <EvidenceGroup type="agent" items={agents} />
      <EvidenceGroup type="model" items={models} />
      <EvidenceGroup type="tool" items={tools} />
      <EvidenceGroup type="skill" items={skills} />
      <EvidenceGroup type="cli" items={cli} />
      <EvidenceGroup type="eval" items={evals} />
      <EvidenceGroup type="artifact" items={artifacts} />
      <EvidenceGroup type="issue" items={issues} />
      <EvidenceGroup type="recovery" items={recoveries} />

      <ReasoningLog notes={node.notes} />

      {graph.internalNodes.length > 0 && node.kind !== "internal" && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Internal Observed Nodes</p>
          <div className="flex flex-wrap gap-1.5">
            {graph.internalNodes.map((internalNode) => (
              <Badge key={internalNode.id} tone="neutral" className="text-[10px]">
                {internalNode.label}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {node.rawEvents.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Raw Trace Events</p>
          <div className="grid gap-1.5">
            {node.rawEvents.map((e) => (
              <RawEventRow key={e.event_id} event={e} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InspectorHeader({
  label,
  id,
  statusDef,
  onClose,
}: {
  label: string;
  id: string;
  statusDef: ReturnType<typeof visualNodeStatusDefinition>;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${statusDef.dotClass}`} aria-hidden="true" />
        <div>
          <h3 className="text-base font-semibold text-slate-950">{label}</h3>
          <p className="font-mono text-xs text-slate-400">{id}</p>
        </div>
      </div>
      <button
        onClick={onClose}
        className="flex-shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        aria-label="Close inspector"
        data-testid="canvas-inspector-close"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function ConnectionList({ nodes }: { nodes: VisualNode[] }) {
  if (nodes.length === 0) return <p className="mt-0.5 text-slate-400">—</p>;
  return (
    <ul className="mt-1 space-y-1">
      {nodes.map((n) => {
        const statusDef = visualNodeStatusDefinition(n.status);
        return (
          <li key={n.id} className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDef.dotClass}`} />
            <span className="text-slate-700">{n.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ── Internal observed nodes panel ───────────────────────────────────────────────

function InternalNodesPanel({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: VisualNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!nodes.length) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50" data-testid="internal-nodes-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
        data-testid="internal-nodes-toggle"
      >
        <span className="text-xs font-medium text-slate-500">
          {nodes.length} internal node{nodes.length !== 1 ? "s" : ""} observed but not in the WorkflowSpec
        </span>
        <span className="text-xs text-slate-400" aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="flex flex-wrap gap-2 border-t border-slate-200 px-4 pb-4 pt-3">
          {nodes.map((node) => {
            const statusDef = visualNodeStatusDefinition(node.status);
            return (
              <button
                type="button"
                key={node.id}
                onClick={() => onSelect(node.id)}
                data-testid={`internal-node-${node.id}`}
                className={[
                  "flex items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 text-left shadow-sm",
                  selectedId === node.id ? "border-teal-300 ring-1 ring-teal-300" : "border-slate-200",
                ].join(" ")}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${statusDef.dotClass}`} aria-hidden="true" />
                <span className="text-xs text-slate-700">{node.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
//
// Sourced entirely from VISUAL_NODE_REGISTRY / VISUAL_STATUS_REGISTRY / the
// canvas's own edge color table, so the legend can never drift from what the
// canvas actually renders.

const LEGEND_STATUSES = ["completed", "warning", "failed", "running", "recovered", "not_observed"] as const;

const LEGEND_EDGE_TYPES: VisualEdgeType[] = ["workflow", "uses", "produces", "evaluates", "fails", "recovers", "contains"];

const EDGE_TYPE_LABELS: Record<VisualEdgeType, string> = {
  workflow: "Workflow — main execution path",
  uses: "Uses — stage/agent uses a model, tool, skill, or CLI",
  produces: "Produces — stage produces an artifact",
  evaluates: "Evaluates — eval validates a stage or artifact",
  fails: "Fails — issue encountered",
  recovers: "Recovers — issue was resolved",
  contains: "Contains — agent attached to a stage",
};

function CanvasLegend() {
  const nodeTypes = Object.values(VISUAL_NODE_REGISTRY);
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3" data-testid="canvas-legend">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Node types</p>
          <div className="grid gap-1">
            {nodeTypes.map((def) => {
              const Icon = def.icon;
              return (
                <span key={def.type} className="inline-flex items-center gap-1.5 text-xs text-slate-600" data-testid={`legend-node-${def.type}`}>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${def.bgClass}`}>
                    <Icon className={`h-3 w-3 ${def.accentClass}`} aria-hidden="true" />
                  </span>
                  {def.label}
                </span>
              );
            })}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</p>
          <div className="grid gap-1">
            {LEGEND_STATUSES.map((status) => {
              const def = visualNodeStatusDefinition(status);
              return (
                <span key={status} className="inline-flex items-center gap-1.5 text-xs text-slate-600" data-testid={`legend-status-${status}`}>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${def.dotClass}`} aria-hidden="true" />
                  {def.label}
                </span>
              );
            })}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Edges</p>
          <div className="grid gap-1">
            {LEGEND_EDGE_TYPES.map((type) => (
              <span key={type} className="inline-flex items-center gap-1.5 text-xs text-slate-600" data-testid={`legend-edge-${type}`}>
                <span
                  className="h-0.5 w-4 shrink-0 rounded-full"
                  style={{ backgroundColor: EVIDENCE_EDGE_COLOR[type] }}
                  aria-hidden="true"
                />
                {EDGE_TYPE_LABELS[type]}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface VisualExecutionCanvasProps {
  runGraph: RunGraph;
  traceEvents: TraceEvent[];
  /** When the run is still "running", the canvas shows a Live indicator and auto-follows new events. */
  runStatus?: RunRecord["status"];
}

export function VisualExecutionCanvas({ runGraph, traceEvents, runStatus }: VisualExecutionCanvasProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState(DEFAULT_CANVAS_FILTERS);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [replayIndex, setReplayIndex] = useState(-1);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [followLive, setFollowLive] = useState(true);

  const isLiveRun = runStatus === "running";

  const visualGraph = useMemo(() => buildVisualRunGraph({ runGraph, traceEvents }), [runGraph, traceEvents]);
  const replayEvents = useMemo(() => deriveVisualReplayEvents(visualGraph), [visualGraph]);
  const effectiveReplayIndex = replayIndex < -1 ? -1 : Math.min(replayIndex, replayEvents.length - 1);
  const replayFrame = useMemo(
    () => buildReplayFrame(visualGraph, replayEvents, effectiveReplayIndex),
    [visualGraph, replayEvents, effectiveReplayIndex],
  );
  const filteredGraph = useMemo(
    () => filterVisualGraph(visualGraph, filters, selectedId),
    [visualGraph, filters, selectedId],
  );
  const layout = useMemo(() => layoutVisualGraph(filteredGraph), [filteredGraph]);
  const flowNodes = useMemo(() => toFlowNodes(filteredGraph, layout, replayFrame), [filteredGraph, layout, replayFrame]);
  const flowEdges = useMemo(() => toFlowEdges(filteredGraph, replayFrame), [filteredGraph, replayFrame]);

  // Auto-follow the latest event as new trace events stream in. A user who
  // pauses follow (or takes manual replay control) during a live run keeps
  // their scrub position even as polling keeps refreshing data underneath —
  // resuming follow snaps back to the latest event.
  useEffect(() => {
    if (isLiveRun && !followLive) return;
    setReplayIndex(replayEvents.length - 1);
    setPlaying(false);
  }, [replayEvents.length, isLiveRun, followLive]);

  useEffect(() => {
    if (!playing) return;
    if (effectiveReplayIndex >= replayEvents.length - 1) {
      setPlaying(false);
      return;
    }
    const timeout = window.setTimeout(() => {
      setReplayIndex((index) => Math.min(index + 1, replayEvents.length - 1));
    }, 900 / speed);
    return () => window.clearTimeout(timeout);
  }, [playing, effectiveReplayIndex, replayEvents.length, speed]);

  useEffect(() => {
    if (!flowInstance || !replayFrame.activeNodeId) return;
    const node = flowNodes.find((candidate) => candidate.id === replayFrame.activeNodeId);
    if (!node) return;
    const width = node.type === "primary" ? STAGE_W : EVIDENCE_W;
    const height = node.type === "primary" ? STAGE_H : EVIDENCE_H;
    void flowInstance.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: 1,
      duration: 250,
    });
  }, [flowInstance, flowNodes, replayFrame.activeNodeId]);

  if (visualGraph.primaryNodes.length === 0 && visualGraph.internalNodes.length === 0) {
    return (
      <Card className="p-5" data-testid="visual-execution-canvas">
        <p className="text-sm text-slate-500">No workflow stages observed yet.</p>
      </Card>
    );
  }

  const selectedNode = selectedId ? findNode(visualGraph, selectedId) : undefined;
  const stageCount = visualGraph.primaryNodes.length;
  const notObserved = visualGraph.summary.notObservedStages;

  function handleNodeClick(_: unknown, node: RFNode) {
    setSelectedId((prev) => (prev === node.id ? null : node.id));
  }

  // Initial view focuses on the start of the workflow at a readable zoom,
  // rather than fitting the entire graph (which can shrink large graphs to
  // an unreadable size). The Controls "fit view" button remains available
  // for the full-graph view.
  function handleFlowInit(instance: ReactFlowInstance) {
    setFlowInstance(instance);
    const firstPrimary = flowNodes.filter((n) => n.type === "primary").slice(0, 3).map((n) => ({ id: n.id }));
    if (firstPrimary.length > 0) {
      void instance.fitView({ nodes: firstPrimary, padding: 0.4, maxZoom: 1, duration: 0 });
    } else {
      void instance.fitView({ padding: 0.15 });
    }
  }

  return (
    <div className="grid gap-5" data-testid="visual-execution-canvas">
      <div className="flex flex-wrap items-center gap-2">
        {visualGraph.mode === "registered_spec" ? (
          <Badge tone="info" data-testid="canvas-mode-registered">
            Workflow template{visualGraph.templateName ? `: ${visualGraph.templateName}` : ""}
          </Badge>
        ) : (
          <Badge tone="neutral" data-testid="canvas-mode-inferred">
            Workflow inferred from run events
          </Badge>
        )}
        <span className="text-xs text-slate-400">
          {stageCount} stage{stageCount !== 1 ? "s" : ""}
          {notObserved > 0 ? ` · ${notObserved} not observed` : ""}
          {visualGraph.internalNodes.length > 0
            ? ` · ${visualGraph.internalNodes.length} internal node${visualGraph.internalNodes.length !== 1 ? "s" : ""}`
            : ""}
        </span>
        {selectedNode && (
          <button className="ml-auto text-xs text-teal-700 hover:underline" onClick={() => setSelectedId(null)}>
            Clear selection
          </button>
        )}
      </div>

      {isLiveRun && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
          data-testid="live-mode-indicator"
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="font-medium">Live — run in progress</span>
          <span className="text-emerald-600">
            {followLive ? "Following latest activity" : "Follow paused — new events still arriving in the background"}
          </span>
          <button
            type="button"
            className="ml-auto rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
            onClick={() => setFollowLive((v) => !v)}
            data-testid="live-follow-toggle"
          >
            {followLive ? "Pause follow" : "Resume follow"}
          </button>
        </div>
      )}

      <ReplayControls
        events={replayEvents}
        currentIndex={effectiveReplayIndex}
        playing={playing}
        speed={speed}
        onPlay={() => {
          if (isLiveRun) setFollowLive(false);
          if (effectiveReplayIndex >= replayEvents.length - 1) setReplayIndex(-1);
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onReset={() => {
          if (isLiveRun) setFollowLive(false);
          setPlaying(false);
          setReplayIndex(-1);
        }}
        onStepForward={() => {
          if (isLiveRun) setFollowLive(false);
          setPlaying(false);
          setReplayIndex((index) => Math.min(index + 1, replayEvents.length - 1));
        }}
        onStepBackward={() => {
          if (isLiveRun) setFollowLive(false);
          setPlaying(false);
          setReplayIndex((index) => Math.max(index - 1, -1));
        }}
        onScrub={(index) => {
          if (isLiveRun) setFollowLive(false);
          setPlaying(false);
          setReplayIndex(index);
        }}
        onSpeedChange={setSpeed}
      />

      <CanvasFilters filters={filters} onChange={setFilters} />

      <div
        className="rounded-xl border border-slate-200 bg-slate-50"
        style={{ height: 560 }}
        data-testid="visual-canvas-viewport"
      >
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={NODE_TYPES}
          onNodeClick={handleNodeClick}
          onInit={handleFlowInit}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          elementsSelectable
          panOnScroll
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          maxZoom={1.5}
        >
          <Background gap={18} color="#e2e8f0" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="!bg-white" />
        </ReactFlow>
      </div>

      {selectedNode && (
        <CanvasInspector node={selectedNode} graph={visualGraph} onClose={() => setSelectedId(null)} />
      )}

      <InternalNodesPanel
        nodes={filteredGraph.internalNodes}
        selectedId={selectedId}
        onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
      />

      <CanvasLegend />
    </div>
  );
}
