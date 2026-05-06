"use client";

import { useState } from "react";
import { AgentCard } from "@/components/dashboard/AgentCard";
import { FindingTable } from "@/components/dashboard/FindingTable";
import { HealthOverview } from "@/components/dashboard/HealthOverview";
import { RepoSelector } from "@/components/dashboard/RepoSelector";
import { ScanSummary } from "@/components/dashboard/ScanSummary";
import { Card } from "@/components/ui/Card";
import type { ScanReport } from "@/lib/scanner/types";

export function DashboardClient({ initialReport }: { initialReport: ScanReport }) {
  const [report, setReport] = useState<ScanReport>(initialReport);
  const [loading, setLoading] = useState(false);

  async function scan(repo: { owner?: string; name?: string; mock?: boolean }) {
    setLoading(true);
    const response = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(repo),
    });
    setReport(await response.json());
    setLoading(false);
  }

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-teal-700">AgentPulse</p>
          <h1 className="text-2xl font-semibold text-slate-950">Private repository audit</h1>
        </div>
      </div>

      <RepoSelector onScan={scan} />

      {loading ? (
        <Card className="p-6 text-sm text-slate-600">Loading scan report...</Card>
      ) : (
        <>
          <HealthOverview report={report} />
          <ScanSummary report={report} />

          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-950">Detected agents</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {report.detectedAgents.length > 0 ? (
                report.detectedAgents.map((agent) => <AgentCard agent={agent} key={agent.id} />)
              ) : (
                <Card className="p-5 text-sm text-slate-600">No agents detected.</Card>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-950">Findings</h2>
            <FindingTable findings={report.findings} />
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-950">Recommended next actions</h2>
            <Card className="p-5">
              <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
                {report.recommendations.map((recommendation) => (
                  <li key={recommendation}>{recommendation}</li>
                ))}
              </ul>
            </Card>
          </section>
        </>
      )}
    </main>
  );
}
