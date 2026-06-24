"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatDuration, formatCurrency } from "@/components/proof-layer/format";
import type {
  RunGraph,
  RunGraphNode,
  RunGraphAttachment,
  RunGraphNodeStatus,
  RunGraphEdge,
} from "@/lib/runs/runGraph";

// ── Layout constants ──────────────────────────────────────────────────────────

const NODE_W = 176;
const NODE_H = 92;
const H_GAP = 80;
const V_GAP = 20;
const CANVAS_PAD = 24;
const HSTEP = NODE_W + H_GAP;
const VSTEP = NODE_H + V_GAP;

// ── DAG layout ────────────────────────────────────────────────────────────────

interface NodePos {
  x: number;
  y: number;
}

function computeNodeColumns(
  nodes: RunGraphNode[],
  edges: RunGraphEdge[],
): Map<string, number> {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const parentMap = new Map<string, Set<string>>();

  for (const node of nodes) {
    parentMap.set(node.id, new Set());
  }
  for (const edge of edges) {
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) {
      parentMap.get(edge.to)!.add(edge.from);
    }
  }

  const col = new Map<string, number>();
  const computing = new Set<string>();

  function getCol(id: string): number {
    if (col.has(id)) return col.get(id)!;
    if (computing.has(id)) { col.set(id, 0); return 0; }
    computing.add(id);
    const parents = [...(parentMap.get(id) ?? [])];
    const c = parents.length > 0 ? Math.max(...parents.map(getCol)) + 1 : 0;
    col.set(id, c);
    computing.delete(id);
    return c;
  }

  for (const node of nodes) getCol(node.id);
  return col;
}

function computeLayout(
  nodes: RunGraphNode[],
  edges: RunGraphEdge[],
): { positions: Map<string, NodePos>; canvasW: number; canvasH: number } {
  if (nodes.length === 0) {
    return { positions: new Map(), canvasW: CANVAS_PAD * 2, canvasH: CANVAS_PAD * 2 };
  }

  const colMap = computeNodeColumns(nodes, edges);

  const colGroups = new Map<number, RunGraphNode[]>();
  for (const node of nodes) {
    const c = colMap.get(node.id) ?? 0;
    if (!colGroups.has(c)) colGroups.set(c, []);
    colGroups.get(c)!.push(node);
  }

  const rowMap = new Map<string, number>();
  for (const [, groupNodes] of colGroups) {
    groupNodes.sort((a, b) => a.order - b.order);
    groupNodes.forEach((n, row) => rowMap.set(n.id, row));
  }

  const positions = new Map<string, NodePos>();
  for (const node of nodes) {
    const c = colMap.get(node.id) ?? 0;
    const r = rowMap.get(node.id) ?? 0;
    positions.set(node.id, {
      x: CANVAS_PAD + c * HSTEP,
      y: CANVAS_PAD + r * VSTEP,
    });
  }

  const maxC = nodes.length > 0 ? Math.max(0, ...[...colMap.values()]) : 0;
  const maxR = nodes.length > 0 ? Math.max(0, ...[...rowMap.values()]) : 0;
  const canvasW = CANVAS_PAD * 2 + maxC * HSTEP + NODE_W;
  const canvasH = CANVAS_PAD * 2 + maxR * VSTEP + NODE_H;

  return { positions, canvasW, canvasH };
}

// ── Edge path ─────────────────────────────────────────────────────────────────

