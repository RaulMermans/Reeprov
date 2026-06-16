/**
 * Tests for the run-intelligence helpers that power the visual run detail
 * dashboard: stage grouping, score normalization, duration derivation, issue
 * extraction, the BlogAgent visual stage ordering, artifact card building,
 * and the inferred-workflow fallback.
 *
 * These are pure-function tests — no rendering, no I/O, no LLM calls.
 */

import { describe, expect, it } from "vitest";
import type { EvalResult, RunRecord, TraceEvent, WorkflowNode } from "@/lib/proof-layer/schemas";
import {
  BLOGAGENT_STAGE_ORDER,
  buildArtifactCards,
  buildInferredWorkflowSummary,
  buildWorkflowMap,
  deriveEventDurationMs,
  deriveRunDurationMs,
  deriveRunStatusChip,
  extractRunIssues,
  groupTraceEventsIntoStages,
  normalizeScorePercent,
} from "@/lib/runs/runIntelligence";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function event(partial: Partial<TraceEvent> & Pick<TraceEvent, "event_id" | "event_type" | "timestamp">): TraceEvent {
  return {
    run_id: "run-1",
    workflow_id: "blog_generation",
    ...partial,
  };
}

function run(partial: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: "run-1",
    workflow_id: "blog_generation",
    project_id: "proj-blogagent",
    project_name: "Blog Agent",
    status: "completed",
    started_at: "2026-06-01T10:00:00.000Z",
    completed_at: "2026-06-01T10:05:00.000Z",
    model_calls_count: 4,
    tool_calls_count: 2,
    evals_passed: 3,
    evals_failed: 0,
    artifact_refs: [],
    summary: "Generated a blog article end-to-end.",
    ...partial,
  };
}

function evalResult(partial: Partial<EvalResult> & Pick<EvalResult, "eval_id" | "name" | "type">): EvalResult {
  return {
    run_id: "run-1",
    passed: true,
    severity: "info",
    findings: [],
    ...partial,
  };
}

// ── Duration derivation ───────────────────────────────────────────────────────

describe("deriveRunDurationMs", () => {
  it("uses total_duration_ms when present and positive", () => {
    expect(deriveRunDurationMs(run({ total_duration_ms: 12_345 }))).toBe(12_345);
  });

  it("derives duration from started_at/completed_at when total_duration_ms is missing", () => {
    const r = run({ total_duration_ms: undefined, started_at: "2026-06-01T10:00:00.000Z", completed_at: "2026-06-01T10:00:30.000Z" });
    expect(deriveRunDurationMs(r)).toBe(30_000);
  });

  it("derives duration from started_at/completed_at when total_duration_ms is zero", () => {
    const r = run({ total_duration_ms: 0, started_at: "2026-06-01T10:00:00.000Z", completed_at: "2026-06-01T10:01:00.000Z" });
    expect(deriveRunDurationMs(r)).toBe(60_000);
  });

  it("does not show 0ms when timestamps allow derivation", () => {
    const r = run({ total_duration_ms: 0, started_at: "2026-06-01T10:00:00.000Z", completed_at: "2026-06-01T10:00:01.000Z" });
    const derived = deriveRunDurationMs(r);
    expect(derived).toBeGreaterThan(0);
  });

  it("falls back to total_duration_ms when timestamps are missing", () => {
    const r = run({ total_duration_ms: 0, started_at: "2026-06-01T10:00:00.000Z", completed_at: undefined });
    expect(deriveRunDurationMs(r)).toBe(0);
  });
});

describe("deriveEventDurationMs", () => {
  it("uses duration_ms when present and positive", () => {
    expect(deriveEventDurationMs({ duration_ms: 500, metadata: undefined })).toBe(500);
  });

  it("falls back to metadata.latency_ms when duration_ms is missing", () => {
    expect(deriveEventDurationMs({ duration_ms: undefined, metadata: { latency_ms: 820 } })).toBe(820);
  });

  it("falls back to metadata.latency_ms when duration_ms is zero", () => {
    expect(deriveEventDurationMs({ duration_ms: 0, metadata: { latency_ms: 240 } })).toBe(240);
  });

  it("returns the original duration_ms when neither source is usable", () => {
    expect(deriveEventDurationMs({ duration_ms: 0, metadata: {} })).toBe(0);
  });
});

// ── Score normalization ───────────────────────────────────────────────────────

