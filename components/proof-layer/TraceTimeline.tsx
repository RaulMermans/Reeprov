import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatCurrency, formatDuration, formatDateTime } from "@/components/proof-layer/format";
import type { TraceEvent } from "@/lib/proof-layer/schemas";

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
  const orderedEvents = [...traceEvents].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (!orderedEvents.length) {
    return <Card className="p-5 text-sm text-slate-600">No trace events recorded.</Card>;
  }

  return (
    <div className="grid gap-3">
      {orderedEvents.map((event) => (
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
  );
}
