"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import type {
  ContextIntelligenceReport,
  ContextSnapshotAnalysis,
  ContextAblationCandidate,
  ContextDiagnosticSignal,
  ContextChurnTransition,
} from "@/lib/core/contracts/contextIntelligence";

export function ContextIntelligenceStudio({ runId }: { runId: string }) {
  const [report, setReport] = useState<ContextIntelligenceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);

  // Ablation execution state
  const [ablatingId, setAblatingId] = useState<string | null>(null);
  const [ablationSuccess, setAblationSuccess] = useState<{
    candidateId: string;
    forkId: string;
    comparisonUrl?: string;
  } | null>(null);
  const [ablationError, setAblationError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchReport() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          `/api/runs/${encodeURIComponent(runId)}/context-intelligence`,
          { headers: mergeAuthHeaders() }
        );
        if (!res.ok) {
          throw new Error(`Failed to load context intelligence (${res.status})`);
        }
        const data: ContextIntelligenceReport = await res.json();
        setReport(data);
        if (data.snapshots.length > 0) {
          setSelectedSnapshotId(data.snapshots[0].snapshot_id);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error loading context intelligence";
        setError(msg);
      } finally {
        setLoading(false);
      }
    }

    fetchReport();
  }, [runId]);

  async function handleAblateContextItem(candidate: ContextAblationCandidate) {
    try {
      setAblatingId(candidate.candidate_id);
      setAblationError(null);
      setAblationSuccess(null);

      // Fetch first checkpoint for run to fork from
      const chkRes = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/checkpoints`,
        { headers: mergeAuthHeaders() }
      );
      if (!chkRes.ok) {
        throw new Error("Unable to retrieve checkpoints for ablation fork");
      }
      const chkData = await chkRes.json();
      const firstCheckpoint = chkData.checkpoints?.[0];
      if (!firstCheckpoint) {
        throw new Error("No checkpoint available to anchor ablation fork");
      }

      const forkRes = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/fork`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...mergeAuthHeaders(),
          },
          body: JSON.stringify({
            checkpoint_id: firstCheckpoint.checkpoint_id,
            mutations: [
              {
                mutation_id: `mut_ablate_${candidate.candidate_id}`,
                mutation_type: "context_exclusion",
                target_identifier: candidate.suggested_mutation.target_identifier,
                description: candidate.suggested_mutation.description,
                parameters: { candidate_id: candidate.candidate_id },
                created_at: new Date().toISOString(),
              },
            ],
            execution_mode: "SAFE_OFFLINE_FORK",
          }),
        }
      );

      const forkData = await forkRes.json();
      if (!forkRes.ok) {
        throw new Error(
          forkData.errors?.join(", ") ||
            forkData.message ||
            "Context ablation fork failed"
        );
      }

      setAblationSuccess({
        candidateId: candidate.candidate_id,
        forkId: forkData.fork_id,
        comparisonUrl: `/dashboard/runs/${encodeURIComponent(
          runId
        )}?compare=${encodeURIComponent(forkData.fork_id)}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to execute context ablation";
      setAblationError(msg);
    } finally {
      setAblatingId(null);
    }
  }

  if (loading) {
    return (
      <Card className="p-8 text-center text-slate-500">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
        <p className="mt-2 text-sm">Analyzing decision-scoped context evidence...</p>
      </Card>
    );
  }

  if (error || !report) {
    return (
      <Card className="border-red-200 bg-red-50 p-6 text-red-900">
        <h3 className="text-sm font-semibold">Context Intelligence Unavailable</h3>
        <p className="mt-1 text-xs">{error || "No context intelligence report generated."}</p>
      </Card>
    );
  }

  const selectedSnapshot: ContextSnapshotAnalysis | undefined =
    report.snapshots.find((s) => s.snapshot_id === selectedSnapshotId) ??
    report.snapshots[0];

  return (
    <div className="space-y-6">
      {/* 1. Header & Run-Level Intelligence Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Total Decisions</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {report.run_summary.total_decisions}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {report.run_summary.total_context_tokens.toLocaleString()} total tokens consumed
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Exact Repeated Tokens</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {report.run_summary.exact_repeated_tokens.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {report.run_summary.exact_duplicates_count} exact duplicate occurrences
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Retrieval Admission</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {(report.run_summary.retrieved_docs_admission_rate * 100).toFixed(0)}%
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {report.run_summary.retrieved_docs_admitted_count} of {report.run_summary.retrieved_docs_total_count} candidates admitted
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Provenance Coverage</p>
          <p className="mt-1 text-2xl font-bold text-teal-700">
            {(report.run_summary.provenance_coverage_ratio * 100).toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {report.run_summary.provenance_gaps_count} gaps | {report.signals.length} signals
          </p>
        </Card>
      </div>

      {/* 2. Decision Selector */}
      {report.snapshots.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Decision-Scoped Context</h3>
              <p className="text-xs text-slate-500">
                Inspect what was in the model context at each individual decision point.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="snapshot-select" className="text-xs font-medium text-slate-600">
                Decision:
              </label>
              <select
                id="snapshot-select"
                value={selectedSnapshot?.snapshot_id ?? ""}
                onChange={(e) => setSelectedSnapshotId(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-teal-500 focus:outline-none"
              >
                {report.snapshots.map((s, idx) => (
                  <option key={s.snapshot_id} value={s.snapshot_id}>
                    Decision {idx + 1} (Step: {s.step_id || "initial"}) — {s.composition.total_tokens.toLocaleString()} tokens
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Card>
      )}

      {selectedSnapshot && (
        <>
          {/* 3. Decision Composition Breakdown */}
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <h4 className="text-base font-semibold text-slate-900">
                  Context Composition — {selectedSnapshot.snapshot_id}
                </h4>
                <p className="mt-1 text-xs text-slate-500">
                  Step: <span className="font-mono">{selectedSnapshot.step_id ?? "initial"}</span> | Model Invocation:{" "}
                  <span className="font-mono">{selectedSnapshot.model_invocation_id ?? "n/a"}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="info">
                  {selectedSnapshot.composition.total_tokens.toLocaleString()} Total Tokens
                </Badge>
                <Badge
                  tone={
                    selectedSnapshot.measurement_quality.exact_measured_percentage >= 50
                      ? "success"
                      : "warning"
                  }
                >
                  {selectedSnapshot.measurement_quality.exact_measured_percentage.toFixed(0)}% Exact Measured
                </Badge>
              </div>
            </div>

            {/* Measurement Quality Breakdown */}
            <div className="mt-4 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-700">Token Measurement Provenance:</span>
                <span className="font-mono">
                  {selectedSnapshot.measurement_quality.provider_reported_tokens.toLocaleString()} provider-reported,{" "}
                  {selectedSnapshot.measurement_quality.tokenizer_counted_tokens.toLocaleString()} tokenizer-counted,{" "}
                  {selectedSnapshot.measurement_quality.estimated_tokens.toLocaleString()} estimated
                </span>
              </div>
            </div>

            {/* Source Types Table */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="pb-2 font-medium">Source Type</th>
                    <th className="pb-2 font-medium text-right">Tokens</th>
                    <th className="pb-2 font-medium text-right">Context Share</th>
                    <th className="pb-2 font-medium text-right">Items</th>
                    <th className="pb-2 font-medium">Availability</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {selectedSnapshot.composition.by_source_type.map((share) => (
                    <tr key={share.source_type} className="hover:bg-slate-50">
                      <td className="py-2.5 font-medium text-slate-900">
                        <span className="capitalize">{share.source_type.replace(/_/g, " ")}</span>
                        {share.source_type === "generated_intermediate_context" && (
                          <span className="ml-1.5 text-[10px] text-slate-400">
                            (observable scratch/plan artifact, not private CoT)
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-right font-mono font-medium">
                        {share.tokens.toLocaleString()}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        {share.percentage.toFixed(1)}%
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        {share.item_count}
                      </td>
                      <td className="py-2.5">
                        <Badge tone="neutral">Captured</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Content Availability & Sensitivity Class */}
            <div className="mt-4 grid gap-4 pt-4 border-t border-slate-100 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Availability Status</p>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  <span className="rounded bg-teal-50 px-2 py-1 font-mono text-teal-800">
                    Captured: {selectedSnapshot.composition.captured_tokens.toLocaleString()} tokens
                  </span>
                  {selectedSnapshot.composition.hash_only_tokens > 0 && (
                    <span className="rounded bg-amber-50 px-2 py-1 font-mono text-amber-800">
                      Hash-Only: {selectedSnapshot.composition.hash_only_tokens.toLocaleString()} tokens
                    </span>
                  )}
                  {selectedSnapshot.composition.unavailable_tokens > 0 && (
                    <span className="rounded bg-red-50 px-2 py-1 font-mono text-red-800">
                      Unavailable: {selectedSnapshot.composition.unavailable_tokens.toLocaleString()} tokens
                    </span>
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Provenance Completeness</p>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  <Badge tone="success">
                    Complete: {selectedSnapshot.provenance_coverage.complete_count} items
                  </Badge>
                  {selectedSnapshot.provenance_coverage.partial_count > 0 && (
                    <Badge tone="info">
                      Partial: {selectedSnapshot.provenance_coverage.partial_count} items
                    </Badge>
                  )}
                  {selectedSnapshot.provenance_coverage.unknown_count > 0 && (
                    <Badge tone="warning">
                      Unknown Source: {selectedSnapshot.provenance_coverage.unknown_count} items
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* 4. Tool Exposure Intelligence */}
          {selectedSnapshot.tool_exposure && (
            <Card className="p-6">
              <h4 className="text-base font-semibold text-slate-900">Tool Exposure Cost</h4>
              <p className="mt-1 text-xs text-slate-500">
                Tool definitions consume model context tokens regardless of whether they are invoked.
              </p>

              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-500">Exposed Tools</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">
                    {selectedSnapshot.tool_exposure.tools_exposed_count}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {selectedSnapshot.tool_exposure.tools_used_count} invoked downstream
                  </p>
                </div>

                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-500">Tool Definition Tokens</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">
                    {selectedSnapshot.tool_exposure.tool_definition_tokens.toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {selectedSnapshot.tool_exposure.tool_token_share_percentage.toFixed(1)}% of decision context
                  </p>
                </div>

                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-500">Unused Exposed Tools</p>
                  <p className="mt-1 text-xl font-bold text-amber-700">
                    {selectedSnapshot.tool_exposure.unused_exposed_tools.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Candidate signal for exposure tuning</p>
                </div>
              </div>

              {selectedSnapshot.tool_exposure.unused_exposed_tools.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="text-xs font-medium text-slate-500 self-center mr-1">Unused tools:</span>
                  {selectedSnapshot.tool_exposure.unused_exposed_tools.map((t: string) => (
                    <span key={t} className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* 5. Retrieval Admissions */}
          {report.retrieval_admissions.length > 0 && (
            <Card className="p-6">
              <h4 className="text-base font-semibold text-slate-900">Retrieval → Context Admission</h4>
              <p className="mt-1 text-xs text-slate-500">
                Track which retrieved items entered model context vs discarded before prompting.
              </p>

              <div className="mt-4 space-y-3">
                {report.retrieval_admissions.map((adm, idx) => (
                  <div key={idx} className="rounded-lg border border-slate-100 p-3 bg-slate-50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-mono text-xs font-semibold text-slate-900">
                          Query: "{adm.query}"
                        </span>
                        {adm.service_name && (
                          <span className="ml-2 text-[11px] text-slate-500 font-mono">({adm.service_name})</span>
                        )}
                      </div>
                      <Badge tone={adm.admission_rate > 0.5 ? "success" : "neutral"}>
                        Admission Rate: {(adm.admission_rate * 100).toFixed(0)}%
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {adm.injected_count} admitted into context out of {adm.candidates_count} candidates
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* 6. Context Churn Transitions */}
      {report.churn_transitions.length > 0 && (
        <Card className="p-6">
          <h4 className="text-base font-semibold text-slate-900">Context Churn Transitions</h4>
          <p className="mt-1 text-xs text-slate-500">
            What was added, removed, or retained between consecutive decisions?
          </p>

          <div className="mt-4 space-y-3">
            {report.churn_transitions.map((ch: ContextChurnTransition, idx: number) => (
              <div key={idx} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 p-3 bg-slate-50">
                <div>
                  <span className="font-mono text-xs font-semibold text-slate-900">
                    Decision {idx + 1} → Decision {idx + 2}
                  </span>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-600">
                    <span className="text-teal-700">+{ch.tokens_added.toLocaleString()} added</span>
                    <span className="text-red-700">-{ch.tokens_removed.toLocaleString()} removed</span>
                    <span className="text-slate-500">{ch.tokens_retained.toLocaleString()} retained</span>
                  </div>
                </div>
                <div className="text-right">
                  <Badge tone={ch.context_churn_rate > 0.5 ? "warning" : "neutral"}>
                    Churn: {(ch.context_churn_rate * 100).toFixed(1)}%
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 7. Diagnostic Signals Panel */}
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h4 className="text-base font-semibold text-slate-900">Diagnostic Signals</h4>
            <p className="mt-1 text-xs text-slate-500">
              Deterministic observations of potential bloat, duplication, or staleness.
            </p>
          </div>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {report.signals.length} signals
          </span>
        </div>

        <div className="mt-3 rounded-md bg-amber-50/60 p-2.5 text-xs text-amber-900">
          <strong>Notice:</strong> Diagnostic signals flag observable evidence patterns. They are hypotheses for controlled testing, not automatic claims of irrelevance.
        </div>

        {report.signals.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">No diagnostic signals flagged for this run.</p>
        ) : (
          <div className="mt-4 space-y-2.5">
            {report.signals.map((sig: ContextDiagnosticSignal, idx: number) => (
              <div
                key={idx}
                className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-slate-100 p-3 hover:bg-slate-50"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone={sig.severity === "CRITICAL" ? "danger" : sig.severity === "WARNING" ? "warning" : "info"}>
                      {sig.code}
                    </Badge>
                    <span className="text-xs font-semibold text-slate-900">{sig.description}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{sig.bounded_finding}</p>
                  {(sig.item_id || (sig.item_ids && sig.item_ids.length > 0)) && (
                    <p className="mt-1 font-mono text-[11px] text-slate-400">
                      Items: {sig.item_id ?? sig.item_ids?.join(", ")}
                    </p>
                  )}
                </div>
                {sig.token_impact !== undefined && (
                  <span className="font-mono text-xs text-slate-600">
                    {sig.token_impact.toLocaleString()} tokens
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 8. Controlled Ablation Candidates */}
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h4 className="text-base font-semibold text-slate-900">Controlled Ablation Candidates</h4>
            <p className="mt-1 text-xs text-slate-500">
              Safely fork and prove whether specific context items are causally necessary.
            </p>
          </div>
        </div>

        {ablationSuccess && (
          <div className="mt-4 rounded-md border border-teal-200 bg-teal-50 p-4 text-teal-900">
            <h5 className="text-xs font-semibold">Ablation Fork Executed Successfully</h5>
            <p className="mt-1 text-xs">
              Fork run <span className="font-mono">{ablationSuccess.forkId}</span> created with context exclusion.
            </p>
            {ablationSuccess.comparisonUrl && (
              <div className="mt-3">
                <Link
                  href={ablationSuccess.comparisonUrl}
                  className="rounded-md bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
                >
                  View Deterministic Run Comparison →
                </Link>
              </div>
            )}
          </div>
        )}

        {ablationError && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            {ablationError}
          </div>
        )}

        {report.ablation_candidates.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">No ablation candidates identified for this run.</p>
        ) : (
          <div className="mt-4 divide-y divide-slate-100">
            {report.ablation_candidates.map((cand: ContextAblationCandidate) => (
              <div key={cand.candidate_id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="max-w-xl">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-900">
                      {cand.suggested_mutation.target_identifier}
                    </span>
                    <Badge tone="neutral">{cand.source_type.replace(/_/g, " ")}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{cand.suggested_mutation.description}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Rationale: {cand.rationale} | Potential savings: ~{cand.token_savings_estimate} tokens
                  </p>
                </div>
                <div>
                  <Button
                    variant="secondary"
                    className="px-2.5 py-1 text-xs"
                    disabled={ablatingId === cand.candidate_id}
                    onClick={() => handleAblateContextItem(cand)}
                  >
                    {ablatingId === cand.candidate_id ? "Ablating..." : "Test without this item"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