describe("normalizeScorePercent", () => {
  it("converts a fractional score (0.0-1.0) to a percentage", () => {
    expect(normalizeScorePercent(0.88)).toBe(88);
    expect(normalizeScorePercent(0.8)).toBe(80);
  });

  it("treats scores already greater than 1 as percentages, not fractions", () => {
    expect(normalizeScorePercent(80)).toBe(80);
    expect(normalizeScorePercent(88)).toBe(88);
  });

  it("never produces an inflated percentage like 8000% for 80", () => {
    expect(normalizeScorePercent(80)).not.toBe(8000);
    expect(normalizeScorePercent(88)).not.toBe(8800);
  });

  it("clamps to the 0-100 range", () => {
    expect(normalizeScorePercent(150)).toBe(100);
    expect(normalizeScorePercent(-5)).toBe(0);
  });

  it("rounds to the nearest whole percent", () => {
    expect(normalizeScorePercent(0.873)).toBe(87);
    expect(normalizeScorePercent(0.876)).toBe(88);
  });
});

// ── Issue extraction ──────────────────────────────────────────────────────────

describe("extractRunIssues", () => {
  it("extracts issues from error-shaped trace events with stage labels and messages", () => {
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "node_started", node_id: "draft_writing", timestamp: "2026-06-01T10:00:00.000Z" }),
      event({
        event_id: "e2",
        event_type: "tool_call_failed",
        node_id: "draft_writing",
        timestamp: "2026-06-01T10:00:05.000Z",
        output_summary: "Tool 'web_search' timed out after 30s.",
      }),
    ];

    const issues = extractRunIssues(events, []);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe("e2");
    expect(issues[0].stageId).toBe("draft_writing");
    expect(issues[0].message).toBe("Tool 'web_search' timed out after 30s.");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].source).toBe("trace_event");
    expect(issues[0].recommendedFix).toBeTruthy();
  });

  it("marks node_failed events as critical severity", () => {
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "node_failed", node_id: "extract_webpages", timestamp: "2026-06-01T10:00:00.000Z" }),
    ];
    const issues = extractRunIssues(events, []);
    expect(issues[0].severity).toBe("critical");
  });

  it("marks an issue as recovered when a later completion event occurs on the same stage", () => {
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "tool_call_failed", node_id: "extract_webpages", timestamp: "2026-06-01T10:00:00.000Z" }),
      event({ event_id: "e2", event_type: "retry_started", node_id: "extract_webpages", timestamp: "2026-06-01T10:00:05.000Z" }),
      event({ event_id: "e3", event_type: "tool_call_completed", node_id: "extract_webpages", timestamp: "2026-06-01T10:00:10.000Z" }),
    ];
    const issues = extractRunIssues(events, []);
    expect(issues[0].recovered).toBe(true);
  });

  it("does not mark an issue as recovered when no later completion event exists for the stage", () => {
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "node_failed", node_id: "draft_writing", timestamp: "2026-06-01T10:00:00.000Z" }),
    ];
    const issues = extractRunIssues(events, []);
    expect(issues[0].recovered).toBe(false);
  });

  it("uses spec node labels for stage names when available", () => {
    const specNodes: WorkflowNode[] = [{ id: "draft_writing", type: "llm", label: "Draft Writing" }];
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "error", node_id: "draft_writing", timestamp: "2026-06-01T10:00:00.000Z" }),
    ];
    const issues = extractRunIssues(events, [], specNodes);
    expect(issues[0].stageLabel).toBe("Draft Writing");
  });

  it("includes failing and critical eval results as issues with recommendations", () => {
    const evalResults: EvalResult[] = [
      evalResult({
        eval_id: "ev1",
        name: "Source grounding",
        type: "source_grounding",
        passed: false,
        severity: "warning",
        findings: ["Claim 3 lacks a cited source."],
        recommendation: "Add a citation for claim 3 before publishing.",
      }),
    ];
    const issues = extractRunIssues([], evalResults);
    expect(issues).toHaveLength(1);
    expect(issues[0].source).toBe("eval_result");
    expect(issues[0].message).toBe("Claim 3 lacks a cited source.");
    expect(issues[0].recommendedFix).toBe("Add a citation for claim 3 before publishing.");
  });

  it("excludes passing, non-critical eval results", () => {
    const evalResults: EvalResult[] = [
      evalResult({ eval_id: "ev1", name: "Schema validity", type: "schema_validity", passed: true, severity: "info" }),
    ];
    expect(extractRunIssues([], evalResults)).toHaveLength(0);
  });

  it("returns an empty list for a clean run", () => {
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "run_started", timestamp: "2026-06-01T10:00:00.000Z" }),
      event({ event_id: "e2", event_type: "run_completed", timestamp: "2026-06-01T10:05:00.000Z" }),
    ];
    expect(extractRunIssues(events, [])).toHaveLength(0);
  });
});

