"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatCurrency, formatDuration, formatDateTime } from "@/components/proof-layer/format";
import type { TraceEvent } from "@/lib/proof-layer/schemas";

type FilterKey = "all" | "nodes" | "models" | "tools" | "evals" | "artifacts" | "errors";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "nodes", label: "Nodes" },
  { key: "models", label: "Models" },
  { key: "tools", label: "Tools" },
  { key: "evals", label: "Evals" },
  { key: "artifacts", label: "Artifacts" },
  { key: "errors", label: "Errors" },
];

function matchesFilter(event: TraceEvent, filter: FilterKey): boolean {
  if (filter === "all") return true;
  const t = event.event_type;
  if (filter === "nodes") return t === "node_started" || t === "node_completed" || t === "node_failed";
  if (filter === "models") return t === "model_call_started" || t === "model_call_completed";
  if (filter === "tools") return t === "tool_call_started" || t === "tool_call_completed" || t === "tool_call_failed";
  if (filter === "evals") return t === "eval_completed";
  if (filter === "artifacts") return t === "artifact_created";
  if (filter === "errors") return t === "error" || t === "node_failed" || t === "tool_call_failed" || t === "retry_started";
  return true;
}

function countForFilter(events: TraceEvent[], filter: FilterKey): number {
  if (filter === "all") return events.length;
  return events.filter((e) => matchesFilter(e, filter)).length;
}

function eventTone(event: TraceEvent) {
  if (event.event_type.includes("failed") || event.event_type === "error" || event.status === "failed") {
    return "danger" as const;
  }
  if (event.event_type.includes("started") || event.status === "pending") {
    return "info" as const;
  }
  if (event.event_type.includes("approval") || event.event_type.includes("retry")) {
    return "warning" as const;
  }
  return "success" as const;
}

function metadataPreview(event: TraceEvent): string | null {
  const metadata = event.metadata ?? {};
  const entries = Object.entries(metadata).slice(0, 4);
  if (!entries.length) {
    return null;
  }

  return entries
    .map(([key, value]) => `${key}: ${typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : "object"}`)
    .join(", ");
}

export function TraceTimeline({ traceEvents }: { traceEvents: TraceEvent[] }) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

  const orderedEvents = [...traceEvents].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const filteredEvents = orderedEvents.filter((e) => matchesFilter(e, activeFilter));

  if (!orderedEvents.length) {
    return <Card className="p-5 text-sm text-slate-600">No trace events recorded.</Card>;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Timeline filters">
        {FILTERS.map(({ key, label }) => {
          const count = countForFilter(orderedEvents, key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveFilter(key)}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                activeFilter === key
                  ? "border-teal-700 bg-teal-700 text-white"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white"
              }`}
              data-testid={`timeline-filter-${key}`}
            >
              {label}
              {count > 0 ? (
                <span className={`rounded-full px-1 text-[10px] font-semibold tabular-nums ${
                  activeFilter === key ? "bg-teal-600 text-white" : "bg-slate-200 text-slate-600"
                }`}>
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {filteredEvents.length === 0 ? (
        <Card className="p-5 text-sm text-slate-500">
          No {activeFilter === "all" ? "" : activeFilter + " "}events recorded.
        </Card>
      ) : (
        <div className="grid gap-3">
          {filteredEvents.map((event) => (
            <Card key={event.event_id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={eventTone(event)}>{event.event_type}</Badge>
                    {event.status ? <Badge tone="neutral">{event.status}</Badge> : null}
                    {event.node_id ? <Badge tone="info">{event.node_id}</Badge> : null}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{formatDateTime(event.timestamp)}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                  {event.duration_ms ? <span>{formatDuration(event.duration_ms)}</span> : null}
                  {event.cost_usd ? <span>{formatCurrency(event.cost_usd)}</span> : null}
                </div>
              </div>
              {event.input_summary ? <p className="mt-3 text-sm text-slate-700">Input: {event.input_summary}</p> : null}
              {event.output_summary ? <p className="mt-2 text-sm text-slate-700">Output: {event.output_summary}</p> : null}
              {metadataPreview(event) ? (
                <p className="mt-2 text-xs text-slate-500">Metadata: {metadataPreview(event)}</p>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
