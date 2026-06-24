"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatDuration, formatCurrency } from "@/components/proof-layer/format";
import type { RunGraph, RunGraphNode, RunGraphAttachment, RunGraphNodeStatus } from "@/lib/runs/runGraph";

// ── Status styles ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<RunGraphNodeStatus, {
  dot: string;
  ring: string;
  bg: string;
  text: string;
  badge: string;
  label: string;
}> = {
  completed: { dot: "bg-emerald-500", ring: "ring-emerald-200", bg: "bg-white", text: "text-slate-900", badge: "Completed", label: "Completed" },
  warning:   { dot: "bg-amber-400",   ring: "ring-amber-200",   bg: "bg-amber-50", text: "text-amber-900", badge: "Warning", label: "Warning" },
  failed:    { dot: "bg-red-500",     ring: "ring-red-200",     bg: "bg-red-50",  text: "text-red-900",  badge: "Failed", label: "Failed" },
  running:   { dot: "bg-sky-500",     ring: "ring-sky-200",     bg: "bg-sky-50",  text: "text-sky-900",  badge: "Running", label: "In progress" },
  skipped:   { dot: "bg-slate-300",   ring: "ring-slate-200",   bg: "bg-white",   text: "text-slate-500", badge: "Skipped", label: "Skipped" },
  not_observed: { dot: "bg-slate-200", ring: "ring-slate-100",  bg: "bg-slate-50", text: "text-slate-400", badge: "Not observed", label: "Not observed" },
};

// ── Attachment badge tone ─────────────────────────────────────────────────────

type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

function attachmentTone(a: RunGraphAttachment): BadgeTone {
  if (a.kind === "issue") {
    if (a.status === "critical" || a.status === "fail") return "danger";
    if (a.status === "warning") return "warning";
    return "neutral";
  }
  if (a.kind === "eval") {
    return a.status === "passed" ? "success" : "danger";
  }
  return "neutral";
}

// ── Stage inspector ───────────────────────────────────────────────────────────

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
  const evals      = node.attachments.filter((a) => a.kind === "eval");
  const artifacts  = node.attachments.filter((a) => a.kind === "artifact");
  const issues     = node.attachments.filter((a) => a.kind === "issue");

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-md" data-testid="stage-inspector">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
            <h3 className="text-base font-semibold text-slate-950">{node.label}</h3>
          </div>
          <p className="mt-0.5 font-mono text-xs text-slate-400">{node.id}</p>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Close inspector"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone={
          node.status === "completed" ? "success" :
          node.status === "failed" ? "danger" :
          node.status === "warning" ? "warning" :
          node.status === "running" ? "info" : "neutral"
        }>
          {style.badge}
        </Badge>
        <Badge tone="neutral">{node.type}</Badge>
        {typeof node.durationMs === "number" && (
          <Badge tone="neutral">{formatDuration(node.durationMs)}</Badge>
        )}
      </div>

      {node.inputSummary && (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase text-slate-400">Input</p>
          <p className="mt-1 text-sm text-slate-700">{node.inputSummary}</p>
        </div>
      )}

      {node.outputSummary && (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase text-slate-400">Output</p>
          <p className="mt-1 text-sm text-slate-700">{node.outputSummary}</p>
        </div>
      )}

      {modelCalls.length > 0 && (
        <AttachmentSection title="Model Calls" items={modelCalls} />
      )}

      {toolCalls.length > 0 && (
        <AttachmentSection title="Tools" items={toolCalls} />
      )}

      {evals.length > 0 && (
        <AttachmentSection title="Evals" items={evals} />
      )}

      {artifacts.length > 0 && (
        <AttachmentSection title="Artifacts" items={artifacts} />
      )}

      {issues.length > 0 && (
        <AttachmentSection title="Issues" items={issues} tone="danger" />
      )}

      {node.attachments.length === 0 && node.status === "not_observed" && (
        <p className="mt-4 text-sm text-slate-400">
          This stage was declared in the WorkflowSpec but no events were observed for it in this run.
        </p>
      )}
    </div>
  );
}

