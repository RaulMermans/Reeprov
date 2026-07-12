/**
 * Tests for the Integration Workflow Blueprint builder.
 *
 * Verifies aggregation across a bounded window of recent runs: mode
 * selection (registered_spec / inferred_from_runs / insufficient_data),
 * stage/edge/evidence frequency aggregation, health summary, and common
 * issue grouping. buildIntegrationBlueprint is pure — no I/O — so these
 * tests construct SavedRun fixtures directly.
 */

import { describe, expect, it } from "vitest";
import type { EvalResult, RunRecord, ToolCallRecord, TraceEvent, WorkflowSpec } from "@/lib/proof-layer/schemas";
import type { SavedRun } from "@/lib/runs/runTypes";
import { buildIntegrationBlueprint, DEFAULT_BLUEPRINT_RUN_WINDOW } from "@/lib/integrations/buildIntegrationBlueprint";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRun(runId: string, partial: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: runId,
    workflow_id: "wf-test",
    project_id: "proj-test",
    project_name: "Test Project",
    status: "completed",
    started_at: "2026-06-01T10:00:00.000Z",
    completed_at: "2026-06-01T10:05:00.000Z",
    model_calls_count: 0,
    tool_calls_count: 0,
    evals_passed: 0,
    evals_failed: 0,
    artifact_refs: [],
    summary: `Run ${runId}`,
    ...partial,
  };
}

function makeEvent(
  runId: string,
  partial: Partial<TraceEvent> & Pick<TraceEvent, "event_id" | "event_type" | "timestamp">,
): TraceEvent {
  return { run_id: runId, workflow_id: "wf-test", ...partial };
}

function makeSavedRun(
  runId: string,
  events: TraceEvent[],
  opts: {
    runPartial?: Partial<RunRecord>;
    toolCalls?: ToolCallRecord[];
    evalResults?: EvalResult[];
  } = {},
): SavedRun {
  return {
    runRecord: makeRun(runId, opts.runPartial),
    traceEvents: events,
    toolCalls: opts.toolCalls ?? [],
    evalResults: opts.evalResults ?? [],
    artifactRefs: [],
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:05:00.000Z",
  };
}

function stageEvents(runId: string, nodeId: string, base: string, extra: TraceEvent[] = []): TraceEvent[] {
  return [
    makeEvent(runId, { event_id: `${runId}-${nodeId}-start`, event_type: "node_started", node_id: nodeId, timestamp: base }),
    ...extra,
    makeEvent(runId, { event_id: `${runId}-${nodeId}-end`, event_type: "node_completed", node_id: nodeId, timestamp: base }),
  ];
}

const SPEC: WorkflowSpec = {
  workflow_id: "wf-test",
  project_id: "proj-test",
  name: "Test Workflow",
  architecture_type: "deterministic_workflow",
  nodes: [
    { id: "intake", type: "trigger", label: "Intake" },
    { id: "draft", type: "llm", label: "Draft" },
    { id: "review", type: "evaluator", label: "Review" },
  ],
  expected_order: ["intake", "draft", "review"],
  edges: [
    { from: "intake", to: "draft" },
    { from: "draft", to: "review" },
  ],
};

// ── Mode selection ────────────────────────────────────────────────────────────

describe("buildIntegrationBlueprint — mode selection", () => {
  it("returns insufficient_data with no spec and no runs", () => {
    const blueprint = buildIntegrationBlueprint({
      integrationId: "integ-1",
      projectId: "proj-test",
      runs: [],
    });
    expect(blueprint.mode).toBe("insufficient_data");
    expect(blueprint.nodes).toEqual([]);
    expect(blueprint.edges).toEqual([]);
    expect(blueprint.generatedFromRunIds).toEqual([]);
    expect(blueprint.runWindow.count).toBe(0);
  });

  it("returns registered_spec when a WorkflowSpec is provided, even with zero runs", () => {
    const blueprint = buildIntegrationBlueprint({
      integrationId: "integ-1",
      projectId: "proj-test",
      runs: [],
      workflowSpec: SPEC,
    });
    expect(blueprint.mode).toBe("registered_spec");
    expect(blueprint.nodes.map((n) => n.id).sort()).toEqual(["draft", "intake", "review"]);
    expect(blueprint.nodes.every((n) => n.frequency === 0)).toBe(true);
    // Declared edges are seeded even with zero observed runs.
    expect(blueprint.edges).toHaveLength(2);
    expect(blueprint.edges.every((e) => e.frequency === 0)).toBe(true);
  });

  it("returns inferred_from_runs when runs exist but no spec is registered", () => {
    const run = makeSavedRun("run-1", stageEvents("run-1", "draft", "2026-06-01T10:00:00.000Z"));
    const blueprint = buildIntegrationBlueprint({
      integrationId: "integ-1",
      projectId: "proj-test",
      runs: [run],
    });
    expect(blueprint.mode).toBe("inferred_from_runs");
    expect(blueprint.nodes.map((n) => n.id)).toEqual(["draft"]);
  });
});