// ── Stage grouping ────────────────────────────────────────────────────────────

describe("groupTraceEventsIntoStages", () => {
  it("groups trace events by node_id into ordered stage cards", () => {
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "node_started", node_id: "outline_generation", timestamp: "2026-06-01T10:00:00.000Z", input_summary: "Plan article outline" }),
      event({ event_id: "e2", event_type: "model_call_completed", node_id: "outline_generation", timestamp: "2026-06-01T10:00:05.000Z" }),
      event({ event_id: "e3", event_type: "node_completed", node_id: "outline_generation", timestamp: "2026-06-01T10:00:10.000Z", output_summary: "Outline with 5 sections produced" }),
      event({ event_id: "e4", event_type: "node_started", node_id: "draft_writing", timestamp: "2026-06-01T10:00:15.000Z" }),
    ];

    const { stages, unassignedEvents } = groupTraceEventsIntoStages(events);
    expect(stages.map((s) => s.id)).toEqual(["outline_generation", "draft_writing"]);
    expect(unassignedEvents).toHaveLength(0);

    const outline = stages[0];
    expect(outline.label).toBe("Outline Generation");
    expect(outline.status).toBe("completed");
    expect(outline.modelCallCount).toBe(1);
    expect(outline.inputSummary).toBe("Plan article outline");
    expect(outline.outputSummary).toBe("Outline with 5 sections produced");
    expect(outline.events).toHaveLength(3);
  });

  it("separates events without a node_id into unassignedEvents", () => {
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "run_started", timestamp: "2026-06-01T10:00:00.000Z" }),
      event({ event_id: "e2", event_type: "node_started", node_id: "draft_writing", timestamp: "2026-06-01T10:00:01.000Z" }),
    ];
    const { stages, unassignedEvents } = groupTraceEventsIntoStages(events);
    expect(stages).toHaveLength(1);
    expect(unassignedEvents.map((e) => e.event_id)).toEqual(["e1"]);
  });

  it("marks a stage as failed when it errors without completing", () => {
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "node_started", node_id: "extract_webpages", timestamp: "2026-06-01T10:00:00.000Z" }),
      event({ event_id: "e2", event_type: "node_failed", node_id: "extract_webpages", timestamp: "2026-06-01T10:00:05.000Z" }),
    ];
    const { stages } = groupTraceEventsIntoStages(events);
    expect(stages[0].status).toBe("failed");
  });

  it("marks a stage as warning when it fails then recovers and completes", () => {
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "node_started", node_id: "extract_webpages", timestamp: "2026-06-01T10:00:00.000Z" }),
      event({ event_id: "e2", event_type: "tool_call_failed", node_id: "extract_webpages", timestamp: "2026-06-01T10:00:05.000Z" }),
      event({ event_id: "e3", event_type: "node_completed", node_id: "extract_webpages", timestamp: "2026-06-01T10:00:10.000Z" }),
    ];
    const { stages } = groupTraceEventsIntoStages(events);
    expect(stages[0].status).toBe("warning");
  });

  it("derives stage duration from node_started/node_completed timestamps", () => {
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "node_started", node_id: "score_sources", timestamp: "2026-06-01T10:00:00.000Z" }),
      event({ event_id: "e2", event_type: "node_completed", node_id: "score_sources", timestamp: "2026-06-01T10:00:12.000Z" }),
    ];
    const { stages } = groupTraceEventsIntoStages(events);
    expect(stages[0].durationMs).toBe(12_000);
  });

  it("uses spec node labels when a matching WorkflowSpec node is provided", () => {
    const specNodes: WorkflowNode[] = [{ id: "draft_writing", type: "llm", label: "Draft the article" }];
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "node_started", node_id: "draft_writing", timestamp: "2026-06-01T10:00:00.000Z" }),
    ];
    const { stages } = groupTraceEventsIntoStages(events, specNodes);
    expect(stages[0].label).toBe("Draft the article");
  });
});

// ── BlogAgent visual stage ordering ───────────────────────────────────────────

