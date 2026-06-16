import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatDuration, formatDateTime } from "@/components/proof-layer/format";
import { deriveEventDurationMs } from "@/lib/runs/runIntelligence";
import type { TraceEvent } from "@/lib/proof-layer/schemas";

interface ToolCallView {
  id: string;
  toolName: string;
  permissionClass: string;
  status: "completed" | "failed" | "pending";
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  inputSummary?: string;
  outputSummary?: string;
  error?: string;
}

function metadataString(event: TraceEvent | undefined, key: string): string | undefined {
  const value = event?.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function permissionTone(permissionClass: string) {
  if (permissionClass === "destructive" || permissionClass === "external_side_effect" || permissionClass === "sensitive_data") {
    return "danger" as const;
  }
  if (permissionClass === "write_draft") {
    return "warning" as const;
  }
  return "success" as const;
}

function buildToolCalls(traceEvents: TraceEvent[]): ToolCallView[] {
  const starts = traceEvents.filter((event) => event.event_type === "tool_call_started");

  return starts.map((start) => {
    const toolCallId = metadataString(start, "tool_call_id");
    const toolName = metadataString(start, "tool_name") ?? "unknown_tool";
    const completion = traceEvents.find((event) => {
      if (event.event_type !== "tool_call_completed" && event.event_type !== "tool_call_failed") {
        return false;
      }
      if (event.run_id !== start.run_id) {
        return false;
      }
      if (toolCallId) {
        return metadataString(event, "tool_call_id") === toolCallId;
      }
      return event.node_id === start.node_id && metadataString(event, "tool_name") === toolName;
    });

    return {
      id: toolCallId ?? start.event_id,
      toolName,
      permissionClass: metadataString(start, "permission_class") ?? metadataString(completion, "permission_class") ?? "read_only",
      status: completion?.event_type === "tool_call_failed" ? "failed" : completion ? "completed" : "pending",
      startedAt: start.timestamp,
      completedAt: completion?.timestamp,
      durationMs: completion ? deriveEventDurationMs(completion) : undefined,
      inputSummary: start.input_summary,
      outputSummary: completion?.output_summary,
      error: metadataString(completion, "error") ?? completion?.output_summary,
    };
  });
}

export function ToolCallsPanel({
  traceEvents,
  embedded = false,
}: {
  traceEvents: TraceEvent[];
  embedded?: boolean;
}) {
  const toolCalls = buildToolCalls(traceEvents);

  if (!toolCalls.length) {
    return embedded
      ? <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">No tool calls recorded.</div>
      : <Card className="p-5 text-sm text-slate-600">No tool calls recorded.</Card>;
  }

  return (
    <div className="grid gap-3">
      {toolCalls.map((call) => (
        <div key={call.id} className={`${embedded ? "rounded-md border border-slate-200 bg-slate-50" : "rounded-lg border border-slate-200 bg-white shadow-sm"} p-4`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">{call.toolName}</h3>
              <p className="mt-1 text-xs text-slate-500">{call.id}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={call.status === "failed" ? "danger" : call.status === "pending" ? "warning" : "success"}>
                {call.status}
              </Badge>
              <Badge tone={permissionTone(call.permissionClass)}>{call.permissionClass}</Badge>
            </div>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase text-slate-500">Started</dt>
              <dd className="mt-1 text-slate-800">{formatDateTime(call.startedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-slate-500">Completed</dt>
              <dd className="mt-1 text-slate-800">{formatDateTime(call.completedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-slate-500">Duration</dt>
              <dd className="mt-1 text-slate-800">{formatDuration(call.durationMs)}</dd>
            </div>
          </dl>
          {call.inputSummary ? <p className="mt-3 text-sm text-slate-700">Input: {call.inputSummary}</p> : null}
          {call.outputSummary ? <p className="mt-2 text-sm text-slate-700">Output: {call.outputSummary}</p> : null}
          {call.status === "failed" && call.error ? <p className="mt-2 text-sm text-red-700">Error: {call.error}</p> : null}
        </div>
      ))}
    </div>
  );
}
