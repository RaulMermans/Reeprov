"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatDuration, formatDateTime } from "@/components/proof-layer/format";
import type { RunStage, StageStatus } from "@/lib/runs/runIntelligence";

const STATUS_TONE: Record<StageStatus, "success" | "warning" | "danger" | "info" | "neutral"> = {
  completed: "success",
  warning: "warning",
  failed: "danger",
  running: "info",
  skipped: "neutral",
};

const STATUS_LABEL: Record<StageStatus, string> = {
  completed: "Completed",
  warning: "Warning / recovered",
  failed: "Failed",
  running: "In progress",
  skipped: "Skipped",
};

function StageCount({ label, value }: { label: string; value: number }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
      {value} {label}
    </span>
  );
}

/**
 * Default reading surface for a run: stages grouped from raw trace events,
 * each summarized into a card with raw events tucked behind an expander.
 */
export function WorkflowStageCards({ stages }: { stages: RunStage[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (!stages.length) {
    return <Card className="p-5 text-sm text-slate-600">No workflow stages observed in this run.</Card>;
  }

  return (
    <div className="grid gap-3" data-testid="workflow-stage-cards">
      {stages.map((stage, index) => {
        const isOpen = Boolean(expanded[stage.id]);
        return (
          <Card key={stage.id} className="p-4" data-testid={`stage-card-${stage.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">{stage.label}</h3>
                  <p className="text-xs font-mono text-slate-400">{stage.id}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONE[stage.status]}>{STATUS_LABEL[stage.status]}</Badge>
                <span className="text-xs text-slate-500">{formatDuration(stage.durationMs)}</span>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <StageCount label="model calls" value={stage.modelCallCount} />
              <StageCount label="tool calls" value={stage.toolCallCount} />
              <StageCount label="evals" value={stage.evalCount} />
              <StageCount label="errors" value={stage.errorCount} />
            </div>

            {stage.inputSummary ? (
              <p className="mt-3 text-sm text-slate-700">
                <span className="font-medium text-slate-500">In: </span>
                {stage.inputSummary}
              </p>
            ) : null}
            {stage.outputSummary ? (
              <p className="mt-1 text-sm text-slate-700">
                <span className="font-medium text-slate-500">Out: </span>
                {stage.outputSummary}
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => setExpanded((prev) => ({ ...prev, [stage.id]: !prev[stage.id] }))}
              className="mt-3 text-xs font-medium text-teal-700 hover:underline"
              data-testid={`stage-toggle-${stage.id}`}
            >
              {isOpen ? "Hide raw events ▲" : `Show ${stage.events.length} raw event${stage.events.length === 1 ? "" : "s"} ▼`}
            </button>

            {isOpen ? (
              <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3">
                {stage.events.map((event) => (
                  <div key={event.event_id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-slate-800">{event.event_type}</span>
                      <span className="text-slate-400">{formatDateTime(event.timestamp)}</span>
                    </div>
                    {event.input_summary ? <p className="mt-1 text-slate-600">In: {event.input_summary}</p> : null}
                    {event.output_summary ? <p className="mt-1 text-slate-600">Out: {event.output_summary}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
