/**
 * Deterministic, bounded command-center aggregation for Reeprov.
 *
 * The caller supplies already bounded, already stored evidence. This module
 * performs no I/O and deliberately returns only display-safe summaries: it
 * never forwards trace input/output, request bodies, or credentials.
 */

import { redactDiagnosticMessage } from "@/lib/diagnostics/redact";
import type { IngestDiagnostic } from "@/lib/diagnostics/diagnosticTypes";
import { buildIntegrationBlueprint } from "@/lib/integrations/buildIntegrationBlueprint";
import type { IntegrationBlueprintMode, IntegrationWorkflowBlueprint } from "@/lib/integrations/integrationBlueprintTypes";
import { STALE_THRESHOLD_MS, type ProjectIntegration } from "@/lib/integrations/integrationTypes";
import type { WorkflowSpec } from "@/lib/proof-layer/schemas";
import type { SavedRun } from "@/lib/runs/runTypes";

export const DASHBOARD_RUN_WINDOW_PER_INTEGRATION = 20;
export const DASHBOARD_DIAGNOSTIC_WINDOW = 50;
export const DASHBOARD_ACTIVITY_LIMIT = 20;
export const DISCONNECTED_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

export type DashboardIntegrationStatus = "live" | "stale" | "degraded" | "disconnected" | "waiting";

export interface ReeprovDashboardPulse {
  generatedAt: string;
  integrationCount: number;
  runWindow: { count: number; from?: string; to?: string };
  integrationStatusCounts: Record<DashboardIntegrationStatus, number> & {
    unauthorized?: number;
    schema_error?: number;
  };
  runHealth: {
    totalRuns: number;
    completedRuns: number;
    degradedRuns: number;
    failedRuns: number;
    recoveredRuns: number;
  };
  recentActivity: Array<{
    integrationId: string;
    projectId: string;
    projectName: string;
    runId?: string;
    eventType: "run" | "diagnostic" | "integration";
    status: string;
    summary: string;
    occurredAt?: string;
    href?: string;
  }>;
  integrations: Array<{
    integrationId: string;
    projectId: string;
    projectName: string;
    status: DashboardIntegrationStatus;
    workflowMode: IntegrationBlueprintMode;
    runCount: number;
    lastRunAt?: string;
    lastEventAt?: string;
    recentCompleted: number;
    recentDegraded: number;
    recentFailed: number;
    recentRecovered: number;
    diagnosticsCount: number;
    topIssues: Array<{ label: string; count: number }>;
    topModels: Array<{ label: string; count: number }>;
    topTools: Array<{ label: string; count: number }>;
    href: string;
    latestRunHref?: string;
  }>;
  topFailureModes: Array<{
    label: string;
    count: number;
    integrationIds: string[];
    exampleRunIds: string[];
  }>;
  diagnosticsSummary: {
    totalRecent: number;
    byCategory: Array<{ category: string; count: number }>;
    latest: Array<{
      integrationId?: string;
      projectId?: string;
      category: string;
      message: string;
      occurredAt: string;
    }>;
  };
}

export type AgentPulseDashboardPulse = ReeprovDashboardPulse;

export interface DashboardPulseIntegrationInput {
  integration: ProjectIntegration;
  /** Most-recent-first, capped by DASHBOARD_RUN_WINDOW_PER_INTEGRATION. */
  runs: SavedRun[];
  workflowSpec?: WorkflowSpec;
}

export interface BuildDashboardPulseParams {
  integrations: DashboardPulseIntegrationInput[];
  /** Most-recent-first, capped by DASHBOARD_DIAGNOSTIC_WINDOW. */
  diagnostics: IngestDiagnostic[];
  /** Injectable for deterministic tests. */
  now?: Date;
}

function timestampForRun(run: SavedRun): string {
  return run.runRecord.completed_at ?? run.runRecord.started_at;
}

function latestTimestamp(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1);
}

function isRecent(occurredAt: string | undefined, now: Date): boolean {
  if (!occurredAt) return false;
  const parsed = new Date(occurredAt).getTime();
  return Number.isFinite(parsed) && now.getTime() - parsed <= STALE_THRESHOLD_MS;
}

function hasConnectionDiagnostic(diagnostics: IngestDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) =>
    diagnostic.category === "invalid_ingest_key" || diagnostic.category === "missing_auth_header",
  );
}