describe("buildWorkflowMap — BlogAgent visual ordering", () => {
  it("exposes the canonical BlogAgent stage order", () => {
    expect(BLOGAGENT_STAGE_ORDER).toEqual([
      "intake_request_parsing",
      "generate_research_questions",
      "topic_product_research",
      "extract_webpages",
      "score_sources",
      "outline_generation",
      "draft_writing",
      "seo_optimization",
      "reviewer_critic_pass",
      "final_article_packaging",
    ]);
  });

  it("orders observed BlogAgent stages canonically even when the trace arrives out of order", () => {
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "node_started", node_id: "draft_writing", timestamp: "2026-06-01T10:02:00.000Z" }),
      event({ event_id: "e2", event_type: "node_completed", node_id: "draft_writing", timestamp: "2026-06-01T10:02:10.000Z" }),
      event({ event_id: "e3", event_type: "node_started", node_id: "intake_request_parsing", timestamp: "2026-06-01T10:00:00.000Z" }),
      event({ event_id: "e4", event_type: "node_completed", node_id: "intake_request_parsing", timestamp: "2026-06-01T10:00:05.000Z" }),
    ];
    const { stages } = groupTraceEventsIntoStages(events);
    const nodes = buildWorkflowMap(stages);

    expect(nodes.map((n) => n.id)).toEqual(BLOGAGENT_STAGE_ORDER);
    expect(nodes.find((n) => n.id === "intake_request_parsing")?.status).toBe("completed");
    expect(nodes.find((n) => n.id === "draft_writing")?.status).toBe("completed");
  });

  it("marks BlogAgent stages that were never observed as not_observed (gray)", () => {
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "node_started", node_id: "intake_request_parsing", timestamp: "2026-06-01T10:00:00.000Z" }),
      event({ event_id: "e2", event_type: "node_completed", node_id: "intake_request_parsing", timestamp: "2026-06-01T10:00:05.000Z" }),
    ];
    const { stages } = groupTraceEventsIntoStages(events);
    const nodes = buildWorkflowMap(stages);

    expect(nodes.find((n) => n.id === "final_article_packaging")?.status).toBe("not_observed");
  });

  it("prefers the registered WorkflowSpec node order over the canonical BlogAgent order", () => {
    const specNodes: WorkflowNode[] = [
      { id: "draft_writing", type: "llm", label: "Draft" },
      { id: "intake_request_parsing", type: "trigger", label: "Intake" },
    ];
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "node_started", node_id: "intake_request_parsing", timestamp: "2026-06-01T10:00:00.000Z" }),
      event({ event_id: "e2", event_type: "node_completed", node_id: "intake_request_parsing", timestamp: "2026-06-01T10:00:05.000Z" }),
    ];
    const { stages } = groupTraceEventsIntoStages(events, specNodes);
    const nodes = buildWorkflowMap(stages, specNodes);

    expect(nodes.map((n) => n.id)).toEqual(["draft_writing", "intake_request_parsing"]);
    expect(nodes[0].status).toBe("not_observed");
    expect(nodes[1].status).toBe("completed");
  });

  it("does not append internal non-canonical nodes to the BlogAgent pipeline map", () => {
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "node_started", node_id: "draft_writing", timestamp: "2026-06-01T10:00:00.000Z" }),
      event({ event_id: "e2", event_type: "node_completed", node_id: "draft_writing", timestamp: "2026-06-01T10:00:10.000Z" }),
      event({ event_id: "e3", event_type: "node_started", node_id: "build_query_contract_node", timestamp: "2026-06-01T10:00:15.000Z" }),
      event({ event_id: "e4", event_type: "node_completed", node_id: "build_query_contract_node", timestamp: "2026-06-01T10:00:20.000Z" }),
    ];
    const { stages } = groupTraceEventsIntoStages(events);
    const nodes = buildWorkflowMap(stages);

    expect(nodes.map((n) => n.id)).toEqual(BLOGAGENT_STAGE_ORDER);
    expect(nodes.find((n) => n.id === "build_query_contract_node")).toBeUndefined();
  });

  it("falls back to chronological observation order for non-BlogAgent workflows", () => {
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "node_started", node_id: "fetch_campaign_data", timestamp: "2026-06-01T10:00:00.000Z" }),
      event({ event_id: "e2", event_type: "node_started", node_id: "generate_creative", timestamp: "2026-06-01T10:01:00.000Z" }),
    ];
    const { stages } = groupTraceEventsIntoStages(events);
    const nodes = buildWorkflowMap(stages);
    expect(nodes.map((n) => n.id)).toEqual(["fetch_campaign_data", "generate_creative"]);
  });
});

// ── Run status chip ───────────────────────────────────────────────────────────

