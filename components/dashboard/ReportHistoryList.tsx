"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import type { SavedReportSummary } from "@/lib/reports/reportTypes";

// ── Helpers ───────────────────────────────────────────────────────────────────

function healthBadge(status: SavedReportSummary["healthStatus"]) {
  const map: Record<SavedReportSummary["healthStatus"], { label: string; className: string }> = {
    "healthy": { label: "Healthy", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    "needs-attention": { label: "Needs attention", className: "bg-amber-50 text-amber-700 border-amber-200" },
    "at-risk": { label: "At risk", className: "bg-orange-50 text-orange-700 border-orange-200" },
    "critical": { label: "Critical", className: "bg-red-50 text-red-700 border-red-200" },
  };
  const { label, className } = map[status];
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function sourceBadge(sourceType: string) {
  const map: Record<string, string> = {
    github: "GitHub",
    zip: "ZIP",
    mock: "Mock",
  };
  return (
    <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">
      {map[sourceType] ?? sourceType}
    </span>
  );
}

function findingPill(count: number, severity: string, colorClass: string) {
  if (count === 0) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium ${colorClass}`}>
      {count} {severity}
    </span>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ReportHistoryListProps {
  reports: SavedReportSummary[];
  onDelete?: (reportId: string) => void;
  deleting?: string | null;
}

export function ReportHistoryList({ reports, onDelete, deleting }: ReportHistoryListProps) {
  if (reports.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-slate-500">
        <p className="font-medium text-slate-700">No saved reports yet</p>
        <p className="mt-1">Run a repository scan from the Scanner to create one.</p>
        <Link
          href="/dashboard/scanner"
          className="mt-4 inline-flex items-center rounded-md bg-teal-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-teal-800"
        >
          Go to Scanner
        </Link>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {reports.map((r) => (
        <Card key={r.reportId} className="p-4 transition hover:shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            {/* Left: name + badges */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-mono text-sm font-semibold text-slate-950">
                  {r.repoName}
                </span>
                {sourceBadge(r.sourceType)}
                {healthBadge(r.healthStatus)}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span>Score: <span className="font-semibold text-slate-700">{r.score.toFixed(0)}</span>/100</span>
                <span>{formatDate(r.generatedAt)}</span>
                <span className="text-slate-400">v{r.reportVersion} · {r.scannerVersion}</span>
              </div>
              {/* Finding counts */}
              <div className="mt-2 flex flex-wrap gap-1">
                {findingPill(r.findingCounts.critical, "critical", "bg-red-100 text-red-700")}
                {findingPill(r.findingCounts.high, "high", "bg-orange-100 text-orange-700")}
                {findingPill(r.findingCounts.medium, "medium", "bg-amber-100 text-amber-700")}
                {findingPill(r.findingCounts.low, "low", "bg-slate-100 text-slate-600")}
                {findingPill(r.findingCounts.info, "info", "bg-blue-50 text-blue-600")}
              </div>
              {/* Detected counts */}
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                {r.detectedCounts.agents > 0 && (
                  <span>{r.detectedCounts.agents} agent{r.detectedCounts.agents !== 1 ? "s" : ""}</span>
                )}
                {r.detectedCounts.workflows > 0 && (
                  <span>{r.detectedCounts.workflows} workflow{r.detectedCounts.workflows !== 1 ? "s" : ""}</span>
                )}
                {r.detectedCounts.prompts > 0 && (
                  <span>{r.detectedCounts.prompts} prompt{r.detectedCounts.prompts !== 1 ? "s" : ""}</span>
                )}
                {r.detectedCounts.evals > 0 && (
                  <span>{r.detectedCounts.evals} eval{r.detectedCounts.evals !== 1 ? "s" : ""}</span>
                )}
              </div>
            </div>

            {/* Right: actions */}
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link
                href={`/dashboard/reports/${r.reportId}`}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                View report
              </Link>
              <Link
                href={`/dashboard/reports/${r.reportId}/reconstruction`}
                className="rounded-md border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 transition hover:border-violet-300 hover:bg-violet-100"
                title="Generate a suggested WorkflowSpec from static scan evidence"
              >
                Reconstruct
              </Link>
              {onDelete ? (
                <button
                  className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={deleting === r.reportId}
                  onClick={() => onDelete(r.reportId)}
                  type="button"
                >
                  {deleting === r.reportId ? "Deleting…" : "Delete"}
                </button>
              ) : null}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
