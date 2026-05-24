/**
 * Task 5 — Additional trace contract and schema tests.
 *
 * Covers:
 * - assertApprovalTrail
 * - assertToolCalls
 * - summarizeRun
 * - calculateRunCost / calculateRunLatency
 * - Updated TraceEvent status enum (running, degraded, blocked)
 * - ToolCallRecord schema validation
 * - EvalResult schema validation
 */

import { describe, expect, it } from "vitest";
import {
  assertApprovalTrail,
  assertToolCalls,
  summarizeRun,
  calculateRunCost,
  calculateRunLatency,
  validateTraceEvent,
} from "@/lib/proof-layer/index";
import {
  toolCallRecordSchema,
  evalResultSchema,
  runRecordSchema,
} from "@/lib/proof-layer/schemas";
import type { TraceEvent, EvalResult } from "@/lib/proof-layer/schemas";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    run_id: "run-tc-001",
    workflow_id: "wf-tc-001",
    timestamp: "2026-05-24T09:00:00.000Z",
    event_type: "run_started",
    ...overrides,
  };
}

function makeEval(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    eval_id: `eval-${Math.random().toString(36).slice(2)}`,
    run_id: "run-tc-001",
    name: "Test Eval",
    type: "output_quality",
    passed: true,
    severity: "info",
    findings: [],
    ...overrides,
  };
}

// ── TraceEvent status enum ─────────────────────────────────────────────────────

describe("TraceEvent status enum extensions", () => {
  it("accepts status: running", () => {
    expect(() => validateTraceEvent(makeEvent({ status: "running" }))).not.toThrow();
  });

  it("accepts status: degraded", () => {
    expect(() => validateTraceEvent(makeEvent({ status: "degraded" }))).not.toThrow();
  });

  it("accepts status: blocked", () => {
    expect(() => validateTraceEvent(makeEvent({ status: "blocked" }))).not.toThrow();
  });

  it("accepts status: started (legacy)", () => {
    expect(() => validateTraceEvent(makeEvent({ status: "started" }))).not.toThrow();
  });

  it("rejects unknown status", () => {
    expect(() => validateTraceEvent(makeEvent({ status: "unknown_status" as "running" }))).toThrow();
  });
});

// ── ToolCallRecord schema ──────────────────────────────────────────────────────

describe("ToolCallRecord schema validation", () => {
  it("valid record passes", () => {
    expect(() =>
      toolCallRecordSchema.parse({
        tool_call_id: "tc-001",
        run_id: "run-001",
        node_id: "tool-node",
        tool_name: "fetch_url",
        permission_class: "read_only",
        status: "completed",
        started_at: "2026-05-24T09:00:00.000Z",
        duration_ms: 500,
      })
    ).not.toThrow();
  });

  it("invalid permission_class fails", () => {
    expect(() =>
      toolCallRecordSchema.parse({
        tool_call_id: "tc-001",
        run_id: "run-001",
        node_id: "tool-node",
        tool_name: "fetch_url",
        permission_class: "invalid_class",
        status: "completed",
        started_at: "2026-05-24T09:00:00.000Z",
      })
    ).toThrow();
  });

  it("missing tool_call_id fails", () => {
    expect(() =>
      toolCallRecordSchema.parse({
        run_id: "run-001",
        node_id: "tool-node",
        tool_name: "fetch_url",
        permission_class: "read_only",
        status: "completed",
        started_at: "2026-05-24T09:00:00.000Z",
      })
    ).toThrow();
  });
});

// ── EvalResult schema ──────────────────────────────────────────────────────────

describe("EvalResult schema validation", () => {
  it("valid eval result passes", () => {
    expect(() =>
      evalResultSchema.parse({
        eval_id: "eval-001",
        run_id: "run-001",
        name: "Output Quality",
        type: "output_quality",
        passed: true,
        severity: "info",
        findings: ["Good output."],
      })
    ).not.toThrow();
  });

  it("invalid type fails", () => {
    expect(() =>
      evalResultSchema.parse({
        eval_id: "eval-001",
        run_id: "run-001",
        name: "Bad Eval",
        type: "not_a_real_type",
        passed: true,
        severity: "info",
        findings: [],
      })
    ).toThrow();
  });

  it("invalid severity fails", () => {
    expect(() =>
      evalResultSchema.parse({
        eval_id: "eval-001",
        run_id: "run-001",
        name: "Bad Eval",
        type: "output_quality",
        passed: true,
        severity: "low",
        findings: [],
      })
    ).toThrow();
  });
});

// ── RunRecord schema ───────────────────────────────────────────────────────────

describe("RunRecord schema validation", () => {
  it("valid run record passes", () => {
    expect(() =>
      runRecordSchema.parse({
        run_id: "run-001",
        workflow_id: "wf-001",
        project_id: "proj-001",
        project_name: "Test Project",
        status: "running",
        started_at: "2026-05-24T09:00:00.000Z",
        model_calls_count: 0,
        tool_calls_count: 0,
        evals_passed: 0,
        evals_failed: 0,
        artifact_refs: [],
        summary: "Test run.",
      })
    ).not.toThrow();
  });

  it("invalid status fails", () => {
    expect(() =>
      runRecordSchema.parse({
        run_id: "run-001",
        workflow_id: "wf-001",
        project_id: "proj-001",
        project_name: "Test Project",
        status: "unknown_status",
        started_at: "2026-05-24T09:00:00.000Z",
        model_calls_count: 0,
        tool_calls_count: 0,
        evals_passed: 0,
        evals_failed: 0,
        artifact_refs: [],
        summary: "Test run.",
      })
    ).toThrow();
  });
});

