"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import type {
  MemoryIntelligenceReport,
  MemoryAblationCandidate,
  MemoryDiagnosticSignal,
  MemoryInjectionRecord,
  MemoryLifecycle,
  MemoryImpactEvidence,
} from "@/lib/core/contracts/memoryIntelligence";

export function MemoryIntelligenceStudio({ runId }: { runId: string }) {
  const [report, setReport] = useState<MemoryIntelligenceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          `/api/runs/${encodeURIComponent(runId)}/memory-intelligence`,
          { headers: mergeAuthHeaders() }
        );
        if (!res.ok) {
          throw new Error(`Failed to load memory intelligence (${res.status})`);
        }
        const data: MemoryIntelligenceReport = await res.json();
        setReport(data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error loading memory intelligence";
        setError(msg);
      } finally {
        setLoading(false);
      }
    }

    fetchReport();
  }, [runId]);

  async function handleAblateMemoryItem(candidate: MemoryAblationCandidate) {
    try {
      setAblatingId(candidate.candidate_id);
      setAblationError(null);
      setAblationSuccess(null);

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
                mutation_type: "memory_exclusion",
                target_identifier: candidate.suggested_mutation.target_identifier,
                description: candidate.suggested_mutation.description,
                parameters: { memory_id: candidate.memory_id },
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
            "Memory ablation fork failed"
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
      const msg = err instanceof Error ? err.message : "Failed to execute memory ablation";
      setAblationError(msg);
    } finally {
      setAblatingId(null);
    }
  }

  if (loading) {
    return (
      <Card className="p-8 text-center text-slate-500">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
        <p className="mt-2 text-sm">Analyzing observable memory lifecycle & injection evidence...</p>
      </Card>
    );
  }

  if (error || !report) {
    return (
      <Card className="border-red-200 bg-red-50 p-6 text-red-900">
        <h3 className="text-sm font-semibold">Memory Intelligence Unavailable</h3>
        <p className="mt-1 text-xs">{error || "No memory intelligence report generated."}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Header & Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Memory Operations</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {report.operations_summary.total_operations}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {report.operations_summary.reads_count} reads, {report.operations_summary.writes_committed_count} writes
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Unique Memories</p>
          <p className="mt-1 text-2xl font-bold text-teal-700">
            {report.operations_summary.unique_memories_observed}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {report.operations_summary.supersedes_count} superseded across lifecycle
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Injected to Context</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {report.retrieval_summary.memories_injected_count}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {(report.retrieval_summary.admission_rate * 100).toFixed(0)}% admission rate
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Diagnostic Signals</p>
          <p className="mt-1 text-2xl font-bold text-amber-700">
            {report.diagnostics.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {report.ablation_candidates.length} ablation candidates
          </p>
        </Card>
      </div>

      {/* 2. Strictly Bounded Causality Notice */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
        <h4 className="font-semibold text-slate-900">
          Strictly Bounded Causal Proof Standard
        </h4>
        <p className="mt-1 leading-relaxed">
          AgentPulse never claims a memory was beneficial or detrimental without controlled experimental proof.
          Observable evidence is categorized strictly by proof level:
        </p>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded bg-white p-2 border border-slate-200">
            <Badge tone="neutral">OBSERVED</Badge>
            <p className="mt-1 text-[11px] text-slate-600">Memory was retrieved or injected into model context.</p>
          </div>
          <div className="rounded bg-white p-2 border border-slate-200">
            <Badge tone="info">CORRELATED</Badge>
            <p className="mt-1 text-[11px] text-slate-600">Memory presence co-occurs with specific behavior.</p>
          </div>
          <div className="rounded bg-white p-2 border border-slate-200">
            <Badge tone="warning">CONTROLLED_ABLATION</Badge>
            <p className="mt-1 text-[11px] text-slate-600">Isolated fork run executed with targeted memory excluded.</p>
          </div>
          <div className="rounded bg-white p-2 border border-slate-200">
            <Badge tone="success">CAUSALLY_SUPPORTED</Badge>
            <p className="mt-1 text-[11px] text-slate-600">Deterministic divergence directly follows controlled ablation.</p>
          </div>
        </div>
      </div>

      {/* 3. Retrieval → Injection Inspector */}
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h4 className="text-base font-semibold text-slate-900">
              Retrieval → Context Injection Inspector
            </h4>
            <p className="mt-1 text-xs text-slate-500">
              Observable memory references that were admitted into model prompt context.
            </p>
          </div>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {report.injections.length} injections
          </span>
        </div>

        {report.injections.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">No memory injections recorded in this run.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-2 font-medium">Memory ID</th>
                  <th className="pb-2 font-medium">Category / Provider</th>
                  <th className="pb-2 font-medium">Version</th>
                  <th className="pb-2 font-medium">Target Context Item</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {report.injections.map((inj: MemoryInjectionRecord, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="py-2.5 font-mono font-medium text-slate-900">
                      {inj.memory_id}
                    </td>
                    <td className="py-2.5">
                      <span className="capitalize">{inj.category ?? "preference"}</span>
                      {inj.provider && (
                        <span className="ml-1 text-slate-400 font-mono text-[10px]">({inj.provider})</span>
                      )}
                    </td>
                    <td className="py-2.5 font-mono">
                      {inj.memory_version ?? "1"}
                    </td>
                    <td className="py-2.5 font-mono text-slate-600">
                      {inj.context_item_id ?? "n/a"}
                    </td>
                    <td className="py-2.5">
                      {inj.is_stale_at_injection ? (
                        <Badge tone="warning">Stale Injected</Badge>
                      ) : (
                        <Badge tone="success">Active Injected</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 4. Memory Lifecycle Evolution */}
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h4 className="text-base font-semibold text-slate-900">
              Memory Lifecycle Evolution
            </h4>
            <p className="mt-1 text-xs text-slate-500">
              Observable memory creation, updates, consolidations, and superseding relationships.
            </p>
          </div>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {report.lifecycles.length} tracks
          </span>
        </div>

        <div className="mt-4 space-y-4">
          {report.lifecycles.map((lc: MemoryLifecycle) => (
            <div
              key={lc.memory_id}
              className="rounded-lg border border-slate-100 p-4 bg-slate-50 hover:bg-slate-100/60"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/60 pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-900">
                    {lc.memory_id}
                  </span>
                  <Badge tone={lc.is_superseded ? "neutral" : "success"}>
                    {lc.is_superseded ? "superseded" : "active"}
                  </Badge>
                  {lc.is_superseded && lc.superseded_by && (
                    <span className="font-mono text-[11px] text-slate-500">
                      Superseded by: {lc.superseded_by}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-slate-400">
                  {lc.updated_at ? new Date(lc.updated_at).toLocaleTimeString() : ""}
                </span>
              </div>

              {/* Lifecycle Nodes */}
              <div className="mt-3 space-y-2">
                {lc.nodes.map((node) => (
                  <div key={node.node_id} className="rounded border border-slate-200/80 bg-white p-2.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono font-medium text-slate-800">
                        Node: {node.operation_type}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        v{node.version ?? "1"}
                      </span>
                    </div>
                    {node.summary_preview && (
                      <p className="mt-1 text-slate-600 italic">
                        "{node.summary_preview}"
                      </p>
                    )}
                    {node.provider && (
                      <p className="mt-1 font-mono text-[10px] text-slate-400">
                        Store: {node.provider} | Hash: {node.content_hash?.slice(0, 16)}...
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 5. Causal Impact Evidence */}
      {report.impact_evidence.length > 0 && (
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h4 className="text-base font-semibold text-slate-900">Causal Impact Evidence</h4>
              <p className="mt-1 text-xs text-slate-500">
                Observable behavioral links with strictly bounded proof classification.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {report.impact_evidence.map((ev: MemoryImpactEvidence, idx: number) => (
              <div key={idx} className="rounded-md border border-slate-100 p-3 bg-slate-50">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-900">
                    {ev.memory_id}
                  </span>
                  <Badge tone={ev.evidence_level === "CAUSALLY_SUPPORTED" ? "success" : ev.evidence_level === "CONTROLLED_ABLATION" ? "warning" : "info"}>
                    {ev.evidence_level}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-slate-700">{ev.observed_behavior}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">{ev.notes}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 6. Diagnostic Signals */}
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h4 className="text-base font-semibold text-slate-900">Memory Diagnostic Signals</h4>
            <p className="mt-1 text-xs text-slate-500">
              Observable warnings regarding stale injection, write retry, or schema conflicts.
            </p>
          </div>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {report.diagnostics.length} signals
          </span>
        </div>

        {report.diagnostics.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">No memory diagnostic signals flagged.</p>
        ) : (
          <div className="mt-4 space-y-2.5">
            {report.diagnostics.map((sig: MemoryDiagnosticSignal, idx: number) => (
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
                  {sig.memory_id && (
                    <p className="mt-1 font-mono text-[11px] text-slate-400">
                      Memory ID: {sig.memory_id}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 7. Controlled Memory Ablation Candidates */}
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h4 className="text-base font-semibold text-slate-900">
              Controlled Memory Ablation Candidates
            </h4>
            <p className="mt-1 text-xs text-slate-500">
              Isolate and prove whether an injected memory was causally responsible for downstream behavior.
            </p>
          </div>
        </div>

        {ablationSuccess && (
          <div className="mt-4 rounded-md border border-teal-200 bg-teal-50 p-4 text-teal-900">
            <h5 className="text-xs font-semibold">Memory Ablation Fork Executed Successfully</h5>
            <p className="mt-1 text-xs">
              Fork run <span className="font-mono">{ablationSuccess.forkId}</span> created with memory exclusion.
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
          <p className="mt-4 text-xs text-slate-500">No memory ablation candidates identified.</p>
        ) : (
          <div className="mt-4 divide-y divide-slate-100">
            {report.ablation_candidates.map((cand: MemoryAblationCandidate) => (
              <div key={cand.candidate_id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="max-w-xl">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-900">
                      {cand.memory_id}
                    </span>
                    <Badge tone="neutral">{cand.signal_code.replace(/_/g, " ")}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{cand.suggested_mutation.description}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Rationale: {cand.rationale}
                    {cand.token_savings_estimate ? ` | ~${cand.token_savings_estimate} tokens` : ""}
                  </p>
                </div>
                <div>
                  <Button
                    variant="secondary"
                    className="px-2.5 py-1 text-xs"
                    disabled={ablatingId === cand.candidate_id}
                    onClick={() => handleAblateMemoryItem(cand)}
                  >
                    {ablatingId === cand.candidate_id ? "Ablating..." : "Test without this memory"}
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
