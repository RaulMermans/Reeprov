"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StaticProofReconstructionPanel } from "@/components/dashboard/StaticProofReconstructionPanel";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import { useDashboardAuth } from "@/lib/auth/dashboardAuthContext";
import type { ScanReport } from "@/lib/scanner/types";

export default function ReportReconstructionPage() {
  const params = useParams<{ reportId: string }>();
  const reportId = params.reportId;
  const { onUnauthorized } = useDashboardAuth();

  const [report, setReport] = useState<ScanReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reportId) return;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/reports/${reportId}`, {
          headers: mergeAuthHeaders(),
        });

        if (res.status === 401) {
          onUnauthorized("Access key expired or invalid. Please unlock again.");
          return;
        }

        if (res.status === 404) {
          setError(`Report "${reportId}" not found.`);
          return;
        }

        if (!res.ok) {
          const data = await res.json() as { message?: string };
          setError(data.message ?? "Failed to load report.");
          return;
        }

        const data = await res.json() as ScanReport;
        setReport(data);
      } catch {
        setError("Could not connect to AgentPulse. Is the dev server running?");
      } finally {
        setLoading(false);
      }
    }

    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Card className="p-8 text-center text-sm text-slate-500">Loading report…</Card>
      </main>
    );
  }

  if (error || !report) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Card className="p-8">
          <p className="text-sm text-red-700">{error ?? "Report not found."}</p>
          <Link href="/dashboard/reports" className="mt-4 inline-block text-sm text-teal-700 hover:underline">
            ← Back to reports
          </Link>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <nav className="flex items-center gap-1.5 text-xs font-medium text-slate-500" aria-label="Breadcrumb">
        <Link href="/dashboard" className="hover:text-teal-700">Overview</Link>
        <span>/</span>
        <Link href="/dashboard/reports" className="hover:text-teal-700">Reports</Link>
        <span>/</span>
        <Link href={`/dashboard/reports/${reportId}`} className="hover:text-teal-700 font-mono">{reportId}</Link>
        <span>/</span>
        <span className="text-slate-400">reconstruction</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
              Static Proof Reconstruction
            </h1>
            <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700">
              Static inference
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            <strong>{report.repoName}</strong> — best-effort WorkflowSpec from static scan evidence.
            No code execution. No repo changes required.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="neutral">{report.projectType}</Badge>
          <Badge tone="info">v{report.reportVersion}</Badge>
        </div>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <strong>This is a static reconstruction.</strong> The WorkflowSpec below is inferred from repo
        files — not from runtime execution. It may be incomplete or imprecise. Confidence levels indicate
        how much evidence was available. See the instrumentation plan to add optional runtime proof.
      </div>

      <StaticProofReconstructionPanel report={report} />
    </main>
  );
}
