"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatCurrency, formatDuration } from "@/components/proof-layer/format";
import { VisualExecutionCanvas, type ComparisonHighlight } from "@/components/proof-layer/VisualExecutionCanvas";
import type {
  RunComparison,
  ComparisonVerdict,
  CausalStatus,
} from "@/lib/core/contracts/comparison";
import type { RunRecord, TraceEvent } from "@/lib/proof-layer/schemas";
import type { RunGraph } from "@/lib/runs/runGraph";

export interface RunCompareViewProps {
  comparison: RunComparison;
  baselineRun?: RunRecord;
  candidateRun?: RunRecord;
  baselineGraph?: RunGraph;
  candidateGraph?: RunGraph;
  baselineTraceEvents?: TraceEvent[];
  candidateTraceEvents?: TraceEvent[];
}

export function RunCompareView({
  comparison,
  baselineGraph,
  candidateGraph,
  baselineTraceEvents,
  candidateTraceEvents,
}: RunCompareViewProps) {
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [divergenceFilter, setDivergenceFilter] = useState<string>("ALL");
  const [selectedCanvasRun, setSelectedCanvasRun] = useState<"candidate" | "baseline">("candidate");

  const verdictTones: Record<ComparisonVerdict, "success" | "danger" | "warning" | "info" | "neutral"> = {
    IMPROVED: "success",
    REGRESSED: "danger",
    MIXED: "warning",
    NEUTRAL: "neutral",
    INCONCLUSIVE: "info",
  };

  const causalTones: Record<CausalStatus, "neutral" | "warning" | "info" | "success"> = {
    CONTROLLED_MUTATION: "info",
    CAUSALLY_SUPPORTED: "success",
    PLAUSIBLE_CONTRIBUTOR: "warning",
    OBSERVED_DIFFERENCE: "neutral",
  };

  const relationshipLabels: Record<string, string> = {
    PARENT_CHILD: "Parent → Child Fork",
    SIBLING_FORKS: "Sibling Forks",
    REPLAY_SOURCE: "Replay vs Source",
    SAME_EXPERIMENT: "Same Experiment",
    INDEPENDENT: "Independent Runs",
    UNKNOWN: "Unknown Relationship",
  };

  // Build canvas comparison highlights
  const comparisonHighlights: Record<string, ComparisonHighlight> = {};
  for (const step of comparison.execution_alignment.aligned_steps) {
    const isFirstDivergence =
      comparison.first_meaningful_divergence?.step_id === step.candidate_step_id ||
      comparison.first_meaningful_divergence?.step_id === step.baseline_step_id ||
      comparison.first_structural_divergence?.step_id === step.candidate_step_id ||
      comparison.first_structural_divergence?.step_id === step.baseline_step_id;

    const highlightStatus = isFirstDivergence
      ? "FIRST_DIVERGENCE"
      : step.alignment_status === "MATCHED"
      ? "SAME"
      : step.alignment_status === "MODIFIED"
      ? "MODIFIED"
      : step.alignment_status === "BASELINE_ONLY"
      ? "BASELINE_ONLY"
      : "CANDIDATE_ONLY";

    const highlight: ComparisonHighlight = {
      status: highlightStatus,
      label: isFirstDivergence ? "First Divergence" : step.alignment_status,
      divergenceId: isFirstDivergence ? comparison.first_meaningful_divergence?.divergence_id : undefined,
    };

    if (step.candidate_step_id) comparisonHighlights[step.candidate_step_id] = highlight;
    if (step.baseline_step_id) comparisonHighlights[step.baseline_step_id] = highlight;
    if (step.name) comparisonHighlights[step.name] = highlight;
  }

  // Filter divergences
  const filteredDivergences = comparison.divergences.filter((d) => {
    if (divergenceFilter === "ALL") return true;
    const causal = d.causal_status ?? "OBSERVED_DIFFERENCE";
    return d.dimension === divergenceFilter || causal === divergenceFilter;
  });

  const configChangesCount = comparison.configuration_diff.summary?.length ?? 0;
  const stateChangesCount = (comparison.state_diffs ?? []).reduce(
    (acc, sd) => acc + (sd.changes?.length ?? 0),
    0
  );
  const contextChangesCount = comparison.context_diff?.changes?.length ?? 0;
  const memoryChangesCount = comparison.memory_diff?.changes?.length ?? 0;
  const retrievalChangesCount = comparison.retrieval_diff?.changes?.length ?? 0;
  const testChangesCount = comparison.evidence_diff.test_diffs?.length ?? 0;
  const reviewChangesCount = comparison.evidence_diff.review_diffs?.length ?? 0;
  const securityEventsCount = comparison.evidence_diff.security_diffs?.length ?? 0;
  const toolDivergences = comparison.divergences.filter((d) => d.dimension.startsWith("TOOL"));
  const modelDivergences = comparison.divergences.filter((d) => d.dimension.startsWith("MODEL"));

  const metricDeltas = Object.values(comparison.metrics_diff.deltas ?? {});

  const firstMeaningfulCausalStatus: CausalStatus =
    comparison.first_meaningful_divergence?.causal_status ?? "OBSERVED_DIFFERENCE";
  const firstMeaningfulEvidenceRefs =
    comparison.first_meaningful_divergence?.evidence_refs ?? [];

  return (
    <div className="space-y-6" data-testid="run-compare-view">
      {/* Header bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-teal-700">Semantic Run Diff</span>
              <Badge tone="info" className="text-xs">
                {relationshipLabels[comparison.relationship] ?? comparison.relationship}
              </Badge>
              <Badge tone={verdictTones[comparison.verdict]} className="text-xs font-bold uppercase tracking-wide">
                Verdict: {comparison.verdict}
              </Badge>
            </div>
            <h1 className="mt-2 text-xl font-bold text-slate-900">
              Run Comparison: <span className="font-mono text-teal-700">{comparison.baseline_run_id.slice(0, 8)}</span>{" "}
              vs <span className="font-mono text-indigo-700">{comparison.candidate_run_id.slice(0, 8)}</span>
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              Comparison ID: <span className="font-mono">{comparison.comparison_id}</span> · Schema v
              {comparison.schema_version} · Created at {new Date(comparison.created_at).toLocaleString()}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/runs/${encodeURIComponent(comparison.baseline_run_id)}`}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Inspect Baseline ({comparison.baseline_run_id.slice(0, 8)})
            </Link>
            <Link
              href={`/dashboard/runs/${encodeURIComponent(comparison.candidate_run_id)}`}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Inspect Candidate ({comparison.candidate_run_id.slice(0, 8)})
            </Link>
          </div>
        </div>

        {/* Summary Metric Ribbon */}
        <div className="mt-6 grid grid-cols-2 gap-4 rounded-lg border border-slate-100 bg-slate-50 p-4 sm:grid-cols-3 md:grid-cols-6">
          <div>
            <p className="text-[11px] font-medium text-slate-500">Configuration</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900">
              {configChangesCount === 0 ? "Identical" : `${configChangesCount} change${configChangesCount > 1 ? "s" : ""}`}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-500">Outcome</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900">
              {!comparison.outcome_diff.status_changed ? (
                <span className="text-emerald-700">Same ({comparison.outcome_diff.candidate_status})</span>
              ) : (
                <span className="text-amber-700">
                  {comparison.outcome_diff.baseline_status} → {comparison.outcome_diff.candidate_status}
                </span>
              )}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-500">Tests Delta</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900">
              {comparison.evidence_diff.test_diffs.length === 0
                ? "No changes"
                : `${comparison.evidence_diff.test_diffs.filter((t) => t.change_type === "TEST_STATUS_CHANGED" && t.after_status === "PASSED").length} passed`}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-500">Cost Delta</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900">
              {comparison.metrics_diff.cost_delta_usd >= 0 ? "+" : ""}
              {formatCurrency(comparison.metrics_diff.cost_delta_usd)}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-500">Latency Delta</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900">
              {comparison.metrics_diff.latency_delta_ms >= 0 ? "+" : ""}
              {formatDuration(comparison.metrics_diff.latency_delta_ms)}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-500">Divergences</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900">
              {comparison.divergences.length} observed
            </p>
          </div>
        </div>
      </div>

      {/* First Meaningful Divergence Banner */}
      {comparison.first_meaningful_divergence ? (
        <Card
          className="border-rose-200 bg-rose-50/40 p-5 shadow-sm"
          data-testid="first-meaningful-divergence-card"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-rose-900">
                First Meaningful Divergence
              </h2>
              <Badge tone="danger" className="text-[11px] font-semibold">
                {comparison.first_meaningful_divergence.dimension}
              </Badge>
              <Badge
                tone={causalTones[firstMeaningfulCausalStatus]}
                className="text-[11px] font-semibold"
              >
                {firstMeaningfulCausalStatus.replace("_", " ")}
              </Badge>
            </div>
            {comparison.first_meaningful_divergence.step_id && (
              <span className="font-mono text-xs text-rose-700">
                Step: {comparison.first_meaningful_divergence.step_id}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-slate-800">
            {comparison.first_meaningful_divergence.description}
          </p>
          {firstMeaningfulEvidenceRefs.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="text-xs font-medium text-slate-500">Evidence references:</span>
              {firstMeaningfulEvidenceRefs.map((ref) => (
                <span
                  key={ref}
                  className="rounded bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200"
                >
                  {ref}
                </span>
              ))}
            </div>
          )}
        </Card>
      ) : (
        <Card className="border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <p className="text-sm font-medium text-emerald-900">
              No behavioral divergences detected between these executions.
            </p>
          </div>
        </Card>
      )}

      {/* Tabs navigation */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex flex-wrap gap-2" aria-label="Comparison tabs">
          {[
            { id: "overview", label: "Overview & Lineage", count: undefined },
            { id: "configuration", label: "Configuration", count: configChangesCount },
            { id: "execution", label: "Execution Alignment", count: comparison.execution_alignment.aligned_steps.length },
            { id: "tools", label: "Tools & Boundaries", count: toolDivergences.length + modelDivergences.length },
            { id: "context", label: "Context & Memory", count: contextChangesCount + memoryChangesCount + retrievalChangesCount },
            { id: "state", label: "State Diff", count: stateChangesCount },
            { id: "evidence", label: "Evidence & Tests", count: testChangesCount + reviewChangesCount + securityEventsCount },
            { id: "metrics", label: "Metrics", count: metricDeltas.length },
            { id: "canvas", label: "Visual Execution Canvas", count: undefined },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition ${
                activeTab === tab.id
                  ? "border-teal-600 text-teal-800"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
              data-testid={`tab-${tab.id}`}
            >
              {tab.label}
              {typeof tab.count === "number" && tab.count > 0 && (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.2 text-[10px] text-slate-600">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Panels */}
      {/* 1. Overview */}
      {activeTab === "overview" && (
        <div className="space-y-6" data-testid="tab-panel-overview">
          {/* Alignment Summary */}
          <Card className="p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Alignment Summary
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-7 text-xs">
              <div className="rounded bg-slate-50 p-2 text-center">
                <span className="text-slate-500">Baseline Steps</span>
                <p className="mt-1 font-bold text-slate-900">{comparison.execution_alignment.alignment_summary.total_baseline_steps}</p>
              </div>
              <div className="rounded bg-slate-50 p-2 text-center">
                <span className="text-slate-500">Candidate Steps</span>
                <p className="mt-1 font-bold text-slate-900">{comparison.execution_alignment.alignment_summary.total_candidate_steps}</p>
              </div>
              <div className="rounded bg-emerald-50 p-2 text-center text-emerald-800">
                <span>Matched</span>
                <p className="mt-1 font-bold">{comparison.execution_alignment.alignment_summary.matched_count}</p>
              </div>
              <div className="rounded bg-amber-50 p-2 text-center text-amber-800">
                <span>Modified</span>
                <p className="mt-1 font-bold">{comparison.execution_alignment.alignment_summary.modified_count}</p>
              </div>
              <div className="rounded bg-cyan-50 p-2 text-center text-cyan-800">
                <span>Baseline Only</span>
                <p className="mt-1 font-bold">{comparison.execution_alignment.alignment_summary.baseline_only_count}</p>
              </div>
              <div className="rounded bg-indigo-50 p-2 text-center text-indigo-800">
                <span>Candidate Only</span>
                <p className="mt-1 font-bold">{comparison.execution_alignment.alignment_summary.candidate_only_count}</p>
              </div>
              <div className="rounded bg-rose-50 p-2 text-center text-rose-800">
                <span>Ambiguous</span>
                <p className="mt-1 font-bold">{comparison.execution_alignment.alignment_summary.ambiguous_count}</p>
              </div>
            </div>
          </Card>

          {/* Divergences list */}
          <Card className="p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
                All Observed Divergences ({comparison.divergences.length})
              </h3>
              <div className="flex items-center gap-2">
                <label htmlFor="filter-divergence" className="text-xs text-slate-500">
                  Filter:
                </label>
                <select
                  id="filter-divergence"
                  value={divergenceFilter}
                  onChange={(e) => setDivergenceFilter(e.target.value)}
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                >
                  <option value="ALL">All ({comparison.divergences.length})</option>
                  <option value="TOOL">Tool</option>
                  <option value="STATE">State</option>
                  <option value="PROMPT">Prompt</option>
                  <option value="MODEL">Model</option>
                  <option value="CONTEXT">Context</option>
                  <option value="TEST">Test</option>
                  <option value="OUTCOME">Outcome</option>
                  <option value="CONTROLLED_MUTATION">Controlled Mutations</option>
                  <option value="CAUSALLY_SUPPORTED">Causally Supported</option>
                </select>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {filteredDivergences.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-400">No divergences match filter.</p>
              ) : (
                filteredDivergences.map((div) => {
                  const causal = div.causal_status ?? "OBSERVED_DIFFERENCE";
                  const confidence = div.confidence ?? 1.0;
                  const refs = div.evidence_refs ?? [];
                  return (
                    <div
                      key={div.divergence_id}
                      className="rounded-lg border border-slate-200 bg-white p-4 text-xs shadow-xs"
                      data-testid={`divergence-item-${div.divergence_id}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge tone="neutral" className="font-semibold text-[10px]">
                            {div.dimension}
                          </Badge>
                          <Badge tone={causalTones[causal]} className="font-semibold text-[10px]">
                            {causal.replace("_", " ")}
                          </Badge>
                          {div.step_id && <span className="font-mono text-slate-500">Step: {div.step_id}</span>}
                        </div>
                        <span className="text-[10px] text-slate-400">Confidence: {confidence.toFixed(2)}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-800">{div.description}</p>
                      {refs.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {refs.map((ref) => (
                            <span
                              key={ref}
                              className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
                            >
                              {ref}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      )}

      {/* 2. Configuration */}
      {activeTab === "configuration" && (
        <Card className="p-5 shadow-sm" data-testid="tab-panel-configuration">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">Configuration Diff</h3>
          {configChangesCount === 0 ? (
            <p className="mt-3 text-xs text-slate-500">Configuration between executions is identical.</p>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="space-y-1">
                {comparison.configuration_diff.summary?.map((sum, i) => (
                  <p key={i} className="text-xs text-slate-700 font-medium">
                    • {sum}
                  </p>
                ))}
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <th className="p-2.5 font-semibold">Key</th>
                      <th className="p-2.5 font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.entries(comparison.configuration_diff.differences ?? {}).map(([key, val], i) => (
                      <tr key={i} className="hover:bg-slate-50/50">
                        <td className="p-2.5 font-mono font-semibold text-slate-800">{key}</td>
                        <td className="p-2.5 font-mono text-slate-600">{JSON.stringify(val)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* 3. Execution Alignment */}
      {activeTab === "execution" && (
        <div className="space-y-6" data-testid="tab-panel-execution">
          <Card className="p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Aligned Execution Steps ({comparison.execution_alignment.aligned_steps.length})
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Aligned via stable IDs, lineage markers, or sequence heuristics.
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="p-2.5 font-semibold">Status</th>
                    <th className="p-2.5 font-semibold">Step Name</th>
                    <th className="p-2.5 font-semibold">Baseline Step ID</th>
                    <th className="p-2.5 font-semibold">Candidate Step ID</th>
                    <th className="p-2.5 font-semibold">Confidence</th>
                    <th className="p-2.5 font-semibold">Basis</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {comparison.execution_alignment.aligned_steps.map((st, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="p-2.5">
                        <Badge
                          tone={
                            st.alignment_status === "MATCHED"
                              ? "success"
                              : st.alignment_status === "MODIFIED"
                              ? "warning"
                              : st.alignment_status === "BASELINE_ONLY"
                              ? "info"
                              : st.alignment_status === "CANDIDATE_ONLY"
                              ? "neutral"
                              : "danger"
                          }
                          className="text-[10px]"
                        >
                          {st.alignment_status}
                        </Badge>
                      </td>
                      <td className="p-2.5 font-semibold text-slate-800">{st.name}</td>
                      <td className="p-2.5 font-mono text-slate-600">{st.baseline_step_id ?? "—"}</td>
                      <td className="p-2.5 font-mono text-indigo-700">{st.candidate_step_id ?? "—"}</td>
                      <td className="p-2.5">{st.alignment_confidence?.toFixed(2) ?? "1.00"}</td>
                      <td className="p-2.5 text-slate-500">{st.alignment_basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Aligned Boundaries */}
          <Card className="p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Boundary Alignment ({comparison.execution_alignment.aligned_boundaries.length})
            </h3>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="p-2.5 font-semibold">Status</th>
                    <th className="p-2.5 font-semibold">Type</th>
                    <th className="p-2.5 font-semibold">Identifier</th>
                    <th className="p-2.5 font-semibold">Change Type</th>
                    <th className="p-2.5 font-semibold">Differences</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {comparison.execution_alignment.aligned_boundaries.map((b, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="p-2.5">
                        <Badge tone={b.alignment_status === "MATCHED" ? "success" : "warning"} className="text-[10px]">
                          {b.alignment_status}
                        </Badge>
                      </td>
                      <td className="p-2.5 font-mono text-slate-700">{b.boundary_type}</td>
                      <td className="p-2.5 font-semibold text-slate-900">{b.name}</td>
                      <td className="p-2.5">{b.change_type}</td>
                      <td className="p-2.5 text-slate-500">{b.differences.join(", ") || "None"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* 4. Tools & Boundaries */}
      {activeTab === "tools" && (
        <div className="space-y-6" data-testid="tab-panel-tools">
          <Card className="p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Tool Divergences ({toolDivergences.length})
            </h3>
            {toolDivergences.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">No tool call divergences observed.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {toolDivergences.map((t, i) => {
                  const causal = t.causal_status ?? "OBSERVED_DIFFERENCE";
                  const refs = t.evidence_refs ?? [];
                  return (
                    <div key={i} className="rounded border border-slate-200 p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">{t.description}</span>
                        <Badge tone={causalTones[causal]} className="text-[10px]">
                          {causal}
                        </Badge>
                      </div>
                      {refs.length > 0 && (
                        <p className="mt-1 text-slate-500 font-mono">
                          Refs: {refs.join(", ")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Model Divergences ({modelDivergences.length})
            </h3>
            {modelDivergences.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">No model call divergences observed.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {modelDivergences.map((m, i) => {
                  const causal = m.causal_status ?? "OBSERVED_DIFFERENCE";
                  return (
                    <div key={i} className="rounded border border-slate-200 p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">{m.description}</span>
                        <Badge tone={causalTones[causal]} className="text-[10px]">
                          {causal}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* 5. Context & Memory */}
      {activeTab === "context" && (
        <div className="space-y-6" data-testid="tab-panel-context">
          <Card className="p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Context Diff ({contextChangesCount})
            </h3>
            {contextChangesCount === 0 ? (
              <p className="mt-3 text-xs text-slate-500">No context snapshot differences observed.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {comparison.context_diff?.changes.map((c, i) => (
                  <div key={i} className="rounded border border-slate-200 p-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-slate-800">{c.item_id}</span>
                      <Badge tone="info" className="text-[10px]">
                        {c.change_type}
                      </Badge>
                    </div>
                    <p className="mt-1 text-slate-600">
                      Token Delta: {c.token_delta >= 0 ? `+${c.token_delta}` : c.token_delta}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Memory Diff ({memoryChangesCount})
            </h3>
            {memoryChangesCount === 0 ? (
              <p className="mt-3 text-xs text-slate-500">No memory operation differences observed.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {comparison.memory_diff?.changes.map((m, i) => (
                  <div key={i} className="rounded border border-slate-200 p-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">{m.memory_id ?? "unknown"}</span>
                      <Badge tone="warning" className="text-[10px]">
                        {m.change_type}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* 6. State Diff */}
      {activeTab === "state" && (
        <Card className="p-5 shadow-sm" data-testid="tab-panel-state">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
            Structured State Differences (JSON Pointer) ({stateChangesCount})
          </h3>
          {stateChangesCount === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No structured state differences observed.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="p-2.5 font-semibold">JSON Pointer Path</th>
                    <th className="p-2.5 font-semibold">Operation</th>
                    <th className="p-2.5 font-semibold">Baseline</th>
                    <th className="p-2.5 font-semibold">Candidate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {comparison.state_diffs.flatMap((sd) => sd.changes).map((sc, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="p-2.5 font-mono font-semibold text-slate-800">{sc.path}</td>
                      <td className="p-2.5">
                        <Badge tone="warning" className="text-[10px]">
                          {sc.operation}
                        </Badge>
                      </td>
                      <td className="p-2.5 font-mono text-slate-600">{JSON.stringify(sc.before)}</td>
                      <td className="p-2.5 font-mono text-indigo-700">{JSON.stringify(sc.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* 7. Evidence & Tests */}
      {activeTab === "evidence" && (
        <div className="space-y-6" data-testid="tab-panel-evidence">
          {/* Test differences */}
          <Card className="p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Test Diffs ({comparison.evidence_diff.test_diffs.length})
            </h3>
            {comparison.evidence_diff.test_diffs.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">No test result differences.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {comparison.evidence_diff.test_diffs.map((td, i) => (
                  <div key={i} className="rounded border border-slate-200 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{td.name}</span>
                      <Badge
                        tone={td.after_status === "PASSED" ? "success" : "danger"}
                        className="text-[10px]"
                      >
                        {td.change_type}
                      </Badge>
                    </div>
                    <div className="mt-1 text-slate-600">
                      Baseline: {td.before_status ?? "none"} → Candidate: {td.after_status ?? "none"}
                    </div>
                    {td.failure_message_after && (
                      <p className="mt-1 text-rose-700">Failure: {td.failure_message_after}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Review differences */}
          <Card className="p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Review Diffs ({comparison.evidence_diff.review_diffs.length})
            </h3>
            {comparison.evidence_diff.review_diffs.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">No review status differences.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {comparison.evidence_diff.review_diffs.map((rd, i) => (
                  <div key={i} className="rounded border border-slate-200 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{rd.reviewer}</span>
                      <Badge tone="info" className="text-[10px]">
                        {rd.before_status ?? "none"} → {rd.after_status ?? "none"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-slate-600">Findings delta: {rd.findings_delta}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Security & Permissions */}
          <Card className="p-5 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Security & Permissions ({comparison.evidence_diff.security_diffs.length})
            </h3>
            {comparison.evidence_diff.security_diffs.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">No security decision differences.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {comparison.evidence_diff.security_diffs.map((sd, i) => (
                  <div key={i} className="rounded border border-slate-200 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{sd.action_id ?? sd.tool_id ?? "Security Action"}</span>
                      <Badge
                        tone={sd.after_decision === "DENY" ? "danger" : "warning"}
                        className="text-[10px]"
                      >
                        {sd.change_type}
                      </Badge>
                    </div>
                    <p className="mt-1 text-slate-600">
                      Decision: {sd.before_decision ?? "none"} → {sd.after_decision ?? "none"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* 8. Metrics */}
      {activeTab === "metrics" && (
        <Card className="p-5 shadow-sm" data-testid="tab-panel-metrics">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">Directional Metrics Diff</h3>
          <p className="mt-1 text-xs text-slate-500">
            Deltas are normalized by direction (lower vs higher is better) with zero-division safety.
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="p-2.5 font-semibold">Metric</th>
                  <th className="p-2.5 font-semibold">Baseline</th>
                  <th className="p-2.5 font-semibold">Candidate</th>
                  <th className="p-2.5 font-semibold">Absolute Delta</th>
                  <th className="p-2.5 font-semibold">Relative %</th>
                  <th className="p-2.5 font-semibold">Normalized Direction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {metricDeltas.map((me, i) => (
                  <tr key={i} className="hover:bg-slate-50/50">
                    <td className="p-2.5 font-semibold text-slate-900">{me.key}</td>
                    <td className="p-2.5 font-mono">{me.baseline}</td>
                    <td className="p-2.5 font-mono text-indigo-700">{me.candidate}</td>
                    <td className="p-2.5 font-mono">{me.absolute_delta >= 0 ? `+${me.absolute_delta}` : me.absolute_delta}</td>
                    <td className="p-2.5 font-mono">{me.percent_delta !== null && me.percent_delta !== undefined ? `${me.percent_delta.toFixed(1)}%` : "0%"}</td>
                    <td className="p-2.5">
                      <Badge
                        tone={
                          me.evaluation === "IMPROVED"
                            ? "success"
                            : me.evaluation === "REGRESSED"
                            ? "danger"
                            : "neutral"
                        }
                        className="text-[10px]"
                      >
                        {me.evaluation}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* 9. Visual Canvas */}
      {activeTab === "canvas" && (
        <Card className="p-5 shadow-sm" data-testid="tab-panel-canvas">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
                Visual Execution Canvas
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Nodes are highlighted with comparison statuses: Same, Modified, or First Divergence.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={selectedCanvasRun === "candidate" ? "primary" : "secondary"}
                onClick={() => setSelectedCanvasRun("candidate")}
                className="text-xs"
              >
                Candidate Run ({comparison.candidate_run_id.slice(0, 8)})
              </Button>
              <Button
                variant={selectedCanvasRun === "baseline" ? "primary" : "secondary"}
                onClick={() => setSelectedCanvasRun("baseline")}
                className="text-xs"
              >
                Baseline Run ({comparison.baseline_run_id.slice(0, 8)})
              </Button>
            </div>
          </div>

          <div className="mt-4">
            {selectedCanvasRun === "candidate" ? (
              candidateGraph ? (
                <VisualExecutionCanvas
                  runGraph={candidateGraph}
                  traceEvents={candidateTraceEvents ?? []}
                  comparisonHighlights={comparisonHighlights}
                />
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 py-12 text-center text-xs text-slate-400">
                  Candidate execution graph is being loaded or is empty.
                </div>
              )
            ) : baselineGraph ? (
              <VisualExecutionCanvas
                runGraph={baselineGraph}
                traceEvents={baselineTraceEvents ?? []}
                comparisonHighlights={comparisonHighlights}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 py-12 text-center text-xs text-slate-400">
                Baseline execution graph is being loaded or is empty.
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