describe("deriveRunStatusChip", () => {
  it("labels a clean completed run with artifacts and no approval requirement as publish-ready", () => {
    const chip = deriveRunStatusChip(run({ status: "completed", approval_status: undefined }), [], 1);
    expect(chip.label).toBe("publish-ready");
  });

  it("labels a degraded run as warning", () => {
    const chip = deriveRunStatusChip(run({ status: "degraded" }), [], 1);
    expect(chip.label).toBe("warning");
  });

  it("labels a run with recovered (but no unrecovered) issues as recovered", () => {
    const issues = [{ id: "i1", stageLabel: "Draft Writing", message: "retry", severity: "warning" as const, recovered: true, source: "trace_event" as const }];
    const chip = deriveRunStatusChip(run({ status: "completed" }), issues, 1);
    expect(chip.label).toBe("recovered");
  });

  it("labels a failed run as failed regardless of issues", () => {
    const chip = deriveRunStatusChip(run({ status: "failed" }), [], 0);
    expect(chip.label).toBe("failed");
  });
});

// ── Artifact cards ────────────────────────────────────────────────────────────

describe("buildArtifactCards", () => {
  it("builds a markdown article card with title, type, size, and preview from artifact_created metadata", () => {
    const events: TraceEvent[] = [
      event({
        event_id: "e1",
        event_type: "artifact_created",
        node_id: "final_article_packaging",
        timestamp: "2026-06-01T10:05:00.000Z",
        metadata: {
          artifact_ref: "article_markdown",
          artifact_type: "article_markdown",
          title: "10 Tips for Better Sleep",
          size_bytes: 4096,
          preview: "# 10 Tips for Better Sleep\n\nGetting good sleep...",
        },
      }),
    ];

    const cards = buildArtifactCards(events);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.ref).toBe("article_markdown");
    expect(card.title).toBe("10 Tips for Better Sleep");
    expect(card.artifactType).toBe("article_markdown");
    expect(card.sizeLabel).toBe("4.0 KB");
    expect(card.preview).toContain("10 Tips for Better Sleep");
    expect(card.isMarkdownArticle).toBe(true);
  });

  it("does not flag non-markdown artifact types as markdown articles", () => {
    const events: TraceEvent[] = [
      event({
        event_id: "e1",
        event_type: "artifact_created",
        timestamp: "2026-06-01T10:05:00.000Z",
        metadata: { artifact_ref: "audit-report", artifact_type: "pdf_report" },
      }),
    ];
    const cards = buildArtifactCards(events);
    expect(cards[0].isMarkdownArticle).toBe(false);
  });

  it("falls back to run.artifact_refs when no artifact_created events carry that ref", () => {
    const cards = buildArtifactCards([], ["audit-report"]);
    expect(cards).toHaveLength(1);
    expect(cards[0].ref).toBe("audit-report");
    expect(cards[0].isMarkdownArticle).toBe(false);
  });

  it("does not duplicate a ref present in both events and fallbackRefs", () => {
    const events: TraceEvent[] = [
      event({
        event_id: "e1",
        event_type: "artifact_created",
        timestamp: "2026-06-01T10:05:00.000Z",
        metadata: { artifact_ref: "article_markdown" },
      }),
    ];
    const cards = buildArtifactCards(events, ["article_markdown"]);
    expect(cards).toHaveLength(1);
  });
});

// ── Inferred WorkflowSpec fallback ────────────────────────────────────────────

describe("buildInferredWorkflowSummary", () => {
  it("returns an inferred summary describing the observed stage count when no spec is registered", () => {
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "node_started", node_id: "draft_writing", timestamp: "2026-06-01T10:00:00.000Z" }),
      event({ event_id: "e2", event_type: "node_started", node_id: "seo_optimization", timestamp: "2026-06-01T10:01:00.000Z" }),
    ];
    const { stages } = groupTraceEventsIntoStages(events);
    const summary = buildInferredWorkflowSummary(stages);

    expect(summary).not.toBeNull();
    expect(summary?.inferred).toBe(true);
    expect(summary?.stageCount).toBe(2);
    expect(summary?.message).toContain("Workflow inferred from run events");
    expect(summary?.message).toContain("2 stages observed");
  });

  it("returns null when there are no observed stages (nothing to infer)", () => {
    expect(buildInferredWorkflowSummary([])).toBeNull();
  });

  it("uses singular phrasing for a single observed stage", () => {
    const events: TraceEvent[] = [
      event({ event_id: "e1", event_type: "node_started", node_id: "draft_writing", timestamp: "2026-06-01T10:00:00.000Z" }),
    ];
    const { stages } = groupTraceEventsIntoStages(events);
    const summary = buildInferredWorkflowSummary(stages);
    expect(summary?.message).toContain("1 stage observed");
  });
});
