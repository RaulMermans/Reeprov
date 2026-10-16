"use client";

// Internal dashboard page — force dynamic to avoid prerender issues.
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AgentCard } from "@/components/dashboard/AgentCard";
import { FindingTable } from "@/components/dashboard/FindingTable";
import { HealthOverview } from "@/components/dashboard/HealthOverview";
import { MappingGaps } from "@/components/dashboard/MappingGaps";
import { ModelMatrix } from "@/components/dashboard/ModelMatrix";
import { ScanSummary } from "@/components/dashboard/ScanSummary";
import { SystemGraphView } from "@/components/dashboard/SystemGraphView";
import { WorkflowCard } from "@/components/dashboard/WorkflowCard";
import { Card } from "@/components/ui/Card";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import { useDashboardAuth } from "@/lib/auth/dashboardAuthContext";
import { exportReportMarkdown } from "@/lib/reports/exportMarkdown";
import type { SavedReport } from "@/lib/reports/reportTypes";

export default function SavedReportPage() {
  const params = useParams<{ reportId: string }>();
  const reportId = params.reportId;
  const { onUnauthorized } = useDashboardAuth();

  const [report, setReport] = useState<SavedReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !reportId) return;
    void loadReport(reportId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, reportId]);

  async function loadReport(id: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/reports/${id}`, {
        headers: mergeAuthHeaders(),
      });

      if (response.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }

      if (response.status === 404) {
        setError(`Report not found: ${id}`);
        return;
      }

      if (!response.ok) {
        setError("Failed to load report.");
        return;
      }

      const data = (await response.json()) as SavedReport;
      setReport(data);
    } catch {
      setError("Failed to load report.");
    } finally {
      setLoading(false);
    }
  }

  function downloadJson() {
    if (!report) return;
    downloadText(
      `${safeFilename(report.repoName)}-reeprov-report.json`,
      JSON.stringify(report, null, 2),
      "application/json",
    );
  }

  function downloadMarkdown() {
    if (!report) return;
    downloadText(
      `${safeFilename(report.repoName)}-reeprov-report.md`,
      exportReportMarkdown(report),
      "text/markdown",
    );
  }

  if (!mounted || loading) {
    return (
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <Card className="p-6 text-sm text-slate-500">
          {loading ? "Loading saved report…" : "Initialising…"}
        </Card>
      </main>
    );
  }

  if (error || !report) {
    return (
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/reports" className="text-sm text-teal-700 hover:underline">
            ← Scan history
          </Link>
        </div>
        <Card className="border-red-200 bg-red-50 p-6 text-sm text-red-800">
          {error ?? "Report not found."}
        </Card>
      </main>
    );
  }

  const sourceLabel = report.scanSource?.label ?? report.repoName;

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb + header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <Link href="/dashboard/reports" className="text-teal-700 hover:underline">
              Scan history
            </Link>
            <span>›</span>
            <span className="font-mono text-slate-700">{sourceLabel}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-slate-950">
              {sourceLabel}
            </h1>
            <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
              Saved proof report
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>Report ID: <span className="font-mono">{report.reportId}</span></span>
            <span>·</span>
            <span>Generated: {formatDate(report.generatedAt)}</span>
            <span>·</span>
            <span>Saved: {formatDate(report.savedAt)}</span>
            <span>·</span>
            <span>Version: {report.reportVersion} · {report.scannerVersion}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/dashboard/reports/compare?base=${report.reportId}`}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Compare
          </Link>
          <Link
            href={`/dashboard/reports/${report.reportId}/reconstruction`}
            className="rounded-md border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 transition hover:border-violet-300 hover:bg-violet-100"
            title="Generate a suggested WorkflowSpec from static scan evidence"
          >
            Generate proof spec
          </Link>
        </div>
      </div>

      {/* Export */}
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Export saved report</h2>
          <p className="mt-0.5 text-xs text-slate-500">Download or copy this redacted scan report.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white"
            onClick={downloadJson}
            type="button"
          >
            Download JSON
          </button>
          <button
            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white"
            onClick={downloadMarkdown}
            type="button"
          >
            Download Markdown
          </button>
        </div>
      </Card>

      {/* Reuse existing report components */}
      <HealthOverview report={report} />
      <ScanSummary report={report} />

      {report.systemGraph ? (
        <ReportSection title="AI System Graph">
          <SystemGraphView graph={report.systemGraph} />
        </ReportSection>
      ) : null}

      <ReportSection title="Model / Provider Matrix">
        <ModelMatrix
          agents={report.detectedAgents}
          models={report.detectedModels}
          performance={report.modelPerformance}
        />
      </ReportSection>

      {report.systemGraph ? (
        <ReportSection title="Mapping Gaps">
          <MappingGaps graph={report.systemGraph} />
        </ReportSection>
      ) : null}

      <ReportSection title="Detected Agents">
        <div className="grid gap-4 lg:grid-cols-2">
          {report.detectedAgents.length > 0 ? (
            report.detectedAgents.map((agent) => <AgentCard agent={agent} key={agent.id} />)
          ) : (
            <Card className="p-5 text-sm text-slate-500">No agents detected.</Card>
          )}
        </div>
      </ReportSection>

      {report.detectedWorkflowsDetailed.length > 0 ? (
        <ReportSection title="AI / Product Workflows">
          <div className="grid gap-4 lg:grid-cols-2">
            {report.detectedWorkflowsDetailed.map((workflow) => (
              <WorkflowCard key={workflow.id} workflow={workflow} />
            ))}
          </div>
        </ReportSection>
      ) : null}

      <ReportSection title="Findings">
        <FindingTable findings={report.findings} />
      </ReportSection>

      <ReportSection title="Recommended Next Actions">
        <Card className="p-5">
          {report.recommendations.length > 0 ? (
            <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
              {report.recommendations.map((rec) => (
                <li key={rec}>{rec}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No recommended actions at this time.</p>
          )}
        </Card>
      </ReportSection>

      <footer className="border-t border-slate-100 pt-4 text-center text-xs text-slate-400">
        Reeprov · Saved proof report · {report.scannerVersion}
      </footer>
    </main>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-slate-950">{title}</h2>
      {children}
    </section>
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

function safeFilename(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "") || "scan";
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
