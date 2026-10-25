"use client";

import type { ReplayResult, ReplayDivergence } from "@/lib/core/replay/contracts";
import { Badge } from "@/components/ui/Badge";

export interface ReplayRuntimeBannerProps {
  result: ReplayResult;
  currentStepIndex?: number;
  currentStepName?: string;
}

export function ReplayRuntimeBanner({
  result,
  currentStepIndex,
  currentStepName,
}: ReplayRuntimeBannerProps) {
  const total = Math.max(1, result.boundaries_expected);
  const substituted = result.boundaries_substituted;
  const percent = Math.min(100, Math.round((substituted / total) * 100));
  const firstDivergence: ReplayDivergence | undefined = result.divergences?.[0];

  const statusTone =
    result.status === "MATCHED"
      ? "success"
      : result.status === "DIVERGED"
        ? "warning"
        : "danger";

  return (
    <div
      className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="replay-runtime-banner"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-slate-500">
            Runtime Replay
          </span>
          <span className="font-mono text-xs font-semibold text-slate-900">
            {result.source_run_id}
          </span>
          <Badge tone={statusTone} className="text-[11px] font-bold">
            {result.status}
          </Badge>
          <Badge tone="neutral" className="text-[10px]">
            {result.mode}
          </Badge>
        </div>
        <div className="text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{substituted}</span> /{" "}
          <span>{result.boundaries_expected}</span> boundaries substituted
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-600">
        Recorded boundaries are substituted. Network blocking covers known Node APIs; untrusted code requires separate process or container isolation.
      </p>
      {result.limitations.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-amber-800" data-testid="replay-limitations">
          {result.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
        </ul>
      )}

      {/* Progress Bar */}
      <div className="mt-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full transition-all duration-300 ${
              result.status === "MATCHED"
                ? "bg-teal-600"
                : result.status === "DIVERGED"
                  ? "bg-amber-500"
                  : "bg-rose-500"
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* Current Step / Substitution Indicator */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-slate-700">
          <span className="font-medium text-slate-500">
            Step {typeof currentStepIndex === "number" ? currentStepIndex + 1 : 1}:
          </span>
          <span className="font-mono text-slate-900">
            {currentStepName ?? result.last_successful_step_id ?? "execution"}
          </span>
          <span className="ml-2 inline-flex items-center gap-1 text-emerald-600 font-medium">
            ✓ recorded result substituted
          </span>
        </div>
        {result.deterministic_match && (
          <span className="text-emerald-700 font-medium">
            Deterministic match confirmed
          </span>
        )}
      </div>

      {/* Divergence alert if present */}
      {firstDivergence && (
        <div
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-900"
          data-testid="replay-divergence-banner"
        >
          <div className="flex items-center gap-1.5 font-semibold">
            <span>First Divergence:</span>
            <Badge tone="warning" className="text-[10px]">
              {firstDivergence.divergence_type}
            </Badge>
          </div>
          <p className="mt-1 font-mono text-[11px] text-amber-800">
            {firstDivergence.message}
          </p>
        </div>
      )}
    </div>
  );
}
