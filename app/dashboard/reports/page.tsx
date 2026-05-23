"use client";

// Internal dashboard page — force dynamic to avoid prerender issues.
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ReportHistoryList } from "@/components/dashboard/ReportHistoryList";
import { Card } from "@/components/ui/Card";
import { clearInternalKey, getInternalKey, mergeAuthHeaders } from "@/lib/auth/internalKey";
import type { SavedReportSummary } from "@/lib/reports/reportTypes";

export default function ReportsHistoryPage() {
  const [reports, setReports] = useState<SavedReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    void loadReports();
  }, [mounted]);

  async function loadReports() {
    setLoading(true);
    setError(null);
    try {
      const key = getInternalKey();
      const response = await fetch("/api/reports", {
        headers: mergeAuthHeaders(key ? { "x-agentpulse-key": key } : {}),
      });

      if (response.status === 401) {
        clearInternalKey();
        setError("Access key required. Go to the Scanner and unlock first.");
        return;
      }

      if (!response.ok) {
        setError("Failed to load scan history.");
        return;
      }

      const data = (await response.json()) as { reports: SavedReportSummary[] };
      setReports(data.reports ?? []);
    } catch {
      setError("Failed to load scan history.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(reportId: string) {
    setDeleting(reportId);
    try {
      const key = getInternalKey();
      const response = await fetch(`/api/reports/${reportId}`, {
        method: "DELETE",
        headers: mergeAuthHeaders(key ? { "x-agentpulse-key": key } : {}),
      });

      if (response.ok) {
        setReports((prev) => prev.filter((r) => r.reportId !== reportId));
      } else {
        setError("Failed to delete report.");
      }
    } catch {
      setError("Failed to delete report.");
    } finally {
      setDeleting(null);
    }
  }

  if (!mounted) {
    return (
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader />
        <Card className="p-6 text-sm text-slate-500">Loading…</Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader />
        <button
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
          onClick={() => void loadReports()}
          type="button"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</Card>
      ) : null}

      {loading ? (
        <Card className="p-6 text-sm text-slate-500">Loading scan history…</Card>
      ) : (
        <>
          {reports.length > 0 ? (
            <div className="text-xs text-slate-500">
              {reports.length} saved report{reports.length !== 1 ? "s" : ""} · newest first
            </div>
          ) : null}
          <ReportHistoryList
            reports={reports}
            onDelete={handleDelete}
            deleting={deleting}
          />
        </>
      )}
    </main>
  );
}

function PageHeader() {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Scan History</h1>
        <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-500">
          Saved proof reports
        </span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">
        Saved scan reports for your repositories. Reports are persisted locally after each successful scan.{" "}
        <Link href="/dashboard/scanner" className="text-teal-700 hover:underline">
          Run a new scan →
        </Link>
      </p>
    </div>
  );
}
