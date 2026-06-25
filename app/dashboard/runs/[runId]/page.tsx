"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EvalResultsPanel } from "@/components/proof-layer/EvalResultsPanel";
import { ToolCallsPanel } from "@/components/proof-layer/ToolCallsPanel";
import { TraceTimeline } from "@/components/proof-layer/TraceTimeline";
import { WorkflowMap } from "@/components/proof-layer/WorkflowMap";
import { RunWorkflowGraph } from "@/components/proof-layer/RunWorkflowGraph";
import { IssuesPanel } from "@/components/proof-layer/IssuesPanel";
import { ArtifactPreviewPanel } from "@/components/proof-layer/ArtifactPreviewPanel";
import { RunSummaryHeader } from "@/components/proof-layer/RunSummaryHeader";
import { RunDetailTabs, type RunDetailTab } from "@/components/proof-layer/RunDetailTabs";
import { formatCurrency, formatDuration, formatDateTime, formatPercent } from "@/components/proof-layer/format";
import {
  groupTraceEventsIntoStages,
  extractRunIssues,
  buildArtifactCards,
  buildWorkflowMap,
  buildInferredWorkflowSummary,
  deriveEventDurationMs,
  deriveRunDurationMs,
  workflowSourceLabel,
} from "@/lib/runs/runIntelligence";
import { buildRunGraph } from "@/lib/runs/runGraph";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import { useDashboardAuth } from "@/lib/auth/dashboardAuthContext";
import { getBuiltInWorkflowSpec } from "@/lib/workflows/builtInWorkflowSpecs";
import type { TraceEvent, EvalResult, RunRecord, ToolCallRecord, WorkflowSpec } from "@/lib/proof-layer/schemas";
import type { SavedRun } from "@/lib/runs/runTypes";
import type { SavedWorkflowSpec, SavedWorkflowSummary } from "@/lib/workflows/workflowTypes";

interface RunDetailState {
  run: RunRecord;
  traceEvents: TraceEvent[];
  toolCalls: ToolCallRecord[];
  evalResults: EvalResult[];
  workflow?: WorkflowSpec;
  registryWorkflow?: SavedWorkflowSpec;
  isLive: boolean;
  isSeeded: boolean;
  isDemo: boolean;
}

interface ExampleRunData {
  run: RunRecord;
  traceEvents: TraceEvent[];
  evalResults: EvalResult[];
  workflow?: WorkflowSpec;
}