// ── Stage node + edge frequency aggregation ───────────────────────────────────

describe("buildIntegrationBlueprint — stage and edge aggregation", () => {
  it("aggregates stage frequency and status counts across runs (inferred mode)", () => {
    const run1 = makeSavedRun("run-1", [
      ...stageEvents("run-1", "draft", "2026-06-01T10:00:00.000Z"),
      ...stageEvents("run-1", "review", "2026-06-01T10:01:00.000Z"),
    ]);
    const run2 = makeSavedRun("run-2", [
      ...stageEvents("run-2", "draft", "2026-06-02T10:00:00.000Z"),
      makeEvent("run-2", { event_id: "run-2-review-start", event_type: "node_started", node_id: "review", timestamp: "2026-06-02T10:01:00.000Z" }),
      makeEvent("run-2", { event_id: "run-2-review-fail", event_type: "node_failed", node_id: "review", timestamp: "2026-06-02T10:02:00.000Z" }),
    ], { runPartial: { status: "failed" } });

    const blueprint = buildIntegrationBlueprint({
      integrationId: "integ-1",
      projectId: "proj-test",
      runs: [run2, run1], // newest first, as callers pass it
    });

    const draft = blueprint.nodes.find((n) => n.id === "draft")!;
    expect(draft.frequency).toBe(2);
    expect(draft.statusSummary.completedRuns).toBe(2);

    const review = blueprint.nodes.find((n) => n.id === "review")!;
    expect(review.frequency).toBe(2);
    expect(review.statusSummary.completedRuns).toBe(1);
    expect(review.statusSummary.failedRuns).toBe(1);
  });

  it("aggregates workflow edge frequency across runs", () => {
    const run1 = makeSavedRun("run-1", [
      ...stageEvents("run-1", "draft", "2026-06-01T10:00:00.000Z"),
      ...stageEvents("run-1", "review", "2026-06-01T10:01:00.000Z"),
    ]);
    const run2 = makeSavedRun("run-2", [
      ...stageEvents("run-2", "draft", "2026-06-02T10:00:00.000Z"),
      ...stageEvents("run-2", "review", "2026-06-02T10:01:00.000Z"),
    ]);

    const blueprint = buildIntegrationBlueprint({
      integrationId: "integ-1",
      projectId: "proj-test",
      runs: [run1, run2],
    });

    const edge = blueprint.edges.find((e) => e.source === "draft" && e.target === "review" && e.type === "workflow");
    expect(edge).toBeDefined();
    expect(edge!.frequency).toBe(2);
  });

  it("keeps not-yet-observed spec stages at frequency 0 alongside observed ones", () => {
    const run1 = makeSavedRun("run-1", stageEvents("run-1", "intake", "2026-06-01T10:00:00.000Z"));
    const blueprint = buildIntegrationBlueprint({
      integrationId: "integ-1",
      projectId: "proj-test",
      runs: [run1],
      workflowSpec: SPEC,
    });

    expect(blueprint.nodes.find((n) => n.id === "intake")!.frequency).toBe(1);
    expect(blueprint.nodes.find((n) => n.id === "draft")!.frequency).toBe(0);
    expect(blueprint.nodes.find((n) => n.id === "review")!.frequency).toBe(0);
  });
});

// ── Evidence aggregation ───────────────────────────────────────────────────────