function bezierEdgePath(from: NodePos, to: NodePos): string {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const cx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`;
}

// ── Status styles ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<
  RunGraphNodeStatus,
  {
    dot: string;
    borderL: string;
    ring: string;
    bg: string;
    text: string;
    label: string;
    badgeTone: "success" | "warning" | "danger" | "info" | "neutral";
  }
> = {
  completed:    { dot: "bg-emerald-500", borderL: "border-l-emerald-500", ring: "ring-emerald-200", bg: "bg-white",     text: "text-slate-900", label: "Completed",    badgeTone: "success" },
  warning:      { dot: "bg-amber-400",   borderL: "border-l-amber-400",   ring: "ring-amber-200",   bg: "bg-amber-50",  text: "text-amber-900", label: "Warning",      badgeTone: "warning" },
  failed:       { dot: "bg-red-500",     borderL: "border-l-red-500",     ring: "ring-red-200",     bg: "bg-red-50",    text: "text-red-900",  label: "Failed",       badgeTone: "danger"  },
  running:      { dot: "bg-sky-500",     borderL: "border-l-sky-500",     ring: "ring-sky-200",     bg: "bg-sky-50",    text: "text-sky-900",  label: "In progress",  badgeTone: "info"    },
  skipped:      { dot: "bg-slate-300",   borderL: "border-l-slate-300",   ring: "ring-slate-200",   bg: "bg-white",     text: "text-slate-500",label: "Skipped",      badgeTone: "neutral" },
  not_observed: { dot: "bg-slate-200",   borderL: "border-l-slate-200",   ring: "ring-slate-100",   bg: "bg-slate-50",  text: "text-slate-400",label: "Not observed", badgeTone: "neutral" },
};

// ── Attachment helpers ────────────────────────────────────────────────────────

type AttachBadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

function attachmentTone(a: RunGraphAttachment): AttachBadgeTone {
  if (a.kind === "issue") {
    if (a.recovered) return "success";
    if (a.status === "critical" || a.status === "fail") return "danger";
    if (a.status === "warning") return "warning";
    return "neutral";
  }
  if (a.kind === "eval") return a.status === "passed" ? "success" : "danger";
  return "neutral";
}

// ── Inspector panel ───────────────────────────────────────────────────────────

function AttachmentRow({ item }: { item: RunGraphAttachment }) {
  return (
    <div className="flex flex-wrap items-start gap-2 rounded border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {item.kind === "cli" && (
          <span className="shrink-0 font-mono text-[10px] text-slate-500">$</span>
        )}
        {item.kind === "skill" && (
          <span className="shrink-0 text-[10px] text-purple-500">✦</span>
        )}
        <span className="min-w-0 truncate text-sm text-slate-800">{item.label}</span>
        {item.recovered && (
          <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
            recovered
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {item.status && !item.recovered && (
          <Badge tone={attachmentTone(item)} className="text-[10px]">{item.status}</Badge>
        )}
        {typeof item.durationMs === "number" && (
          <Badge tone="neutral" className="text-[10px]">{formatDuration(item.durationMs)}</Badge>
        )}
        {typeof item.costUsd === "number" && (
          <Badge tone="neutral" className="text-[10px]">{formatCurrency(item.costUsd)}</Badge>
        )}
      </div>
      {item.detail && (
        <p className="w-full text-xs text-slate-500 line-clamp-2">{item.detail}</p>
      )}
    </div>
  );
}

function AttachmentSection({
  title,
  items,
}: {
  title: string;
  items: RunGraphAttachment[];
}) {
  if (!items.length) return null;
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </p>
      <div className="grid gap-1.5">
        {items.map((item) => (
          <AttachmentRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function StageInspector({
  node,
  onClose,
}: {
  node: RunGraphNode;
  onClose: () => void;
}) {
  const style = STATUS_STYLES[node.status];
  const modelCalls = node.attachments.filter((a) => a.kind === "model_call");
  const toolCalls  = node.attachments.filter((a) => a.kind === "tool_call");
  const skills     = node.attachments.filter((a) => a.kind === "skill");
  const cliCalls   = node.attachments.filter((a) => a.kind === "cli");
  const evals      = node.attachments.filter((a) => a.kind === "eval");
  const artifacts  = node.attachments.filter((a) => a.kind === "artifact");
  const issues     = node.attachments.filter((a) => a.kind === "issue");

  return (
    <div
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
      data-testid="stage-inspector"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${style.dot}`}
            aria-hidden="true"
          />
          <div>
            <h3 className="text-base font-semibold text-slate-950">{node.label}</h3>
            <p className="font-mono text-xs text-slate-400">{node.id}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex-shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Close inspector"
          data-testid="inspector-close"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M1 1l12 12M13 1L1 13"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone={style.badgeTone}>{style.label}</Badge>
        <Badge tone="neutral">{node.type}</Badge>
        {typeof node.durationMs === "number" && (
          <Badge tone="neutral">{formatDuration(node.durationMs)}</Badge>
        )}
      </div>

      {/* Upstream / downstream connections */}
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="font-medium text-slate-500">Lane</span>
          <p className="mt-0.5 font-mono text-slate-700">{node.laneId}</p>
        </div>
        <div>
          <span className="font-medium text-slate-500">Order</span>
          <p className="mt-0.5 text-slate-700">#{node.order + 1}</p>
        </div>
      </div>

      {node.inputSummary && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Input
          </p>
          <p className="mt-1 text-sm text-slate-700">{node.inputSummary}</p>
        </div>
      )}
      {node.outputSummary && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Output
          </p>
          <p className="mt-1 text-sm text-slate-700">{node.outputSummary}</p>
        </div>
      )}

      <AttachmentSection title="Model Calls" items={modelCalls} />
      <AttachmentSection title="Tool Calls" items={toolCalls} />
      <AttachmentSection title="Skills" items={skills} />
      <AttachmentSection title="CLI Commands" items={cliCalls} />
      <AttachmentSection title="Evals" items={evals} />
      <AttachmentSection title="Artifacts" items={artifacts} />
      <AttachmentSection title="Issues" items={issues} />

      {node.attachments.length === 0 && node.status === "not_observed" && (
        <p className="mt-4 text-sm text-slate-400">
          This stage was declared in the WorkflowSpec but no trace events were observed for it.
        </p>
      )}
    </div>
  );
}

