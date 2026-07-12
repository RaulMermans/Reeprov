import { describe, expect, it } from "vitest";
import { buildDashboardPulse, DASHBOARD_RUN_WINDOW_PER_INTEGRATION } from "@/lib/dashboard/buildDashboardPulse";
import type { IngestDiagnostic } from "@/lib/diagnostics/diagnosticTypes";
import type { ProjectIntegration } from "@/lib/integrations/integrationTypes";
import type { SavedRun } from "@/lib/runs/runTypes";

const NOW = new Date("2026-07-10T12:00:00.000Z");

function integration(id: string, projectId: string, partial: Partial<ProjectIntegration> = {}): ProjectIntegration {
  return {
    integrationId: id,
    projectId,
    projectName: `${projectId} project`,
    status: "receiving_events",
    mode: "trace_sdk",
    runCount: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...partial,
  };
}

function savedRun(id: string, projectId: string, status: "completed" | "degraded" | "failed" = "completed", at = "2026-07-10T10:00:00.000Z", failure = false): SavedRun {
  return {
    runRecord: {
      run_id: id,
      workflow_id: `${projectId}-workflow`,
      project_id: projectId,
      project_name: `${projectId} project`,
      status,
      started_at: at,
      completed_at: at,
      model_calls_count: 1,
      tool_calls_count: 1,
      evals_passed: 0,
      evals_failed: failure ? 1 : 0,
      artifact_refs: [],
      summary: "A summary that is never returned by the pulse.",
    },
    traceEvents: [
      { event_id: `${id}-start`, run_id: id, workflow_id: `${projectId}-workflow`, node_id: "work", timestamp: at, event_type: "node_started" },
      ...(failure ? [{ event_id: `${id}-fail`, run_id: id, workflow_id: `${projectId}-workflow`, node_id: "work", timestamp: at, event_type: "node_failed" as const, output_summary: "sk-secret-raw-model-output" }] : []),
      ...(!failure ? [{ event_id: `${id}-end`, run_id: id, workflow_id: `${projectId}-workflow`, node_id: "work", timestamp: at, event_type: "node_completed" as const, metadata: { model_name: "model-x", tool_name: "safe-tool" } }] : []),
    ],
    toolCalls: [],
    evalResults: [],
    artifactRefs: [],
    createdAt: at,
    updatedAt: at,
  };
}

function diagnostic(projectId: string, category: IngestDiagnostic["category"], message = "schema rejected API_KEY=very-secret-token"): IngestDiagnostic {
  return { diagnosticId: `diag-${projectId}-${category}`, projectId, category, errorCode: "400", message, createdAt: "2026-07-10T11:00:00.000Z" };
}

describe("buildDashboardPulse", () => {
  it("returns a stable empty command-center state", () => {
    const pulse = buildDashboardPulse({ integrations: [], diagnostics: [], now: NOW });
    expect(pulse.integrationCount).toBe(0);
    expect(pulse.runWindow.count).toBe(0);
    expect(pulse.integrations).toEqual([]);
    expect(pulse.integrationStatusCounts).toMatchObject({ live: 0, stale: 0, degraded: 0, disconnected: 0, waiting: 0 });
  });

  it("classifies live, stale, waiting, degraded, and disconnected integrations from bounded evidence", () => {
    const pulse = buildDashboardPulse({
      integrations: [
        { integration: integration("live", "live-project", { lastEventAt: "2026-07-10T11:00:00.000Z" }), runs: [savedRun("run-live", "live-project")] },
        { integration: integration("stale", "stale-project", { lastEventAt: "2026-07-01T00:00:00.000Z" }), runs: [] },
        { integration: integration("waiting", "waiting-project", { status: "waiting_for_first_event", runCount: 0 }), runs: [] },
        { integration: integration("degraded", "degraded-project", { lastEventAt: "2026-07-10T10:00:00.000Z" }), runs: [savedRun("run-degraded", "degraded-project", "failed", undefined, true)] },
        { integration: integration("offline", "offline-project", { lastEventAt: "2026-06-01T00:00:00.000Z" }), runs: [] },
      ],
      diagnostics: [],
      now: NOW,
    });
    expect(Object.fromEntries(pulse.integrations.map((item) => [item.integrationId, item.status]))).toEqual({ live: "live", stale: "stale", waiting: "waiting", degraded: "degraded", offline: "disconnected" });
    expect(pulse.runHealth).toMatchObject({ totalRuns: 2, completedRuns: 1, failedRuns: 1 });
  });

  it("uses auth diagnostics for disconnected status and returns only redacted diagnostic text", () => {
    const pulse = buildDashboardPulse({
      integrations: [{ integration: integration("secure", "secure-project", { lastEventAt: "2026-07-10T10:00:00.000Z" }), runs: [] }],
      diagnostics: [diagnostic("secure-project", "invalid_ingest_key")],
      now: NOW,
    });
    expect(pulse.integrations[0]?.status).toBe("disconnected");
    expect(pulse.diagnosticsSummary.latest[0]?.message).not.toContain("very-secret-token");
    expect(JSON.stringify(pulse)).not.toContain("sk-secret-raw-model-output");
  });

  it("groups workflow issues, creates drill-down links, and caps each integration run window", () => {
    const runs = Array.from({ length: DASHBOARD_RUN_WINDOW_PER_INTEGRATION + 3 }, (_, index) =>
      savedRun(`run-${index}`, "project", index < 2 ? "failed" : "completed", `2026-07-${String(9 - Math.min(index, 8)).padStart(2, "0")}T10:00:00.000Z`, index < 2),
    );
    const pulse = buildDashboardPulse({
      integrations: [{ integration: integration("integration_1", "project", { lastEventAt: "2026-07-10T10:00:00.000Z" }), runs }],
      diagnostics: [diagnostic("project", "schema_validation_failed")],
      now: NOW,
    });
    expect(pulse.runWindow.count).toBe(DASHBOARD_RUN_WINDOW_PER_INTEGRATION);
    expect(pulse.integrations[0]?.href).toBe("/dashboard/integrations/integration_1");
    expect(pulse.integrations[0]?.latestRunHref).toBe("/dashboard/runs/run-0");
    expect(pulse.recentActivity.some((activity) => activity.href === "/dashboard/runs/run-0")).toBe(true);
    expect(pulse.topFailureModes[0]).toMatchObject({ label: "Workflow issue at work", integrationIds: ["integration_1"] });
    expect(pulse.diagnosticsSummary.byCategory).toContainEqual({ category: "schema_validation_failed", count: 1 });
  });
});
