import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EvalResultsPanel } from "@/components/proof-layer/EvalResultsPanel";
import { ToolCallsPanel } from "@/components/proof-layer/ToolCallsPanel";
import { formatCurrency, formatDuration } from "@/components/proof-layer/format";
import type { EvalResult, TraceEvent, WorkflowNode } from "@/lib/proof-layer/schemas";

function nodeCost(events: TraceEvent[]): number {
  return events.reduce((sum, event) => sum + (event.cost_usd ?? 0), 0);
}

function nodeDuration(events: TraceEvent[]): number {
  const completed = events.find((event) => event.event_type === "node_completed" || event.event_type === "node_failed");
  if (completed?.duration_ms) {
    return completed.duration_ms;
  }

  return events.reduce((sum, event) => sum + (event.duration_ms ?? 0), 0);
}

export function NodeDetailPanel({
  node,
  traceEvents,
  evalResults,
}: {
  node: WorkflowNode;
  traceEvents: TraceEvent[];
  evalResults: EvalResult[];
}) {
  const inputSummaries = traceEvents.map((event) => event.input_summary).filter(Boolean);
  const outputSummaries = traceEvents.map((event) => event.output_summary).filter(Boolean);
  const errors = traceEvents.filter((event) => event.event_type === "error" || event.event_type === "node_failed");
  const retries = traceEvents.filter((event) => event.event_type === "retry_started");
  const failedEvals = evalResults.filter((result) => !result.passed);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-950">{node.label}</h3>
          <p className="mt-1 text-sm text-slate-600">{node.description ?? "No description recorded."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="info">{node.type}</Badge>
          {node.permission_class ? <Badge tone="neutral">{node.permission_class}</Badge> : null}
        </div>
      </div>

      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs font-medium uppercase text-slate-500">Model</dt>
          <dd className="mt-1 text-slate-800">{[node.model_provider, node.model_name].filter(Boolean).join(" / ") || "Not applicable"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-slate-500">Duration</dt>
          <dd className="mt-1 text-slate-800">{formatDuration(nodeDuration(traceEvents))}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-slate-500">Cost</dt>
          <dd className="mt-1 text-slate-800">{formatCurrency(nodeCost(traceEvents))}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-slate-500">Retries</dt>
          <dd className="mt-1 text-slate-800">{retries.length}</dd>
        </div>
      </dl>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase text-slate-500">Schemas</h4>
          <p className="mt-2 text-sm text-slate-700">Input: {node.input_schema_ref ?? "Not declared"}</p>
          <p className="mt-1 text-sm text-slate-700">Output: {node.output_schema_ref ?? "Not declared"}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-slate-500">Allowed Tools and Evals</h4>
          <p className="mt-2 text-sm text-slate-700">Tools: {node.allowed_tools?.join(", ") || "None declared"}</p>
          <p className="mt-1 text-sm text-slate-700">Evals: {node.eval_refs?.join(", ") || "None declared"}</p>
        </div>
      </div>

      {inputSummaries.length ? (
        <div className="mt-5">
          <h4 className="text-xs font-semibold uppercase text-slate-500">Input Summaries</h4>
          <ul className="mt-2 grid gap-1 text-sm text-slate-700">
            {inputSummaries.map((summary) => <li key={summary}>- {summary}</li>)}
          </ul>
        </div>
      ) : null}

      {outputSummaries.length ? (
        <div className="mt-5">
          <h4 className="text-xs font-semibold uppercase text-slate-500">Output Summaries</h4>
          <ul className="mt-2 grid gap-1 text-sm text-slate-700">
            {outputSummaries.map((summary) => <li key={summary}>- {summary}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section>
          <h4 className="mb-3 text-sm font-semibold text-slate-950">Tool Calls</h4>
          <ToolCallsPanel traceEvents={traceEvents} embedded />
        </section>
        <section>
          <h4 className="mb-3 text-sm font-semibold text-slate-950">Eval Results</h4>
          <EvalResultsPanel evalResults={evalResults} embedded />
        </section>
      </div>

      <div className="mt-5">
        <h4 className="text-xs font-semibold uppercase text-slate-500">Errors and Recommendations</h4>
        {errors.length ? (
          <ul className="mt-2 grid gap-1 text-sm text-red-700">
            {errors.map((event) => <li key={event.event_id}>- {event.output_summary ?? event.event_type}</li>)}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-700">No node errors recorded.</p>
        )}
        {failedEvals.length ? (
          <ul className="mt-2 grid gap-1 text-sm text-slate-700">
            {failedEvals.map((result) => <li key={result.eval_id}>- {result.recommendation ?? result.name}</li>)}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}