// ── Extra nodes accordion ─────────────────────────────────────────────────────

function ExtraNodesPanel({ nodes }: { nodes: RunGraphNode[] }) {
  const [open, setOpen] = useState(false);
  if (!nodes.length) return null;

  return (
    <div
      className="rounded-lg border border-slate-200 bg-slate-50"
      data-testid="extra-nodes-panel"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
        data-testid="extra-nodes-toggle"
      >
        <span className="text-xs font-medium text-slate-500">
          {nodes.length} internal node{nodes.length !== 1 ? "s" : ""} observed but not in spec
        </span>
        <span className="text-xs text-slate-400" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="flex flex-wrap gap-2 border-t border-slate-200 px-4 pb-4 pt-3">
          {nodes.map((node) => {
            const style = STATUS_STYLES[node.status];
            return (
              <div
                key={node.id}
                className={`flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm ring-1 ${style.ring}`}
                data-testid={`extra-node-${node.id}`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`}
                  aria-hidden="true"
                />
                <span className="text-xs text-slate-700">{node.label}</span>
                {node.modelCallCount > 0 && (
                  <span className="rounded bg-sky-50 px-1 py-0.5 text-[10px] font-medium text-sky-700">
                    {node.modelCallCount}m
                  </span>
                )}
                {node.toolCallCount > 0 && (
                  <span className="rounded bg-violet-50 px-1 py-0.5 text-[10px] font-medium text-violet-700">
                    {node.toolCallCount}t
                  </span>
                )}
                {node.skillCount > 0 && (
                  <span className="rounded bg-purple-50 px-1 py-0.5 text-[10px] font-medium text-purple-700">
                    {node.skillCount}sk
                  </span>
                )}
                {node.cliCount > 0 && (
                  <span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] font-medium text-slate-600">
                    {node.cliCount}$
                  </span>
                )}
                {node.issueCount > 0 && (
                  <span className="rounded bg-red-50 px-1 py-0.5 text-[10px] font-medium text-red-600">
                    ⚠{node.issueCount}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Node card ─────────────────────────────────────────────────────────────────

function NodeCard({
  node,
  isSelected,
  onClick,
}: {
  node: RunGraphNode;
  isSelected: boolean;
  onClick: () => void;
}) {
  const style = STATUS_STYLES[node.status];

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`run-graph-node-${node.id}`}
      data-status={node.status}
      className={[
        "flex flex-col rounded-xl border border-slate-200 border-l-4 px-3 py-2.5 text-left shadow-sm transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400",
        style.borderL,
        style.bg,
        isSelected
          ? "ring-2 ring-teal-400 shadow-md"
          : "hover:shadow-md hover:ring-1 hover:ring-slate-200",
      ].join(" ")}
      style={{ width: NODE_W, minHeight: NODE_H }}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p
            className={`line-clamp-2 text-xs font-semibold leading-tight ${style.text}`}
          >
            {node.label}
          </p>
          <p className={`mt-0.5 text-[10px] opacity-60 ${style.text}`}>
            {style.label}
          </p>
        </div>
      </div>

      {typeof node.durationMs === "number" && (
        <p className="mt-1 text-[10px] text-slate-400">
          {formatDuration(node.durationMs)}
        </p>
      )}

      {/* Attachment count pills */}
      <div className="mt-2 flex flex-wrap gap-1">
        {node.modelCallCount > 0 && (
          <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
            {node.modelCallCount}m
          </span>
        )}
        {node.toolCallCount > 0 && (
          <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
            {node.toolCallCount}t
          </span>
        )}
        {node.evalCount > 0 && (
          <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">
            {node.evalCount}e
          </span>
        )}
        {node.skillCount > 0 && (
          <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
            {node.skillCount}sk
          </span>
        )}
        {node.cliCount > 0 && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-600">
            {node.cliCount}$
          </span>
        )}
        {node.artifactCount > 0 && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            {node.artifactCount}a
          </span>
        )}
        {node.issueCount > 0 && (
          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
            ⚠{node.issueCount}
          </span>
        )}
      </div>
    </button>
  );
}

// ── SVG edge layer ────────────────────────────────────────────────────────────

function EdgeLayer({
  edges,
  positions,
}: {
  edges: RunGraphEdge[];
  positions: Map<string, NodePos>;
}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <marker
          id="run-graph-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M 0 1 L 9 5 L 0 9 z" fill="#94a3b8" />
        </marker>
      </defs>
      {edges.map((edge) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return null;
        return (
          <path
            key={`${edge.from}--${edge.to}`}
            d={bezierEdgePath(from, to)}
            fill="none"
            stroke="#cbd5e1"
            strokeWidth="1.5"
            markerEnd="url(#run-graph-arrow)"
          />
        );
      })}
    </svg>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

const LEGEND_KEYS: RunGraphNodeStatus[] = [
  "completed",
  "warning",
  "failed",
  "running",
  "not_observed",
];

function GraphLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500">
      {LEGEND_KEYS.map((key) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${STATUS_STYLES[key].dot}`}
            aria-hidden="true"
          />
          {STATUS_STYLES[key].label}
        </span>
      ))}
      <span className="text-slate-300" aria-hidden="true">·</span>
      <span>
        m=model · t=tool · e=eval · sk=skill · $=cli · a=artifact · ⚠=issue
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function RunWorkflowGraph({ graph }: { graph: RunGraph }) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const { positions, canvasW, canvasH } = useMemo(
    () => computeLayout(graph.nodes, graph.edges),
    [graph.nodes, graph.edges],
  );

  if (graph.nodes.length === 0 && graph.extraNodes.length === 0) {
    return (
      <Card className="p-5" data-testid="run-workflow-graph">
        <p className="text-sm text-slate-500">No workflow stages observed yet.</p>
      </Card>
    );
  }

  const selectedNode = selectedNodeId
    ? (graph.nodes.find((n) => n.id === selectedNodeId) ?? null)
    : null;

  function handleNodeClick(nodeId: string) {
    setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
  }

  const stageCount = graph.nodes.length;
  const notObserved = graph.summary.notObservedStages;

  return (
    <div className="grid gap-5" data-testid="run-workflow-graph">
      {/* Mode label — exactly one badge renders, never both */}
      <div className="flex flex-wrap items-center gap-2">
        {graph.mode === "registered_spec" ? (
          <Badge tone="info" data-testid="graph-mode-registered">
            Workflow template{graph.templateName ? `: ${graph.templateName}` : ""}
          </Badge>
        ) : (
          <Badge tone="neutral" data-testid="graph-mode-inferred">
            Workflow inferred from run events
          </Badge>
        )}
        <span className="text-xs text-slate-400">
          {stageCount} stage{stageCount !== 1 ? "s" : ""}
          {notObserved > 0 ? ` · ${notObserved} not observed` : ""}
          {graph.extraNodes.length > 0
            ? ` · ${graph.extraNodes.length} internal node${graph.extraNodes.length !== 1 ? "s" : ""}`
            : ""}
        </span>
        {selectedNode && (
          <button
            className="ml-auto text-xs text-teal-700 hover:underline"
            onClick={() => setSelectedNodeId(null)}
          >
            Clear selection
          </button>
        )}
      </div>

      {/* DAG canvas — scrollable horizontally for wide workflows */}
      {graph.nodes.length > 0 && (
        <div className="overflow-x-auto pb-2" data-testid="graph-canvas">
          <div
            className="relative"
            style={{
              width: canvasW,
              height: canvasH,
              minWidth: "100%",
            }}
          >
            <EdgeLayer edges={graph.edges} positions={positions} />

            {graph.nodes.map((node) => {
              const pos = positions.get(node.id);
              if (!pos) return null;
              return (
                <div
                  key={node.id}
                  className="absolute"
                  style={{ left: pos.x, top: pos.y }}
                >
                  <NodeCard
                    node={node}
                    isSelected={selectedNodeId === node.id}
                    onClick={() => handleNodeClick(node.id)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Inspector panel — shown when a primary node is selected */}
      {selectedNode && (
        <StageInspector
          node={selectedNode}
          onClose={() => setSelectedNodeId(null)}
        />
      )}

      {/* Extra observed nodes accordion (spec mode only) */}
      <ExtraNodesPanel nodes={graph.extraNodes} />

      <GraphLegend />
    </div>
  );
}