function AttachmentSection({
  title,
  items,
  tone,
}: {
  title: string;
  items: RunGraphAttachment[];
  tone?: BadgeTone;
}) {
  return (
    <div className="mt-4">
      <p className="text-xs font-medium uppercase text-slate-400">{title}</p>
      <div className="mt-1.5 grid gap-1.5">
        {items.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-sm text-slate-800 truncate">{item.label}</span>
            <div className="flex shrink-0 gap-1.5">
              {item.status && (
                <Badge tone={tone ?? attachmentTone(item)} className="text-[10px]">
                  {item.status}
                </Badge>
              )}
              {typeof item.durationMs === "number" && (
                <Badge tone="neutral" className="text-[10px]">{formatDuration(item.durationMs)}</Badge>
              )}
              {typeof item.costUsd === "number" && (
                <Badge tone="neutral" className="text-[10px]">{formatCurrency(item.costUsd)}</Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stage node card ───────────────────────────────────────────────────────────

function StageNodeCard({
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
        "group min-w-[10rem] max-w-[13rem] rounded-lg border px-3 py-2.5 text-left shadow-sm ring-1 transition-all",
        style.ring,
        style.bg,
        isSelected
          ? "border-teal-400 ring-teal-300 shadow-md"
          : "border-slate-200 hover:border-slate-300 hover:shadow",
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className={`truncate text-xs font-semibold leading-tight ${style.text}`}>{node.label}</p>
          <p className={`mt-0.5 text-[10px] ${style.text} opacity-70`}>{style.label}</p>
        </div>
      </div>

      {typeof node.durationMs === "number" && (
        <p className="mt-1.5 truncate text-[10px] text-slate-400">{formatDuration(node.durationMs)}</p>
      )}

      {/* Count chips */}
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

// ── Lane row ──────────────────────────────────────────────────────────────────

function LaneRow({
  laneLabel,
  showLaneHeader,
  nodes,
  selectedNodeId,
  onNodeClick,
}: {
  laneLabel: string;
  showLaneHeader: boolean;
  nodes: RunGraphNode[];
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string) => void;
}) {
  return (
    <div className="grid gap-2">
      {showLaneHeader && (
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            {laneLabel}
          </span>
          <div className="h-px flex-1 bg-slate-100" />
        </div>
      )}
      <div className="flex flex-wrap items-stretch gap-2">
        {nodes.map((node, idx) => (
          <div key={node.id} className="flex items-center gap-2">
            <StageNodeCard
              node={node}
              isSelected={selectedNodeId === node.id}
              onClick={() => onNodeClick(node.id)}
            />
            {idx < nodes.length - 1 && (
              <span className="shrink-0 text-slate-300" aria-hidden="true">→</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

const LEGEND_KEYS: RunGraphNodeStatus[] = ["completed", "warning", "failed", "running", "not_observed"];

function GraphLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-slate-500">
      {LEGEND_KEYS.map((key) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${STATUS_STYLES[key].dot}`} aria-hidden="true" />
          {STATUS_STYLES[key].label}
        </span>
      ))}
      <span className="text-slate-300">·</span>
      <span>m=model calls · t=tool calls · e=evals · a=artifacts · ⚠=issues</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function RunWorkflowGraph({ graph }: { graph: RunGraph }) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  if (graph.nodes.length === 0) {
    return (
      <Card className="p-5">
        <p className="text-sm text-slate-500">No workflow stages observed yet.</p>
      </Card>
    );
  }

  const showLaneHeaders = graph.lanes.length > 1;
  const selectedNode = selectedNodeId
    ? graph.nodes.find((n) => n.id === selectedNodeId) ?? null
    : null;

  function handleNodeClick(nodeId: string) {
    setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
  }

  return (
    <div className="grid gap-5" data-testid="run-workflow-graph">
      {/* Mode label */}
      <div className="flex flex-wrap items-center gap-2">
        {graph.mode === "registered_spec" ? (
          <Badge tone="info">
            Workflow template{graph.templateName ? `: ${graph.templateName}` : ""}
          </Badge>
        ) : (
          <Badge tone="neutral">Workflow inferred from run events</Badge>
        )}
        <span className="text-xs text-slate-400">
          {graph.summary.totalStages} stage{graph.summary.totalStages !== 1 ? "s" : ""}
          {graph.summary.notObservedStages > 0
            ? ` · ${graph.summary.notObservedStages} not observed`
            : ""}
        </span>
      </div>

      {/* Lane rows */}
      <div className="grid gap-5 overflow-x-auto pb-1">
        {graph.lanes.map((lane) => {
          const laneNodes = lane.nodeIds
            .map((id) => graph.nodes.find((n) => n.id === id))
            .filter((n): n is RunGraphNode => n !== undefined);

          return (
            <LaneRow
              key={lane.id}
              laneLabel={lane.label}
              showLaneHeader={showLaneHeaders}
              nodes={laneNodes}
              selectedNodeId={selectedNodeId}
              onNodeClick={handleNodeClick}
            />
          );
        })}
      </div>

      {/* Stage inspector */}
      {selectedNode && (
        <StageInspector
          node={selectedNode}
          onClose={() => setSelectedNodeId(null)}
        />
      )}

      <GraphLegend />
    </div>
  );
}
