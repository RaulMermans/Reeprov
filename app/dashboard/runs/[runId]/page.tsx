import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EvalResultsPanel } from "@/components/proof-layer/EvalResultsPanel";
import { ToolCallsPanel } from "@/components/proof-layer/ToolCallsPanel";
import { TraceTimeline } from "@/components/proof-layer/TraceTimeline";
import { formatCurrency, formatDuration, formatDateTime } from "@/components/proof-layer/format";
import {
  getExampleEvalResults,
  getExampleTraceEvents,
  getRunById,
  getWorkflowById,
} from "@/lib/proof-layer/examples";
import type { TraceEvent } from "@/lib/proof-layer/schemas";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const run = getRunById(runId);
  if (!run) {
    notFound();
  }

  const workflow = getWorkflowById(run.workflow_id);
  const traceEvents = getExampleTraceEvents(run.run_id);
  const evalResults = getExampleEvalResults(run.run_id);
  const modelEvents = traceEvents.filter((event) => event.event_type === "model_call_started" || event.event_type === "model_call_completed");
  const errorEvents = traceEvents.filter((event) => event.event_type === "error" || event.event_type === "node_failed" || event.event_type === "tool_call_failed");
  const retryEvents = traceEvents.filter((event) => event.event_type === "retry_started");
  const artifactEvents = traceEvents.filter((event) => event.event_type === "artifact_created");

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <nav className="flex items-center gap-1.5 text-xs font-medium text-slate-500" aria-label="Breadcrumb">
        <Link href="/dashboard" className="hover:text-teal-700">Overview</Link>
        <span>/</span>
        <Link href="/dashboard/workflows" className="hover:text-teal-700">Workflows</Link>
        {workflow ? (
          <>
            <span>/</span>
            <Link href={`/dashboard/workflows/${workflow.workflow_id}`} className="hover:text-teal-700">{workflow.name}</Link>
          </>
        ) : null}
        <span>/</span>
        <span className="font-mono text-slate-400">{run.run_id}</span>
      </nav>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-teal-700">Run timeline</p>
            <h1 className="mt-1 text-3xl font-semibold text-slate-950">{run.project_name}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">{run.summary}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={run.status === "completed" ? "success" : run.status === "failed" ? "danger" : "warning"}>{run.status}</Badge>
            <Badge tone="info">{run.workflow_id}</Badge>
          </div>
        </div>
        <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <SummaryItem label="Started" value={formatDateTime(run.started_at)} />
          <SummaryItem label="Completed" value={formatDateTime(run.completed_at)} />
          <SummaryItem label="Duration" value={formatDuration(run.total_duration_ms)} />
          <SummaryItem label="Total Cost" value={formatCurrency(run.total_cost_usd ?? 0)} />
          <SummaryItem label="Model Calls" value={String(run.model_calls_count)} />
          <SummaryItem label="Tool Calls" value={String(run.tool_calls_count)} />
          <SummaryItem label="Evals" value={`${run.evals_passed} passed / ${run.evals_failed} failed`} />
          <SummaryItem label="Approval" value={run.approval_status ?? "not recorded"} />
        </dl>
      </Card>

      <section className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-xl font-semibold text-slate-950">Workflow Execution</h2>
          <div className="mt-4 grid gap-3">
            {(workflow?.nodes ?? []).map((node, index) => {
              const nodeEvents = traceEvents.filter((event) => event.node_id === node.id);
              const failed = nodeEvents.some((event) => event.event_type === "node_failed" || event.event_type === "error");
              const completed = nodeEvents.some((event) => event.event_type === "node_completed" || event.event_type === "model_call_completed" || event.event_type === "tool_call_completed");
              return (
                <div key={node.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-xs font-semibold text-white">{index + 1}</span>
                      <div>
                        <p className="text-sm font-semibold text-slate-950">{node.label}</p>
                        <p className="text-xs text-slate-500">{node.id}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone="info">{node.type}</Badge>
                      <Badge tone={failed ? "danger" : completed ? "success" : "neutral"}>{failed ? "failed" : completed ? "observed" : "not observed"}</Badge>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-xl font-semibold text-slate-950">Cost and Latency Summary</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <SummaryItem label="Total Duration" value={formatDuration(run.total_duration_ms)} />
            <SummaryItem label="Total Model Cost" value={formatCurrency(run.total_cost_usd ?? 0)} />
            <SummaryItem label="Model Events" value={String(modelEvents.length)} />
            <SummaryItem label="Trace Events" value={String(traceEvents.length)} />
          </dl>
        </Card>
      </section>

      <RunSection title="Trace Timeline">
        <TraceTimeline traceEvents={traceEvents} />
      </RunSection>

      <RunSection title="Model Calls">
        <ModelCalls events={modelEvents} />
      </RunSection>

      <RunSection title="Tool Calls">
        <ToolCallsPanel traceEvents={traceEvents} />
      </RunSection>

      <RunSection title="Eval Results">
        <EvalResultsPanel evalResults={evalResults} />
      </RunSection>

      <RunSection title="Errors and Retries">
        <ErrorsAndRetries errors={errorEvents} retries={retryEvents} />
      </RunSection>

      <RunSection title="Artifacts">
        <Artifacts events={artifactEvents} fallbackRefs={run.artifact_refs} />
      </RunSection>
    </main>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-800">{value}</dd>
    </div>
  );
}

function RunSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-xl font-semibold text-slate-950">{title}</h2>
      {children}
    </section>
  );
}

function ModelCalls({ events }: { events: TraceEvent[] }) {
  if (!events.length) {
    return <Card className="p-5 text-sm text-slate-600">No model calls recorded.</Card>;
  }

  return (
    <div className="grid gap-3">
      {events.map((event) => (
        <Card key={event.event_id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">{event.event_type}</h3>
              <p className="mt-1 text-xs text-slate-500">{event.node_id ?? "run"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {typeof event.metadata?.["model_provider"] === "string" ? <Badge tone="info">{event.metadata["model_provider"]}</Badge> : null}
              {typeof event.metadata?.["model_name"] === "string" ? <Badge tone="neutral">{event.metadata["model_name"]}</Badge> : null}
              {event.cost_usd ? <Badge tone="success">{formatCurrency(event.cost_usd)}</Badge> : null}
            </div>
          </div>
          {event.input_summary ? <p className="mt-3 text-sm text-slate-700">Input: {event.input_summary}</p> : null}
          {event.output_summary ? <p className="mt-2 text-sm text-slate-700">Output: {event.output_summary}</p> : null}
        </Card>
      ))}
    </div>
  );
}

function ErrorsAndRetries({ errors, retries }: { errors: TraceEvent[]; retries: TraceEvent[] }) {
  if (!errors.length && !retries.length) {
    return <Card className="p-5 text-sm text-slate-600">No errors or retries recorded.</Card>;
  }

  return (
    <div className="grid gap-3">
      {[...errors, ...retries].map((event) => (
        <Card key={event.event_id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-950">{event.event_type}</h3>
            <Badge tone={event.event_type === "retry_started" ? "warning" : "danger"}>{event.status ?? event.event_type}</Badge>
          </div>
          <p className="mt-2 text-sm text-slate-700">{event.output_summary ?? event.input_summary ?? "No summary recorded."}</p>
        </Card>
      ))}
    </div>
  );
}

function Artifacts({ events, fallbackRefs }: { events: TraceEvent[]; fallbackRefs: string[] }) {
  const refs = events.map((event) => event.metadata?.["artifact_ref"]).filter((value): value is string => typeof value === "string");
  const artifactRefs = refs.length ? refs : fallbackRefs;

  if (!artifactRefs.length) {
    return <Card className="p-5 text-sm text-slate-600">No artifacts recorded.</Card>;
  }

  return (
    <div className="grid gap-3">
      {artifactRefs.map((ref) => (
        <Card key={ref} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-950">{ref}</h3>
            <Badge tone="info">artifact</Badge>
          </div>
        </Card>
      ))}
    </div>
  );
}