describe("buildIntegrationBlueprint — evidence aggregation", () => {
  it("groups repeated model evidence by label across runs", () => {
    const modelEvent = (runId: string, ts: string): TraceEvent =>
      makeEvent(runId, {
        event_id: `${runId}-model`,
        event_type: "model_call_completed",
        node_id: "draft",
        timestamp: ts,
        metadata: { model_name: "claude-sonnet-4-6", model_provider: "anthropic" },
      });

    const run1 = makeSavedRun("run-1", [...stageEvents("run-1", "draft", "2026-06-01T10:00:00.000Z", [modelEvent("run-1", "2026-06-01T10:00:30.000Z")])]);
    const run2 = makeSavedRun("run-2", [...stageEvents("run-2", "draft", "2026-06-02T10:00:00.000Z", [modelEvent("run-2", "2026-06-02T10:00:30.000Z")])]);

    const blueprint = buildIntegrationBlueprint({
      integrationId: "integ-1",
      projectId: "proj-test",
      runs: [run1, run2],
    });

    const modelNodes = blueprint.nodes.filter((n) => n.type === "model");
    expect(modelNodes).toHaveLength(1);
    expect(modelNodes[0]!.label).toBe("claude-sonnet-4-6");
    expect(modelNodes[0]!.frequency).toBe(2);
    expect(modelNodes[0]!.commonMetadata).toEqual({ provider: "anthropic" });
    expect(modelNodes[0]!.role).toBe("evidence");
    expect(modelNodes[0]!.parentIds).toEqual(["draft"]);

    const draftStage = blueprint.nodes.find((n) => n.id === "draft")!;
    expect(draftStage.role).toBe("primary");
    expect(draftStage.parentIds).toBeUndefined();

    expect(blueprint.evidenceSummary.modelCount).toBe(1);
    expect(blueprint.evidenceSummary.topModels[0]).toEqual({ label: "claude-sonnet-4-6", count: 2 });

    const usesEdge = blueprint.edges.find((e) => e.source === "draft" && e.type === "uses" && e.target === modelNodes[0]!.id);
    expect(usesEdge).toBeDefined();
    expect(usesEdge!.frequency).toBe(2);
  });

  it("splits recovered issues into a recovery node distinct from failing issues", () => {
    const recoveredRunEvents: TraceEvent[] = [
      makeEvent("run-1", { event_id: "run-1-review-start", event_type: "node_started", node_id: "review", timestamp: "2026-06-01T10:00:00.000Z" }),
      makeEvent("run-1", { event_id: "run-1-review-fail", event_type: "node_failed", node_id: "review", timestamp: "2026-06-01T10:00:30.000Z", output_summary: "Source grounding check failed" }),
      makeEvent("run-1", { event_id: "run-1-review-retry", event_type: "retry_started", node_id: "review", timestamp: "2026-06-01T10:00:45.000Z" }),
      makeEvent("run-1", { event_id: "run-1-review-end", event_type: "node_completed", node_id: "review", timestamp: "2026-06-01T10:01:00.000Z" }),
    ];
    const run1 = makeSavedRun("run-1", recoveredRunEvents, { runPartial: { status: "degraded" } });

    const blueprint = buildIntegrationBlueprint({
      integrationId: "integ-1",
      projectId: "proj-test",
      runs: [run1],
    });

    const recoveryNodes = blueprint.nodes.filter((n) => n.type === "recovery");
    const issueNodes = blueprint.nodes.filter((n) => n.type === "issue");
    expect(recoveryNodes).toHaveLength(1);
    expect(issueNodes).toHaveLength(0);
    expect(blueprint.evidenceSummary.recoveryCount).toBe(1);
    expect(blueprint.healthSummary.recoveredCount).toBe(1);

    const review = blueprint.nodes.find((n) => n.id === "review")!;
    expect(review.statusSummary.recoveredRuns).toBe(1);
  });
});

// ── Health summary + common failure modes ─────────────────────────────────────