// ── assertApprovalTrail ────────────────────────────────────────────────────────

describe("assertApprovalTrail", () => {
  it("does not throw when no approval_requested events", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_type: "run_completed" }),
    ];
    expect(() => assertApprovalTrail(events)).not.toThrow();
  });

  it("does not throw when approval_requested has matching approval_granted", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_type: "approval_requested", node_id: "approval-gate" }),
      makeEvent({ event_type: "approval_granted", node_id: "approval-gate" }),
      makeEvent({ event_type: "run_completed" }),
    ];
    expect(() => assertApprovalTrail(events)).not.toThrow();
  });

  it("does not throw when approval_requested has matching approval_rejected", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_type: "approval_requested", node_id: "approval-gate" }),
      makeEvent({ event_type: "approval_rejected", node_id: "approval-gate" }),
    ];
    expect(() => assertApprovalTrail(events)).not.toThrow();
  });

  it("throws when approval_requested has no matching response", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_type: "approval_requested", node_id: "approval-gate" }),
      makeEvent({ event_type: "run_completed" }),
    ];
    expect(() => assertApprovalTrail(events)).toThrow();
  });
});

// ── assertToolCalls ────────────────────────────────────────────────────────────

describe("assertToolCalls", () => {
  it("does not throw when expected tool call is present", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({
        event_type: "tool_call_completed",
        status: "completed",
        metadata: { tool_name: "fetch_url", permission_class: "read_only" },
      }),
    ];
    expect(() =>
      assertToolCalls(events, [{ tool_name: "fetch_url", permission_class: "read_only" }])
    ).not.toThrow();
  });

  it("throws when expected tool is not found", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
    ];
    expect(() =>
      assertToolCalls(events, [{ tool_name: "missing_tool" }])
    ).toThrow();
  });
});

// ── summarizeRun ───────────────────────────────────────────────────────────────

describe("summarizeRun", () => {
  it("returns completed status for a successful run", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_type: "model_call_completed", cost_usd: 0.01 }),
      makeEvent({ event_type: "tool_call_completed" }),
      makeEvent({ event_type: "run_completed" }),
    ];
    const evals: EvalResult[] = [makeEval({ passed: true })];
    const summary = summarizeRun(events, evals);
    expect(summary.status).toBe("completed");
    expect(summary.modelCallsCount).toBe(1);
    expect(summary.toolCallsCount).toBe(1);
    expect(summary.evalsPassedCount).toBe(1);
    expect(summary.evalsFailedCount).toBe(0);
    expect(summary.totalCostUsd).toBeCloseTo(0.01);
  });

  it("returns failed for run_failed event", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_type: "run_failed" }),
    ];
    const summary = summarizeRun(events, []);
    expect(summary.status).toBe("failed");
  });

  it("returns degraded for failing (non-critical) evals", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_type: "run_completed" }),
    ];
    const evals: EvalResult[] = [makeEval({ passed: false, severity: "fail" })];
    const summary = summarizeRun(events, evals);
    expect(summary.status).toBe("degraded");
  });

  it("returns failed for critical eval failure", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_type: "run_completed" }),
    ];
    const evals: EvalResult[] = [makeEval({ passed: false, severity: "critical" })];
    const summary = summarizeRun(events, evals);
    expect(summary.status).toBe("failed");
  });

  it("detects hasApprovalRequired", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_type: "approval_requested" }),
      makeEvent({ event_type: "approval_granted" }),
      makeEvent({ event_type: "run_completed" }),
    ];
    const summary = summarizeRun(events, []);
    expect(summary.hasApprovalRequired).toBe(true);
  });
});

// ── calculateRunCost ───────────────────────────────────────────────────────────

describe("calculateRunCost", () => {
  it("sums cost_usd from model_call_completed and tool_call_completed", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "model_call_completed", cost_usd: 0.02 }),
      makeEvent({ event_type: "tool_call_completed", cost_usd: 0.005 }),
      makeEvent({ event_type: "run_completed" }),
    ];
    expect(calculateRunCost(events)).toBeCloseTo(0.025);
  });

  it("returns 0 when no cost_usd on any event", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_type: "run_completed" }),
    ];
    expect(calculateRunCost(events)).toBe(0);
  });
});

// ── calculateRunLatency ────────────────────────────────────────────────────────

describe("calculateRunLatency", () => {
  it("uses run_started + run_completed timestamps", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started", timestamp: "2026-05-24T09:00:00.000Z" }),
      makeEvent({ event_type: "run_completed", timestamp: "2026-05-24T09:00:10.000Z" }),
    ];
    expect(calculateRunLatency(events)).toBe(10000);
  });

  it("falls back to summing duration_ms when timestamps unavailable", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "node_started", duration_ms: 500 }),
      makeEvent({ event_type: "node_completed", duration_ms: 300 }),
    ];
    expect(calculateRunLatency(events)).toBe(800);
  });
});