export default function RunDetailPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;
  const { onUnauthorized } = useDashboardAuth();

  const [state, setState] = useState<RunDetailState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!runId) return;

    async function load() {
      setLoading(true);
      setError(null);
      setNotFound(false);

      try {
        const res = await fetch(`/api/runs/${runId}`, {
          headers: mergeAuthHeaders(),
        });

        if (res.status === 401) {
          onUnauthorized("Access key expired or invalid. Please unlock again.");
          return;
        }

        if (res.status === 404) {
          // Fall back to example data via API.
          const examplesRes = await fetch(`/api/runs/examples/${runId}`);
          if (examplesRes.ok) {
            const exData = await examplesRes.json() as ExampleRunData;
            setState({
              run: exData.run,
              traceEvents: exData.traceEvents ?? [],
              toolCalls: [],
              evalResults: exData.evalResults ?? [],
              workflow: exData.workflow ?? getBuiltInWorkflowSpec(
                exData.run.project_id,
                exData.run.workflow_id,
              ),
              isLive: false,
              isSeeded: false,
              isDemo: false,
            });
            return;
          }
          setNotFound(true);
          return;
        }

        if (!res.ok) {
          const data = await res.json() as { message?: string };
          setError(data.message ?? "Failed to load run.");
          return;
        }

        const data = await res.json() as SavedRun & { derivedSummary?: unknown };
        const traceEvents = [...(data.traceEvents ?? [])].sort((a, b) =>
          a.timestamp.localeCompare(b.timestamp)
        );

        let workflow = getBuiltInWorkflowSpec(
          data.runRecord.project_id,
          data.runRecord.workflow_id,
        );

        // Persisted registry entries take precedence over built-in templates.
        let registryWorkflow: SavedWorkflowSpec | undefined;
        try {
          const regRes = await fetch(
            `/api/workflows?projectId=${encodeURIComponent(data.runRecord.project_id)}&workflowId=${encodeURIComponent(data.runRecord.workflow_id)}&limit=1`,
            { headers: mergeAuthHeaders() },
          );
          if (regRes.ok) {
            const regData = await regRes.json() as { workflows: SavedWorkflowSummary[] };
            const registrySummary = regData.workflows?.[0];
            if (registrySummary) {
              const fullSpecRes = await fetch(
                `/api/workflows/${encodeURIComponent(registrySummary.registryId)}`,
                { headers: mergeAuthHeaders() },
              );
              if (fullSpecRes.ok) {
                registryWorkflow = await fullSpecRes.json() as SavedWorkflowSpec;
                workflow = registryWorkflow.spec;
              }
            }
          } else if (regRes.status === 401) {
            onUnauthorized("Access key expired or invalid. Please unlock again.");
            return;
          }
        } catch {
          // registry lookup is optional
        }

        // Legacy example specs remain available when no registered or built-in
        // workflow template matches the run.
        if (!workflow) {
          try {
            const wfRes = await fetch(`/api/runs/examples/${data.runRecord.workflow_id}`);
            if (wfRes.ok) {
              const wfData = await wfRes.json() as { workflow?: WorkflowSpec };
              workflow = wfData.workflow;
            }
          } catch {
            // Unknown workflows fall back to trace inference below.
          }
        }

        setState({
          run: data.runRecord,
          traceEvents,
          toolCalls: data.toolCalls ?? [],
          evalResults: data.evalResults ?? [],
          workflow,
          registryWorkflow,
          isLive: true,
          isSeeded: data.runRecord.run_id.startsWith("seed-"),
          isDemo: data.runRecord.run_id.startsWith("demo-"),
        });
      } catch {
        setError("Could not connect to AgentPulse. Is the dev server running?");
      } finally {
        setLoading(false);
      }
    }

    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Card className="p-8 text-center text-sm text-slate-500">Loading run…</Card>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <nav className="mb-6 flex items-center gap-1.5 text-xs font-medium text-slate-500" aria-label="Breadcrumb">
          <Link href="/dashboard" className="hover:text-teal-700">Overview</Link>
          <span>/</span>
          <Link href="/dashboard/runs" className="hover:text-teal-700">Runs</Link>
          <span>/</span>
          <span className="font-mono text-slate-400">{runId}</span>
        </nav>
        <Card className="p-8">
          <p className="text-sm font-medium text-slate-700">Run not found.</p>
          <p className="mt-2 text-xs text-slate-500">
            Run <code className="font-mono">{runId}</code> was not found in the store or example data.
          </p>
          <Link href="/dashboard/runs" className="mt-4 inline-block text-sm text-teal-700 hover:underline">
            ← Back to runs
          </Link>
        </Card>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Card className="p-8">
          <p className="text-sm font-medium text-red-700">{error}</p>
        </Card>
      </main>
    );
  }

  if (!state) return null;

  const { run, traceEvents, toolCalls, evalResults, workflow, registryWorkflow, isLive, isSeeded, isDemo } = state;

  const modelEvents = traceEvents.filter((e) => e.event_type === "model_call_started" || e.event_type === "model_call_completed");
  const errorEvents = traceEvents.filter((e) => e.event_type === "error" || e.event_type === "node_failed" || e.event_type === "tool_call_failed");
  const retryEvents = traceEvents.filter((e) => e.event_type === "retry_started");
  const artifactEvents = traceEvents.filter((e) => e.event_type === "artifact_created");
  const approvalEvents = traceEvents.filter((e) =>
    e.event_type === "approval_requested" || e.event_type === "approval_granted" || e.event_type === "approval_rejected"
  );

  const failedEvals = evalResults.filter((e) => !e.passed || e.severity === "critical" || e.severity === "fail");
  const hasLinkedSpec = Boolean(workflow);

  // Registered templates define the main map. Stage cards still use every
  // observed node, including internal implementation events.
  const specNodes = workflow?.nodes;

  // ── Run intelligence derivations — turn the raw run into the building blocks
  // for the visual dashboard: grouped stages, a pipeline map, an issues list,
  // artifact cards, and (when no spec is linked) an inferred-workflow summary.
  const { stages } = groupTraceEventsIntoStages(traceEvents, specNodes);
  const issues = extractRunIssues(traceEvents, evalResults, specNodes);
  const artifactCards = buildArtifactCards(traceEvents, run.artifact_refs);
  const workflowMapNodes = buildWorkflowMap(stages, workflow);
  const inferredWorkflowSummary = hasLinkedSpec ? null : buildInferredWorkflowSummary(stages);
  const artifactCount = run.artifact_refs?.length || artifactCards.length;

  // ── Generic RunGraph — powers the primary workflow visualization.
  const runGraph = buildRunGraph({
    runRecord: run,
    traceEvents,
    toolCalls,
    evalResults,
    specNodes,
    specEdges: workflow?.edges,
    templateName: registryWorkflow?.name ?? workflow?.name,
  });

  const badges = (
    <>
      {isDemo ? (
        <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
          Demo
        </span>
      ) : isLive && !isSeeded ? (
        <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
          Live ingestion
        </span>
      ) : isSeeded ? (
        <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700">
          Seeded
        </span>
      ) : (
        <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
          Example data
        </span>
      )}
      {run.status === "degraded" && (
        <span className="rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-xs font-medium text-orange-700">
          ⚠ Degraded
        </span>
      )}
    </>
  );

  // ── Critical Findings — failing/critical eval results, pinned near the top
  // of the Overview tab so they are never buried in the raw trace. ──
  const criticalFindings = failedEvals.length > 0 ? (
    <Card className="border-orange-200 bg-orange-50 p-5">
      <h2 className="text-base font-semibold text-orange-900">
        {failedEvals.some((e) => !e.passed || e.severity === "critical" || e.severity === "fail")
          ? "Failed Evals"
          : "Eval Warnings"}
      </h2>
      <p className="mt-1 text-xs text-orange-700">
        {failedEvals.length} eval result{failedEvals.length !== 1 ? "s" : ""} require attention.
      </p>
      <div className="mt-3 grid gap-2">
        {failedEvals.map((ev) => (
          <div key={ev.eval_id} className="rounded-md border border-orange-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-800">{ev.name}</p>
              <div className="flex gap-2">
                <Badge tone={!ev.passed ? "danger" : "warning"}>{ev.passed ? "warning" : "fail"}</Badge>
                <Badge tone={ev.severity === "critical" || ev.severity === "fail" ? "danger" : "warning"}>{ev.severity}</Badge>
              </div>
            </div>
            {typeof ev.score === "number" ? (
              <p className="mt-1 text-xs text-slate-500">Score: {formatPercent(ev.score)}</p>
            ) : null}
            {ev.findings.length > 0 ? (
              <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm text-slate-700">
                {ev.findings.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            ) : null}
            {ev.recommendation ? (
              <p className="mt-1 text-xs text-teal-700">{ev.recommendation}</p>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  ) : isLive ? (
    <Card className="border-emerald-200 bg-emerald-50 p-4">
      <p className="text-sm font-medium text-emerald-800">No failed evals — all eval results passed.</p>
    </Card>
  ) : null;

  // ── Tab content ──────────────────────────────────────────────────────────

  const overviewTab = (
    <div className="grid gap-6">
      <RunSummaryHeader run={run} issues={issues} evalResults={evalResults} artifactCount={artifactCount} badges={badges} />

      {criticalFindings}

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-950">Workflow Map</h2>
          <Badge tone={hasLinkedSpec ? "info" : "neutral"} data-testid="workflow-source-label">
            {workflowSourceLabel(workflow)}
          </Badge>
        </div>
        {inferredWorkflowSummary ? (
          <p className="mt-2 text-sm text-teal-700" data-testid="inferred-workflow-summary">
            {inferredWorkflowSummary.message}
          </p>
        ) : null}
        <div className="mt-4">
          <WorkflowMap nodes={workflowMapNodes} />
        </div>
      </Card>
    </div>
  );

  const workflowTab = (
    <div className="grid gap-6">
      {/* ── Primary workflow visualization ── */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-950">Workflow Graph</h2>
          {/* Linked WorkflowSpec — exactly one of these states renders, never both */}
          {registryWorkflow ? (
            <Link
              href={`/dashboard/workflows/registry/${registryWorkflow.registryId}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 transition hover:border-teal-300"
              data-testid="linked-spec-link"
            >
              Registered spec: {registryWorkflow.name}
              <Badge tone={registryWorkflow.status === "active" ? "success" : "warning"} className="ml-1 text-[10px]">
                {registryWorkflow.status}
              </Badge>
            </Link>
          ) : isLive && !workflow ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500" data-testid="no-linked-spec">
              Workflow inferred from run events.{" "}
              <Link href="/dashboard/workflows" className="text-teal-700 hover:underline">
                Promote a spec →
              </Link>
            </div>
          ) : null}
        </div>
        <div className="mt-5">
          <RunWorkflowGraph graph={runGraph} />
        </div>
      </Card>

      {/* ── Cost and Latency ── */}
      <Card className="p-5">
        <h2 className="text-xl font-semibold text-slate-950">Cost and Latency</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <SummaryItem label="Total Duration" value={formatDuration(deriveRunDurationMs(run))} />
          <SummaryItem label="Total Model Cost" value={formatCurrency(run.total_cost_usd)} />
          <SummaryItem label="Model Events" value={String(modelEvents.length)} />
          <SummaryItem label="Trace Events" value={String(traceEvents.length)} />
          <SummaryItem label="Error Events" value={String(errorEvents.length)} />
          <SummaryItem label="Stages Observed" value={String(runGraph.summary.totalStages - runGraph.summary.notObservedStages)} />
        </dl>
        {registryWorkflow ? (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="text-xs font-medium uppercase text-slate-400">Linked spec</p>
            <Link
              href={`/dashboard/workflows/registry/${registryWorkflow.registryId}`}
              className="mt-1 block text-sm font-medium text-teal-700 hover:underline"
            >
              {registryWorkflow.name}
            </Link>
            <p className="text-xs text-slate-500">{registryWorkflow.spec.nodes.length} nodes · {registryWorkflow.confidence} confidence</p>
          </div>
        ) : null}
      </Card>
    </div>
  );

  const issuesTab = (
    <div className="grid gap-6">
      <div>
        <h2 className="mb-1 text-lg font-semibold text-slate-950">Issues</h2>
        <p className="mb-3 text-xs text-slate-500">
          Errors, recoveries, and failing evals pulled out of the trace — stage, message, severity, and a recommended fix where available.
        </p>
        <IssuesPanel issues={issues} />
      </div>
    </div>
  );

  const artifactsTab = (
    <div className="grid gap-6">
      <div>
        <h2 className="mb-1 text-lg font-semibold text-slate-950">Final Artifacts</h2>
        <p className="mb-3 text-xs text-slate-500">
          Prominent previews of what this run produced — markdown articles get an expandable preview with copy/download actions.
        </p>
        <ArtifactPreviewPanel artifacts={artifactCards} />
      </div>

      <RunSection title="Artifacts">
        <Artifacts events={artifactEvents} fallbackRefs={run.artifact_refs} />
      </RunSection>
    </div>
  );

  const rawTraceTab = (
    <div className="grid gap-8">
      <p className="text-xs text-slate-500">
        The raw event-by-event trace — secondary to the grouped views above. Use the filters to narrow down to a specific kind of event.
      </p>

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

      {approvalEvents.length > 0 && (
        <RunSection title="Approval Gates">
          <ApprovalGates events={approvalEvents} />
        </RunSection>
      )}

      <RunSection title="Errors and Retries">
        <ErrorsAndRetries errors={errorEvents} retries={retryEvents} />
      </RunSection>
    </div>
  );

  const tabs: RunDetailTab[] = [
    { key: "overview", label: "Overview", content: overviewTab },
    { key: "workflow", label: "Workflow", badge: runGraph.summary.totalStages || undefined, content: workflowTab },
    { key: "issues", label: "Issues", badge: issues.length || undefined, content: issuesTab },
    { key: "artifacts", label: "Artifacts", badge: artifactCount || undefined, content: artifactsTab },
    { key: "raw", label: "Raw Trace", badge: traceEvents.length || undefined, content: rawTraceTab },
  ];

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <nav className="flex items-center gap-1.5 text-xs font-medium text-slate-500" aria-label="Breadcrumb">
        <Link href="/dashboard" className="hover:text-teal-700">Overview</Link>
        <span>/</span>
        <Link href="/dashboard/runs" className="hover:text-teal-700">Runs</Link>
        <span>/</span>
        <span className="font-mono text-slate-400">{run.run_id}</span>
      </nav>

      <RunDetailTabs tabs={tabs} />
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
              {(() => { const ms = deriveEventDurationMs(event); return ms ? <Badge tone="neutral">{formatDuration(ms)}</Badge> : null; })()}
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
  const refs = events.map((e) => e.metadata?.["artifact_ref"]).filter((v): v is string => typeof v === "string");
  const artifactRefs = refs.length ? refs : fallbackRefs;

  if (!artifactRefs.length) {
    return <Card className="p-5 text-sm text-slate-600">No artifacts recorded.</Card>;
  }

  return (
    <div className="grid gap-3">
      {artifactRefs.map((ref) => (
        <Card key={ref} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">{ref}</h3>
              {events.find((e) => e.metadata?.["artifact_ref"] === ref)?.output_summary ? (
                <p className="mt-1 text-xs text-slate-500">
                  {events.find((e) => e.metadata?.["artifact_ref"] === ref)?.output_summary}
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              {(() => {
                const artifactType = events.find((e) => e.metadata?.["artifact_ref"] === ref)?.metadata?.["artifact_type"];
                return typeof artifactType === "string" ? <Badge tone="neutral">{artifactType}</Badge> : null;
              })()}
              <Badge tone="info">artifact</Badge>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ApprovalGates({ events }: { events: TraceEvent[] }) {
  return (
    <div className="grid gap-3">
      {events.map((event) => {
        const tone =
          event.event_type === "approval_granted" ? "success"
          : event.event_type === "approval_rejected" ? "danger"
          : "warning";
        const label =
          event.event_type === "approval_granted" ? "Approved"
          : event.event_type === "approval_rejected" ? "Rejected"
          : "Pending";
        return (
          <Card key={event.event_id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">{event.node_id ?? "approval-gate"}</h3>
                <p className="text-xs text-slate-500">{event.event_type}</p>
              </div>
              <Badge tone={tone}>{label}</Badge>
            </div>
            {event.input_summary ? <p className="mt-3 text-sm text-slate-700">Request: {event.input_summary}</p> : null}
            {event.output_summary ? <p className="mt-2 text-sm text-slate-700">Decision: {event.output_summary}</p> : null}
          </Card>
        );
      })}
    </div>
  );
}