function statusForIntegration(
  integration: ProjectIntegration,
  blueprint: IntegrationWorkflowBlueprint,
  runs: SavedRun[],
  diagnostics: IngestDiagnostic[],
  now: Date,
): DashboardIntegrationStatus {
  const lastObservedAt = latestTimestamp([integration.lastEventAt, blueprint.healthSummary.lastRunAt]);
  const recentDiagnostics = diagnostics.some((diagnostic) => isRecent(diagnostic.createdAt, now));
  const recentRunTrouble = runs.some((run) =>
    isRecent(timestampForRun(run), now) && (run.runRecord.status === "failed" || run.runRecord.status === "degraded"),
  );

  if (hasConnectionDiagnostic(diagnostics)) return "disconnected";
  if (integration.status === "error") return "degraded";
  if (recentRunTrouble || recentDiagnostics) return "degraded";
  if (!lastObservedAt) return "waiting";

  const age = now.getTime() - new Date(lastObservedAt).getTime();
  if (Number.isFinite(age) && age > DISCONNECTED_THRESHOLD_MS) return "disconnected";
  if (Number.isFinite(age) && age > STALE_THRESHOLD_MS) return "stale";
  return "live";
}

function safeLabel(value: string): string {
  return redactDiagnosticMessage(value).replace(/\s+/g, " ").trim().slice(0, 160) || "Unknown";
}

/** Issue details can originate in trace output, so pulse exposes only the stage-shaped failure mode. */
function safeIssueLabel(parentIds: string[] | undefined): string {
  const stages = parentIds?.map((id) => id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48)).filter(Boolean) ?? [];
  return stages.length ? `Workflow issue at ${stages.join(", ")}` : "Workflow issue";
}

function topCounts(values: Map<string, number>, key: "label" | "category") {
  return [...values.entries()]
    .map(([label, count]) => key === "category" ? { category: label, count } : { label, count })
    .sort((a, b) => b.count - a.count || String("label" in a ? a.label : a.category).localeCompare(String("label" in b ? b.label : b.category)))
    .slice(0, 5);
}

/**
 * Builds a command-center payload from bounded integration evidence.
 *
 * Status rules are intentionally deterministic: recent successful activity is
 * live; 7–30 days without activity is stale; more than 30 days or an auth
 * diagnostic is disconnected; recent failures/diagnostics are degraded; and
 * integrations without an event or run are waiting.
 */
