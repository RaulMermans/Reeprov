"use client";

import Link from "next/link";
import type { TraceEvent, EvalResult, RunRecord } from "@/lib/proof-layer/schemas";
import type { RunArtifact } from "@/lib/core/contracts/runArtifact";

interface RunSummaryViewProps {
  runRecord: RunRecord;
  traceEvents?: TraceEvent[];
  evalResults?: EvalResult[];
  artifact?: RunArtifact | null;
  onInspectTrace?: () => void;
  onCompare?: () => void;
  onReplay?: () => void;
  onFork?: () => void;
}

export function RunSummaryView({
  runRecord,
  traceEvents = [],
  evalResults = [],
  artifact,
  onInspectTrace,
  onCompare,
  onReplay,
  onFork,
}: RunSummaryViewProps) {
  // Detect first meaningful divergence or failure
  const isFailed = runRecord.status === "failed";
  const isDegraded = runRecord.status === "degraded";

  // Find failing trace event or step
  const failingEvent = traceEvents.find(
    (e) => e.status === "failed" || Boolean((e as unknown as { error?: string }).error)
  );

  // Find failing eval assertion
  const failingEval = evalResults.find((e) => !e.passed);

  // Find state mutation divergence if present
  const checkpoints = artifact?.checkpoints ?? [];
  const hasCheckpoints = checkpoints.length > 0;

  let failureSummary = runRecord.summary;
  let failureLocation = "Run execution";

  if (failingEvent) {
    failureLocation = failingEvent.node_id || (failingEvent.metadata?.["tool_name"] as string | undefined) || failingEvent.event_type;
    failureSummary = (failingEvent as unknown as { error?: string }).error || failingEvent.output_summary || failingEvent.input_summary || runRecord.summary;
  } else if (failingEval) {
    failureLocation = `Eval Assertion: ${failingEval.name}`;
    failureSummary = failingEval.findings?.join("; ") || (failingEval as unknown as { recommendation?: string }).recommendation || "Eval policy tripped";
  }

  return (
    <div className="space-y-6">
      {/* 1. First Meaningful Divergence / Root Cause Banner */}
      {(isFailed || isDegraded) && (
        <div
          className={`rounded-2xl border p-5 shadow-xs ${
            isFailed
              ? "border-red-200 bg-red-50/70 text-red-950"
              : "border-amber-200 bg-amber-50/70 text-amber-950"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-base font-bold shadow-xs">
                {isFailed ? "⚠️" : "⚡"}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold tracking-tight">
                    {isFailed ? "First Meaningful Failure Detected" : "Behavioral Degradation Detected"}
                  </h3>
                  <span className="rounded bg-white/80 px-2 py-0.5 font-mono text-[11px] font-semibold">
                    {failureLocation}
                  </span>
                </div>
                <p className="mt-1.5 text-xs font-medium leading-relaxed opacity-90 max-w-3xl">
                  {failureSummary}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/dashboard/runs/compare?candidateId=${encodeURIComponent(runRecord.run_id)}`}
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold shadow-xs hover:bg-slate-50 transition"
              >
                Compare with Baseline →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* 2. Top Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Status</span>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                runRecord.status === "completed"
                  ? "bg-emerald-500"
                  : runRecord.status === "failed"
                  ? "bg-red-500"
                  : "bg-amber-500"
              }`}
            />
            <span className="text-sm font-bold text-slate-900 capitalize">
              {runRecord.status}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Duration</span>
          <div className="mt-1 text-sm font-bold text-slate-900 font-mono">
            {runRecord.total_duration_ms != null ? `${(runRecord.total_duration_ms / 1000).toFixed(2)}s` : "—"}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Cost</span>
          <div className="mt-1 text-sm font-bold text-slate-900 font-mono">
            {runRecord.total_cost_usd != null ? `$${runRecord.total_cost_usd.toFixed(4)}` : "—"}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Model / Tool Calls</span>
          <div className="mt-1 text-sm font-bold text-slate-900">
            {runRecord.model_calls_count ?? 0} models / {runRecord.tool_calls_count ?? 0} tools
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Eval Assertions</span>
          <div className="mt-1 text-sm font-bold text-slate-900">
            {(runRecord.evals_passed ?? 0)} / {(runRecord.evals_passed ?? 0) + (runRecord.evals_failed ?? 0)} passed
          </div>
        </div>
      </div>

      {/* 3. Contextual Actions Toolbar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-700">Contextual Actions:</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onInspectTrace && (
            <button
              type="button"
              onClick={onInspectTrace}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              🔍 Inspect Full Trace
            </button>
          )}

          <Link
            href={`/dashboard/runs/compare?candidateId=${encodeURIComponent(runRecord.run_id)}`}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            ⚖️ Compare with Baseline
          </Link>

          <Link
            href={`/dashboard/runs/${encodeURIComponent(runRecord.run_id)}#replay`}
            onClick={onReplay}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            🔁 Plan Replay
          </Link>

          {hasCheckpoints ? (
            <Link
              href={`/dashboard/runs/${encodeURIComponent(runRecord.run_id)}#fork`}
              onClick={onFork}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 transition"
            >
              🌿 Fork from Checkpoint
            </Link>
          ) : (
            <button
              type="button"
              disabled
              title="Requires state checkpoints"
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-400 cursor-not-allowed"
            >
              🌿 Fork (No Checkpoints)
            </button>
          )}

          <Link
            href={`/dashboard/experiments?sourceRunId=${encodeURIComponent(runRecord.run_id)}`}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            🧪 Test Without Memory
          </Link>
        </div>
      </div>
    </div>
  );
}
