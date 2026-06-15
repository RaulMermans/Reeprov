import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatCurrency, formatDuration, formatDateTime } from "@/components/proof-layer/format";
import { deriveRunDurationMs, deriveRunStatusChip, type RunIssue, type RunStatusChip } from "@/lib/runs/runIntelligence";
import type { EvalResult, RunRecord } from "@/lib/proof-layer/schemas";

const CHIP_LABELS: Record<RunStatusChip["label"], string> = {
  completed: "Completed",
  warning: "Warning",
  failed: "Failed",
  recovered: "Recovered",
  "publish-ready": "Publish-ready",
  running: "Running",
  pending: "Pending",
};

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-800">{value}</dd>
    </div>
  );
}

/**
 * Visual run summary header — the "read in under 30 seconds" entry point.
 * Replaces a wall of raw numbers with a status chip plus the metrics that
 * matter: project, task, duration, calls, evals, issues, and artifacts.
 */
export function RunSummaryHeader({
  run,
  issues,
  evalResults,
  artifactCount,
  badges,
}: {
  run: RunRecord;
  issues: RunIssue[];
  evalResults: EvalResult[];
  artifactCount: number;
  badges?: React.ReactNode;
}) {
  const chip = deriveRunStatusChip(run, issues, artifactCount);
  const durationMs = deriveRunDurationMs(run);
  const errorCount = issues.filter((issue) => issue.source === "trace_event").length;
  const warningEvalCount = evalResults.filter((e) => !e.passed).length;

  return (
    <Card className="p-6" data-testid="run-summary-header">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-teal-700">Runtime proof run</p>
            {badges}
          </div>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">{run.project_name}</h1>
          <p className="mt-1 text-xs font-mono text-slate-400">{run.run_id}</p>
          <p className="mt-2 max-w-3xl text-sm text-slate-600" data-testid="run-task-summary">{run.summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={chip.tone} className="px-3 py-1.5 text-sm" data-testid="run-status-chip">
            {CHIP_LABELS[chip.label]}
          </Badge>
          <Badge tone="info">{run.workflow_id}</Badge>
        </div>
      </div>

      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <MetricItem label="Duration" value={formatDuration(durationMs)} />
        <MetricItem label="Model Calls" value={String(run.model_calls_count)} />
        <MetricItem label="Tool Calls" value={String(run.tool_calls_count)} />
        <MetricItem label="Evals" value={`${run.evals_passed} passed / ${run.evals_failed} failed${warningEvalCount ? ` (${warningEvalCount} flagged)` : ""}`} />
        <MetricItem label="Errors / Warnings" value={String(errorCount)} />
        <MetricItem label="Artifacts" value={String(artifactCount)} />
        <MetricItem label="Total Cost" value={formatCurrency(run.total_cost_usd)} />
        <MetricItem label="Started" value={formatDateTime(run.started_at)} />
      </dl>
    </Card>
  );
}
