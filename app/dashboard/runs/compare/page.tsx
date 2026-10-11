"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import { useDashboardAuth } from "@/lib/auth/dashboardAuthContext";
import { RunCompareView } from "@/components/proof-layer/RunCompareView";
import { buildRunGraph, type RunGraph } from "@/lib/runs/runGraph";
import type { RunComparison } from "@/lib/core/contracts/comparison";
import type { RunRecord, TraceEvent, ToolCallRecord, EvalResult } from "@/lib/proof-layer/schemas";

function ComparePageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { onUnauthorized } = useDashboardAuth();

  const baselineParam = searchParams.get("baseline") ?? "";
  const candidateParam = searchParams.get("candidate") ?? "";
  const comparisonIdParam = searchParams.get("comparisonId") ?? "";

  const [baselineInput, setBaselineInput] = useState(baselineParam);
  const [candidateInput, setCandidateInput] = useState(candidateParam);
  const [enableSemantic, setEnableSemantic] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [comparison, setComparison] = useState<RunComparison | null>(null);
  const [baselineRun, setBaselineRun] = useState<RunRecord | undefined>();
  const [candidateRun, setCandidateRun] = useState<RunRecord | undefined>();
  const [baselineGraph, setBaselineGraph] = useState<RunGraph | undefined>();
  const [candidateGraph, setCandidateGraph] = useState<RunGraph | undefined>();
  const [baselineEvents, setBaselineEvents] = useState<TraceEvent[]>([]);
  const [candidateEvents, setCandidateEvents] = useState<TraceEvent[]>([]);

  const [recentComparisons, setRecentComparisons] = useState<RunComparison[]>([]);

  // Load existing comparisons list
  useEffect(() => {
    async function loadRecent() {
      try {
        const res = await fetch("/api/runs/compare", {
          headers: mergeAuthHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          setRecentComparisons(data.comparisons ?? []);
        }
      } catch {
        // ignore list fetch errors
      }
    }
    void loadRecent();
  }, []);

  // Fetch or execute comparison
  useEffect(() => {
    if (comparisonIdParam) {
      void loadComparisonById(comparisonIdParam);
    } else if (baselineParam && candidateParam) {
      void runComparison(baselineParam, candidateParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparisonIdParam, baselineParam, candidateParam]);

  async function loadComparisonById(id: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/compare/${encodeURIComponent(id)}`, {
        headers: mergeAuthHeaders(),
      });
      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid.");
        return;
      }
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Failed to load comparison '${id}'`);
      }
      const data = await res.json();
      setComparison(data.comparison);
      void loadRunsForCanvas(data.comparison.baseline_run_id, data.comparison.candidate_run_id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function runComparison(baselineId: string, candidateId: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/runs/compare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...mergeAuthHeaders(),
        },
        body: JSON.stringify({
          baseline_run_id: baselineId,
          candidate_run_id: candidateId,
          enable_semantic: enableSemantic,
        }),
      });

      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid.");
        return;
      }
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to compare runs.");
      }
      const data = await res.json();
      setComparison(data.comparison);
      void loadRunsForCanvas(baselineId, candidateId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadRunsForCanvas(bId: string, cId: string) {
    try {
      const [bRes, cRes] = await Promise.all([
        fetch(`/api/runs/${encodeURIComponent(bId)}`, { headers: mergeAuthHeaders() }),
        fetch(`/api/runs/${encodeURIComponent(cId)}`, { headers: mergeAuthHeaders() }),
      ]);

      if (bRes.ok) {
        const bData = await bRes.json();
        const runRecord: RunRecord = bData.runRecord;
        const events: TraceEvent[] = bData.traceEvents ?? [];
        setBaselineRun(runRecord);
        setBaselineEvents(events);
        setBaselineGraph(
          buildRunGraph({
            runRecord,
            traceEvents: events,
            toolCalls: bData.toolCalls ?? [],
            evalResults: bData.evalResults ?? [],
          })
        );
      }

      if (cRes.ok) {
        const cData = await cRes.json();
        const runRecord: RunRecord = cData.runRecord;
        const events: TraceEvent[] = cData.traceEvents ?? [];
        setCandidateRun(runRecord);
        setCandidateEvents(events);
        setCandidateGraph(
          buildRunGraph({
            runRecord,
            traceEvents: events,
            toolCalls: cData.toolCalls ?? [],
            evalResults: cData.evalResults ?? [],
          })
        );
      }
    } catch {
      // Run graph enrichment is optional
    }
  }

  function handleStartCompare(e: React.FormEvent) {
    e.preventDefault();
    if (!baselineInput.trim() || !candidateInput.trim()) return;
    router.push(
      `/dashboard/runs/compare?baseline=${encodeURIComponent(baselineInput.trim())}&candidate=${encodeURIComponent(
        candidateInput.trim()
      )}`
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Navigation Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-slate-500">
        <Link href="/dashboard/runs" className="hover:text-slate-800">
          Runs
        </Link>
        <span>/</span>
        <span className="font-semibold text-slate-800">Run Comparison & Divergence Analysis</span>
      </div>

      {/* Launcher Bar (if no comparison yet or wanting to select new runs) */}
      <Card className="mb-6 p-5 shadow-sm">
        <form onSubmit={handleStartCompare} className="flex flex-wrap items-end gap-4">
          <div className="min-w-64 flex-1">
            <label htmlFor="baseline-input" className="block text-xs font-semibold text-slate-700">
              Baseline Run ID (Run A)
            </label>
            <input
              id="baseline-input"
              type="text"
              placeholder="e.g. run-parent-123"
              value={baselineInput}
              onChange={(e) => setBaselineInput(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs font-mono shadow-xs focus:border-teal-600 focus:outline-hidden"
              required
            />
          </div>

          <div className="min-w-64 flex-1">
            <label htmlFor="candidate-input" className="block text-xs font-semibold text-slate-700">
              Candidate Run ID (Run B)
            </label>
            <input
              id="candidate-input"
              type="text"
              placeholder="e.g. run-child-456"
              value={candidateInput}
              onChange={(e) => setCandidateInput(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs font-mono shadow-xs focus:border-teal-600 focus:outline-hidden"
              required
            />
          </div>

          <div className="flex items-center gap-2 self-center pt-5">
            <input
              type="checkbox"
              id="semantic-toggle"
              checked={enableSemantic}
              onChange={(e) => setEnableSemantic(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600"
            />
            <label htmlFor="semantic-toggle" className="text-xs text-slate-600">
              Enable Semantic Interpretation (Layer 2)
            </label>
          </div>

          <Button type="submit" disabled={loading} className="px-4 py-2 text-xs font-semibold">
            {loading ? "Comparing..." : "Compare Runs"}
          </Button>
        </form>
      </Card>

      {/* Loading state */}
      {loading && (
        <Card className="p-8 text-center shadow-sm">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
          <p className="mt-3 text-xs font-semibold text-slate-700">
            Aligning executions & computing semantic divergence...
          </p>
        </Card>
      )}

      {/* Error state */}
      {error && !loading && (
        <Card className="border-rose-200 bg-rose-50/50 p-6 shadow-sm">
          <div className="flex items-center gap-2 text-rose-800">
            <span className="font-bold text-sm">Comparison Error:</span>
            <span className="text-sm">{error}</span>
          </div>
        </Card>
      )}

      {/* Render Comparison View */}
      {comparison && !loading && (
        <RunCompareView
          comparison={comparison}
          baselineRun={baselineRun}
          candidateRun={candidateRun}
          baselineGraph={baselineGraph}
          candidateGraph={candidateGraph}
          baselineTraceEvents={baselineEvents}
          candidateTraceEvents={candidateEvents}
        />
      )}

      {/* If no active comparison and not loading, show recent comparisons */}
      {!comparison && !loading && recentComparisons.length > 0 && (
        <Card className="mt-6 p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800">
            Saved Comparisons ({recentComparisons.length})
          </h2>
          <div className="mt-4 divide-y divide-slate-100">
            {recentComparisons.map((c) => (
              <div key={c.comparison_id} className="flex items-center justify-between py-3 text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-slate-900">{c.baseline_run_id.slice(0, 8)}</span>
                    <span className="text-slate-400">vs</span>
                    <span className="font-mono font-semibold text-indigo-700">{c.candidate_run_id.slice(0, 8)}</span>
                    <Badge tone="neutral" className="text-[10px]">
                      {c.relationship}
                    </Badge>
                    <Badge tone="info" className="text-[10px]">
                      {c.verdict}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    ID: {c.comparison_id} · {new Date(c.created_at).toLocaleString()}
                  </p>
                </div>
                <Link
                  href={`/dashboard/runs/compare?baseline=${encodeURIComponent(
                    c.baseline_run_id
                  )}&candidate=${encodeURIComponent(c.candidate_run_id)}`}
                  className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  View Diff
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-xs text-slate-500">
          Loading comparison page...
        </div>
      }
    >
      <ComparePageContent />
    </Suspense>
  );
}