describe("buildIntegrationBlueprint — health summary", () => {
  it("counts completed/degraded/failed runs and last-seen timestamps", () => {
    const run1 = makeSavedRun("run-1", stageEvents("run-1", "draft", "2026-06-01T10:00:00.000Z"), {
      runPartial: { status: "completed", started_at: "2026-06-01T10:00:00.000Z", completed_at: "2026-06-01T10:05:00.000Z" },
    });
    const run2 = makeSavedRun("run-2", stageEvents("run-2", "draft", "2026-06-02T10:00:00.000Z"), {
      runPartial: { status: "failed", started_at: "2026-06-02T10:00:00.000Z", completed_at: "2026-06-02T10:05:00.000Z" },
    });

    const blueprint = buildIntegrationBlueprint({
      integrationId: "integ-1",
      projectId: "proj-test",
      runs: [run2, run1],
      lastEventAt: "2026-06-02T10:05:00.000Z",
    });

    expect(blueprint.healthSummary.runCount).toBe(2);
    expect(blueprint.healthSummary.completedCount).toBe(1);
    expect(blueprint.healthSummary.failedCount).toBe(1);
    expect(blueprint.healthSummary.lastRunAt).toBe("2026-06-02T10:05:00.000Z");
    expect(blueprint.healthSummary.lastEventAt).toBe("2026-06-02T10:05:00.000Z");
    expect(blueprint.runWindow.from).toBe("2026-06-01T10:00:00.000Z");
    expect(blueprint.runWindow.to).toBe("2026-06-02T10:05:00.000Z");
  });

  it("groups near-identical failure messages into one common failure mode", () => {
    const failEvent = (runId: string, ts: string): TraceEvent =>
      makeEvent(runId, {
        event_id: `${runId}-fail`,
        event_type: "node_failed",
        node_id: "review",
        timestamp: ts,
        output_summary: "  Source grounding check FAILED  ",
      });

    const run1 = makeSavedRun("run-1", [
      makeEvent("run-1", { event_id: "run-1-start", event_type: "node_started", node_id: "review", timestamp: "2026-06-01T10:00:00.000Z" }),
      failEvent("run-1", "2026-06-01T10:00:30.000Z"),
    ], { runPartial: { status: "failed" } });
    const run2 = makeSavedRun("run-2", [
      makeEvent("run-2", { event_id: "run-2-start", event_type: "node_started", node_id: "review", timestamp: "2026-06-02T10:00:00.000Z" }),
      failEvent("run-2", "2026-06-02T10:00:30.000Z"),
    ], { runPartial: { status: "failed" } });

    const blueprint = buildIntegrationBlueprint({
      integrationId: "integ-1",
      projectId: "proj-test",
      runs: [run1, run2],
    });

    expect(blueprint.healthSummary.commonFailureModes).toHaveLength(1);
    expect(blueprint.healthSummary.commonFailureModes[0]!.count).toBe(2);
  });
});

// ── Bounded run window ─────────────────────────────────────────────────────────

describe("buildIntegrationBlueprint — bounded run window", () => {
  it("only reflects the runs actually passed in, and reports them as generatedFromRunIds", () => {
    const runs = Array.from({ length: 3 }, (_, i) =>
      makeSavedRun(`run-${i}`, stageEvents(`run-${i}`, "draft", "2026-06-01T10:00:00.000Z")),
    );

    const blueprint = buildIntegrationBlueprint({
      integrationId: "integ-1",
      projectId: "proj-test",
      runs,
    });

    expect(blueprint.generatedFromRunIds).toEqual(["run-0", "run-1", "run-2"]);
    expect(blueprint.runWindow.count).toBe(3);
    expect(DEFAULT_BLUEPRINT_RUN_WINDOW).toBeGreaterThan(0);
  });
});

// ── Diagnostics summary ─────────────────────────────────────────────────────────

describe("buildIntegrationBlueprint — diagnostics summary", () => {
  it("summarizes provided diagnostics without inventing data when none are given", () => {
    const noDiagnostics = buildIntegrationBlueprint({
      integrationId: "integ-1",
      projectId: "proj-test",
      runs: [],
    });
    expect(noDiagnostics.diagnosticsSummary).toBeUndefined();

    const withDiagnostics = buildIntegrationBlueprint({
      integrationId: "integ-1",
      projectId: "proj-test",
      runs: [],
      diagnostics: [
        { category: "invalid_ingest_key", createdAt: "2026-06-01T10:00:00.000Z" },
        { category: "invalid_ingest_key", createdAt: "2026-06-01T10:05:00.000Z" },
        { category: "schema_validation_failed", createdAt: "2026-06-01T10:10:00.000Z" },
      ],
    });
    expect(withDiagnostics.diagnosticsSummary?.recentErrorCount).toBe(3);
    expect(withDiagnostics.diagnosticsSummary?.categories[0]).toEqual({ label: "invalid_ingest_key", count: 2 });
  });
});
