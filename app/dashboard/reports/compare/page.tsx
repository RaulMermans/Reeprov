"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ReportDiffView } from "@/components/dashboard/ReportDiffView";
import { Card } from "@/components/ui/Card";
import { clearInternalKey, getInternalKey, mergeAuthHeaders } from "@/lib/auth/internalKey";
import { diffReports, type ReportDiff } from "@/lib/reports/reportDiff";
import type { SavedReport, SavedReportSummary } from "@/lib/reports/reportTypes";

// ── Inner component (uses useSearchParams, must be inside Suspense) ───────────

function ComparePageInner() {
  const searchParams = useSearchParams();
  const preselectedBase = searchParams.get("base");

  type Step = "pick" | "loading" | "result" | "error";

  const [step, setStep] = useState<Step>("pick");
  const [reports, setReports] = useState<SavedReportSummary[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [baseId, setBaseId] = useState<string>(preselectedBase ?? "");
  const [targetId, setTargetId] = useState<string>("");
  const [diff, setDiff] = useState<ReportDiff | null>(null);
  const [baseReport, setBaseReport] = useState<SavedReport | null>(null);
  const [targetReport, setTargetReport] = useState<SavedReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadReports();
  }, []);

  async function loadReports() {
    setLoadingReports(true);
    try {
      const key = getInternalKey();
      const response = await fetch("/api/reports?limit=100", {
        headers: mergeAuthHeaders(key ? { "x-agentpulse-key": key } : {}),
      });
      if (response.status === 401) {
        clearInternalKey();
        setError("Access key required. Go to the Scanner and unlock first.");
        return;
      }
      if (!response.ok) {
        setError("Failed to load reports.");
        return;
      }
      const data = (await response.json()) as { reports: SavedReportSummary[] };
      setReports(data.reports ?? []);
    } catch {
      setError("Failed to load reports.");
    } finally {
      setLoadingReports(false);
    }
  }

  async function loadReport(id: string): Promise<SavedReport | null> {
    const key = getInternalKey();
    const response = await fetch(`/api/reports/${id}`, {
      headers: mergeAuthHeaders(key ? { "x-agentpulse-key": key } : {}),
    });
    if (!response.ok) return null;
    return (await response.json()) as SavedReport;
  }

  async function runDiff() {
    if (!baseId || !targetId) {
      setError("Select both a base and a target report.");
      return;
    }
    if (baseId === targetId) {
      setError("Base and target must be different reports.");
      return;
    }

    setStep("loading");
    setError(null);

    try {
      const [base, target] = await Promise.all([loadReport(baseId), loadReport(targetId)]);
      if (!base) { setError(`Base report not found: ${baseId}`); setStep("error"); return; }
      if (!target) { setError(`Target report not found: ${targetId}`); setStep("error"); return; }

      setBaseReport(base);
      setTargetReport(target);
      setDiff(diffReports(base, target));
      setStep("result");
    } catch {
      setError("Failed to compute diff.");
      setStep("error");
    }
  }

  return (
    <>
      {error ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</Card>
      ) : null}

      {/* Picker */}
      {step === "pick" || step === "error" ? (
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-950">Select reports to compare</h2>

          {loadingReports ? (
            <p className="text-sm text-slate-500">Loading reports…</p>
          ) : reports.length < 2 ? (
            <p className="text-sm text-slate-500">
              At least 2 saved reports are needed to compare.{" "}
              <Link href="/dashboard/scanner" className="text-teal-700 hover:underline">
                Run more scans →
              </Link>
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
                  Base (older) report
                  <select
                    className="min-h-10 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100"
                    onChange={(e) => setBaseId(e.target.value)}
                    value={baseId}
                  >
                    <option value="">Select base report…</option>
                    {reports.map((r) => (
                      <option key={r.reportId} value={r.reportId}>
                        {r.repoName} — {formatDate(r.generatedAt)} — score {r.score.toFixed(0)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
                  Target (newer) report
                  <select
                    className="min-h-10 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100"
                    onChange={(e) => setTargetId(e.target.value)}
                    value={targetId}
                  >
                    <option value="">Select target report…</option>
                    {reports.map((r) => (
                      <option key={r.reportId} value={r.reportId}>
                        {r.repoName} — {formatDate(r.generatedAt)} — score {r.score.toFixed(0)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <button
                className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
                disabled={!baseId || !targetId || baseId === targetId}
                onClick={() => void runDiff()}
                type="button"
              >
                Compare reports
              </button>
            </div>
          )}
        </Card>
      ) : null}

      {/* Loading */}
      {step === "loading" ? (
        <Card className="p-6 text-sm text-slate-500">Loading and computing diff…</Card>
      ) : null}

      {/* Result */}
      {step === "result" && diff && baseReport && targetReport ? (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-700">
                Comparing{" "}
                <Link href={`/dashboard/reports/${baseId}`} className="font-mono text-teal-700 hover:underline">
                  {baseReport.repoName}
                </Link>
                {" "}({formatDate(baseReport.generatedAt)})
                {" "}→{" "}
                <Link href={`/dashboard/reports/${targetId}`} className="font-mono text-teal-700 hover:underline">
                  {targetReport.repoName}
                </Link>
                {" "}({formatDate(targetReport.generatedAt)})
              </div>
              <button
                className="text-xs text-teal-700 hover:underline"
                onClick={() => { setStep("pick"); setDiff(null); }}
                type="button"
              >
                Change selection
              </button>
            </div>
          </Card>
          <ReportDiffView diff={diff} />
        </>
      ) : null}
    </>
  );
}

// ── Page (wraps inner in Suspense as required by Next.js for useSearchParams) ─

export default function ReportComparePage() {
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader />
      <Suspense fallback={<Card className="p-6 text-sm text-slate-500">Loading…</Card>}>
        <ComparePageInner />
      </Suspense>
    </main>
  );
}

function PageHeader() {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/dashboard/reports" className="text-sm text-teal-700 hover:underline">
          ← Scan history
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Report diff</h1>
        <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-500">
          Compare two proof reports
        </span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">
        Compare two saved scan reports to see score deltas, added/resolved findings, and regression candidates.
      </p>
    </div>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
