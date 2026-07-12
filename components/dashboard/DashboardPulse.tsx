"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useDashboardAuth } from "@/lib/auth/dashboardAuthContext";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import type { AgentPulseDashboardPulse } from "@/lib/dashboard/buildDashboardPulse";

function badgeTone(status: string): "success" | "warning" | "danger" | "neutral" | "info" {
  if (status === "live" || status === "completed" || status === "recovered") return "success";
  if (status === "degraded" || status === "failed" || status === "disconnected") return "danger";
  if (status === "stale") return "warning";
  return "neutral";
}

function formatDateTime(value?: string): string {
  if (!value) return "No events yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function workflowModeLabel(mode: string): string {
  if (mode === "registered_spec") return "registered spec";
  if (mode === "inferred_from_runs") return "inferred";
  return "insufficient data";
}

function StatusMetric({ label, value, detail, tone = "neutral" }: { label: string; value: string | number; detail: string; tone?: "neutral" | "success" | "warning" | "danger" }) {
  const color = tone === "danger" ? "text-red-700" : tone === "warning" ? "text-amber-700" : tone === "success" ? "text-emerald-700" : "text-slate-950";
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </Card>
  );
}

export function DashboardPulse() {
  const { onUnauthorized } = useDashboardAuth();
  const [pulse, setPulse] = useState<AgentPulseDashboardPulse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function loadPulse() {
      try {
        const response = await fetch("/api/dashboard/pulse", { headers: mergeAuthHeaders() });
        if (!active) return;
        if (response.status === 401) {
          onUnauthorized("Access key expired or invalid. Please unlock again.");
          return;
        }
        if (!response.ok) {
          setError("Could not load the dashboard pulse.");
          return;
        }
        const data = await response.json() as { pulse?: AgentPulseDashboardPulse };
        setPulse(data.pulse ?? null);
      } catch {
        if (active) setError("Could not connect to AgentPulse.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadPulse();
    return () => { active = false; };
  }, [onUnauthorized]);

  if (loading) {
    return <Card className="p-6"><div className="h-24 animate-pulse rounded bg-slate-100" /></Card>;
  }

  if (error) {
    return <Card className="border-red-200 p-6 text-sm text-red-700">{error}</Card>;
  }

  if (!pulse || pulse.integrationCount === 0) {
    return (
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-950">No connected integrations yet</h2>
        <p className="mt-2 max-w-xl text-sm text-slate-500">
          Add an integration to begin receiving redacted runtime events, diagnostics, and workflow health in this command center.
        </p>
        <Link href="/dashboard/integrations" className="mt-4 inline-flex rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800">
          Add integration
        </Link>
      </Card>
    );
  }

  const attentionCount = pulse.integrationStatusCounts.degraded + pulse.integrationStatusCounts.disconnected;
  return (
    <div className="grid gap-8">
      <section aria-labelledby="pulse-status-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="pulse-status-heading" className="text-base font-semibold text-slate-950">Command center</h2>
            <p className="mt-0.5 text-xs text-slate-500">Bounded recent activity across all connected projects.</p>
          </div>
          <p className="text-xs text-slate-400">Updated {formatDateTime(pulse.generatedAt)}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatusMetric label="Connected integrations" value={pulse.integrationCount} detail={`${pulse.integrationStatusCounts.live} live`} tone="success" />
          <StatusMetric label="Live / stale / disconnected" value={`${pulse.integrationStatusCounts.live}/${pulse.integrationStatusCounts.stale}/${pulse.integrationStatusCounts.disconnected}`} detail="Operational status" tone={pulse.integrationStatusCounts.disconnected ? "danger" : pulse.integrationStatusCounts.stale ? "warning" : "success"} />
          <StatusMetric label="Recent runs" value={pulse.runHealth.totalRuns} detail="Sampled bounded run window" />
          <StatusMetric label="Degraded / failed runs" value={`${pulse.runHealth.degradedRuns}/${pulse.runHealth.failedRuns}`} detail={`${pulse.runHealth.recoveredRuns} recovered`} tone={pulse.runHealth.degradedRuns || pulse.runHealth.failedRuns ? "danger" : "success"} />
          <StatusMetric label="Recent diagnostics" value={pulse.diagnosticsSummary.totalRecent} detail={attentionCount ? `${attentionCount} integrations need attention` : "No projects need attention"} tone={pulse.diagnosticsSummary.totalRecent ? "warning" : "success"} />
        </div>
      </section>

      <section aria-labelledby="integration-health-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 id="integration-health-heading" className="text-base font-semibold text-slate-950">Integration health</h2>
            <p className="mt-0.5 text-xs text-slate-500">Open a blueprint for the workflow shape and integration diagnostics.</p>
          </div>
          <Link href="/dashboard/integrations" className="text-xs font-medium text-teal-700 hover:text-teal-900">Manage integrations →</Link>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {pulse.integrations.map((integration) => <IntegrationHealthCard key={integration.integrationId} integration={integration} />)}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="recent-activity-heading">
          <h2 id="recent-activity-heading" className="mb-3 text-base font-semibold text-slate-950">Recent activity</h2>
          <Card className="divide-y divide-slate-100 p-0">
            {pulse.recentActivity.length ? pulse.recentActivity.map((item, index) => {
              const content = <>
                <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-950">{item.projectName}</p><p className="mt-0.5 text-xs text-slate-500">{item.summary}</p></div>
                <div className="shrink-0 text-right"><Badge tone={badgeTone(item.status)}>{item.status.replace(/_/g, " ")}</Badge><p className="mt-1 text-xs text-slate-400">{formatDateTime(item.occurredAt)}</p></div>
              </>;
              return item.href ? <Link key={`${item.eventType}-${item.runId ?? index}`} href={item.href} className="flex items-center justify-between gap-3 p-3 transition hover:bg-slate-50">{content}</Link> : <div key={`${item.eventType}-${item.runId ?? index}`} className="flex items-center justify-between gap-3 p-3">{content}</div>;
            }) : <p className="p-4 text-sm text-slate-500">No recent activity in the sampled window.</p>}
          </Card>
        </section>

        <section aria-labelledby="failure-modes-heading">
          <h2 id="failure-modes-heading" className="mb-3 text-base font-semibold text-slate-950">Top failure modes</h2>
          <Card className="divide-y divide-slate-100 p-0">
            {pulse.topFailureModes.length ? pulse.topFailureModes.map((failure) => (
              <div key={failure.label} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-950">{failure.label}</p><p className="mt-0.5 text-xs text-slate-500">{failure.integrationIds.length} affected integration{failure.integrationIds.length === 1 ? "" : "s"}</p></div>
                <div className="flex shrink-0 items-center gap-2"><Badge tone="danger">{failure.count}</Badge>{failure.exampleRunIds[0] ? <Link href={`/dashboard/runs/${encodeURIComponent(failure.exampleRunIds[0])}`} className="text-xs font-medium text-teal-700 hover:text-teal-900">Example run →</Link> : null}</div>
              </div>
            )) : <p className="p-4 text-sm text-slate-500">No recurring failure modes in the sampled run window.</p>}
          </Card>
        </section>
      </div>

      {pulse.diagnosticsSummary.latest.length ? <section aria-labelledby="diagnostics-heading">
        <h2 id="diagnostics-heading" className="mb-3 text-base font-semibold text-slate-950">Recent diagnostics</h2>
        <Card className="divide-y divide-slate-100 p-0">
          {pulse.diagnosticsSummary.latest.map((diagnostic, index) => <div key={`${diagnostic.occurredAt}-${index}`} className="flex items-start justify-between gap-3 p-3"><div><p className="text-sm font-medium text-slate-950">{diagnostic.category.replace(/_/g, " ")}</p><p className="mt-0.5 text-xs text-slate-500">{diagnostic.message}</p></div><p className="shrink-0 text-xs text-slate-400">{formatDateTime(diagnostic.occurredAt)}</p></div>)}
        </Card>
      </section> : null}
    </div>
  );
}

function IntegrationHealthCard({ integration }: { integration: AgentPulseDashboardPulse["integrations"][number] }) {
  const health = `${integration.recentCompleted} completed · ${integration.recentDegraded} degraded · ${integration.recentFailed} failed`;
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <Link href={integration.href} className="min-w-0"><h3 className="truncate text-base font-semibold text-slate-950 hover:text-teal-700">{integration.projectName}</h3><p className="mt-0.5 truncate text-xs text-slate-500">{integration.projectId}</p></Link>
        <div className="flex shrink-0 gap-1"><Badge tone={badgeTone(integration.status)}>{integration.status}</Badge><Badge tone="neutral">{workflowModeLabel(integration.workflowMode)}</Badge></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs"><PulseDatum label="Runs" value={String(integration.runCount)} /><PulseDatum label="Diagnostics" value={String(integration.diagnosticsCount)} /><PulseDatum label="Last event" value={formatDateTime(integration.lastEventAt)} /><PulseDatum label="Last run" value={formatDateTime(integration.lastRunAt)} /></div>
      <p className="mt-4 text-xs text-slate-600">Recent health: {health}</p>
      {integration.topIssues[0] ? <p className="mt-2 truncate text-xs text-amber-800">Top issue: {integration.topIssues[0].label} ({integration.topIssues[0].count})</p> : null}
      <div className="mt-4 flex gap-3"><Link href={integration.href} className="text-xs font-medium text-teal-700 hover:text-teal-900">View blueprint →</Link>{integration.latestRunHref ? <Link href={integration.latestRunHref} className="text-xs font-medium text-teal-700 hover:text-teal-900">Latest run →</Link> : null}</div>
    </Card>
  );
}

function PulseDatum({ label, value }: { label: string; value: string }) {
  return <div><p className="text-slate-400">{label}</p><p className="mt-0.5 truncate font-medium text-slate-700">{value}</p></div>;
}