export function buildDashboardPulse({ integrations, diagnostics, now = new Date() }: BuildDashboardPulseParams): ReeprovDashboardPulse {
  const limitedDiagnostics = diagnostics.slice(0, DASHBOARD_DIAGNOSTIC_WINDOW);
  const statusCounts: ReeprovDashboardPulse["integrationStatusCounts"] = {
    live: 0,
    stale: 0,
    degraded: 0,
    disconnected: 0,
    waiting: 0,
  };
  const categoryCounts = new Map<string, number>();
  const failureModes = new Map<string, { label: string; count: number; integrationIds: Set<string>; exampleRunIds: Set<string> }>();
  const activity: ReeprovDashboardPulse["recentActivity"] = [];
  const allRuns: SavedRun[] = [];

  for (const diagnostic of limitedDiagnostics) {
    categoryCounts.set(diagnostic.category, (categoryCounts.get(diagnostic.category) ?? 0) + 1);
  }
  statusCounts.unauthorized = categoryCounts.get("invalid_ingest_key") ?? 0;
  statusCounts.schema_error = categoryCounts.get("schema_validation_failed") ?? 0;

  const pulseIntegrations = integrations.map(({ integration, runs, workflowSpec }) => {
    const sampledRuns = runs.slice(0, DASHBOARD_RUN_WINDOW_PER_INTEGRATION);
    const integrationDiagnostics = limitedDiagnostics.filter((diagnostic) =>
      diagnostic.integrationId === integration.integrationId || diagnostic.projectId === integration.projectId,
    );
    const blueprint = buildIntegrationBlueprint({
      integrationId: integration.integrationId,
      projectId: integration.projectId,
      runs: sampledRuns,
      workflowSpec,
      lastEventAt: integration.lastEventAt,
      diagnostics: integrationDiagnostics.map((diagnostic) => ({ category: diagnostic.category, createdAt: diagnostic.createdAt })),
    });
    const status = statusForIntegration(integration, blueprint, sampledRuns, integrationDiagnostics, now);
    statusCounts[status]++;
    allRuns.push(...sampledRuns);

    for (const issue of blueprint.nodes.filter((node) => node.type === "issue")) {
      const label = safeIssueLabel(issue.parentIds);
      const key = label.toLowerCase();
      const entry = failureModes.get(key) ?? { label, count: 0, integrationIds: new Set(), exampleRunIds: new Set() };
      entry.count += issue.frequency;
      entry.integrationIds.add(integration.integrationId);
      for (const example of issue.examples) entry.exampleRunIds.add(example.runId);
      failureModes.set(key, entry);
    }

    for (const run of sampledRuns) {
      const occurredAt = timestampForRun(run);
      activity.push({
        integrationId: integration.integrationId,
        projectId: integration.projectId,
        projectName: integration.projectName,
        runId: run.runRecord.run_id,
        eventType: "run",
        status: run.runRecord.status,
        summary: `Run ${run.runRecord.status}`,
        occurredAt,
        href: `/dashboard/runs/${encodeURIComponent(run.runRecord.run_id)}`,
      });
    }
    for (const diagnostic of integrationDiagnostics) {
      activity.push({
        integrationId: integration.integrationId,
        projectId: integration.projectId,
        projectName: integration.projectName,
        eventType: "diagnostic",
        status: diagnostic.category,
        summary: `Diagnostic: ${diagnostic.category.replace(/_/g, " ")}`,
        occurredAt: diagnostic.createdAt,
        href: `/dashboard/integrations/${encodeURIComponent(integration.integrationId)}#diagnostics`,
      });
    }
    if (blueprint.healthSummary.recoveredCount > 0) {
      activity.push({
        integrationId: integration.integrationId,
        projectId: integration.projectId,
        projectName: integration.projectName,
        eventType: "integration",
        status: "recovered",
        summary: "Recovered issue observed in recent runs",
        occurredAt: blueprint.healthSummary.lastRunAt,
        href: `/dashboard/integrations/${encodeURIComponent(integration.integrationId)}`,
      });
    }

    const latestRunId = sampledRuns[0]?.runRecord.run_id;
    return {
      integrationId: integration.integrationId,
      projectId: integration.projectId,
      projectName: integration.projectName,
      status,
      workflowMode: blueprint.mode,
      runCount: integration.runCount,
      lastRunAt: blueprint.healthSummary.lastRunAt,
      lastEventAt: integration.lastEventAt,
      recentCompleted: blueprint.healthSummary.completedCount,
      recentDegraded: blueprint.healthSummary.degradedCount,
      recentFailed: blueprint.healthSummary.failedCount,
      recentRecovered: blueprint.healthSummary.recoveredCount,
      diagnosticsCount: integrationDiagnostics.length,
      topIssues: blueprint.nodes
        .filter((node) => node.type === "issue")
        .slice(0, 5)
        .map((node) => ({ label: safeIssueLabel(node.parentIds), count: node.frequency })),
      topModels: blueprint.evidenceSummary.topModels.map((entry) => ({ ...entry, label: safeLabel(entry.label) })),
      topTools: blueprint.evidenceSummary.topTools.map((entry) => ({ ...entry, label: safeLabel(entry.label) })),
      href: `/dashboard/integrations/${encodeURIComponent(integration.integrationId)}`,
      latestRunHref: latestRunId ? `/dashboard/runs/${encodeURIComponent(latestRunId)}` : undefined,
    };
  });

  const runHealth = { totalRuns: allRuns.length, completedRuns: 0, degradedRuns: 0, failedRuns: 0, recoveredRuns: 0 };
  for (const integration of pulseIntegrations) {
    runHealth.completedRuns += integration.recentCompleted;
    runHealth.degradedRuns += integration.recentDegraded;
    runHealth.failedRuns += integration.recentFailed;
    runHealth.recoveredRuns += integration.recentRecovered;
  }

  const runTimes = allRuns.map(timestampForRun);
  const latestDiagnostics = limitedDiagnostics.slice(0, 10).map((diagnostic) => ({
    integrationId: diagnostic.integrationId,
    projectId: diagnostic.projectId,
    category: diagnostic.category,
    // The integration detail page is the only place to inspect the already-redacted
    // diagnostic text. The cross-project pulse exposes category-level context only.
    message: "Redacted diagnostic detail.",
    occurredAt: diagnostic.createdAt,
  }));

  return {
    generatedAt: now.toISOString(),
    integrationCount: pulseIntegrations.length,
    runWindow: { count: allRuns.length, from: runTimes.sort()[0], to: runTimes.sort().at(-1) },
    integrationStatusCounts: statusCounts,
    runHealth,
    recentActivity: activity
      .sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""))
      .slice(0, DASHBOARD_ACTIVITY_LIMIT),
    integrations: pulseIntegrations.sort((a, b) => (b.lastEventAt ?? b.lastRunAt ?? "").localeCompare(a.lastEventAt ?? a.lastRunAt ?? "")),
    topFailureModes: [...failureModes.values()]
      .map((entry) => ({
        label: entry.label,
        count: entry.count,
        integrationIds: [...entry.integrationIds].sort(),
        exampleRunIds: [...entry.exampleRunIds].sort().slice(0, 3),
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 5),
    diagnosticsSummary: {
      totalRecent: limitedDiagnostics.length,
      byCategory: topCounts(categoryCounts, "category") as Array<{ category: string; count: number }>,
      latest: latestDiagnostics,
    },
  };
}
