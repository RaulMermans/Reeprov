import { describe, expect, it } from "vitest";
import {
  validateWorkflowSpec,
  validateTraceEvent,
  clearEmittedEvents,
  emitTraceEvent,
  getEmittedEvents,
  assertTraceContract,
  assertRequiredEvents,
  classifyFailure,
} from "@/lib/proof-layer/index";
import type { TraceEvent, EvalResult } from "@/lib/proof-layer/schemas";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    event_id: "evt-test-001",
    run_id: "run-test-001",
    workflow_id: "wf-test-001",
    timestamp: "2026-05-20T09:00:00.000Z",
    event_type: "run_started",
    ...overrides,
  };
}

function makeEvalResult(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    eval_id: "eval-test-001",
    run_id: "run-test-001",
    name: "Test Eval",
    type: "output_quality",
    passed: true,
    severity: "info",
    findings: [],
    ...overrides,
  };
}

// ── WorkflowSpec validation ────────────────────────────────────────────────

describe("WorkflowSpec validation", () => {
  it("valid minimal workflow passes", () => {
    const spec = {
      workflow_id: "wf-001",
      name: "Minimal Workflow",
      architecture_type: "single_llm_call",
      nodes: [
        { id: "trigger", type: "trigger", label: "Trigger" },
      ],
    };
    expect(() => validateWorkflowSpec(spec)).not.toThrow();
  });

  it("valid workflow with all fields passes", () => {
    const spec = {
      workflow_id: "wf-full-001",
      name: "Full Workflow",
      version: "1.0.0",
      description: "A complete workflow spec.",
      architecture_type: "deterministic_workflow",
      nodes: [
        { id: "trigger", type: "trigger", label: "Trigger" },
        {
          id: "llm-node",
          type: "llm",
          label: "LLM Call",
          model_provider: "anthropic",
          model_name: "claude-3-5-haiku-20241022",
          permission_class: "read_only",
          timeout_ms: 10000,
          max_retries: 2,
          eval_refs: ["output_quality"],
        },
        { id: "artifact", type: "artifact", label: "Output" },
      ],
      edges: [
        { from: "trigger", to: "llm-node" },
        { from: "llm-node", to: "artifact" },
      ],
      evals: ["output_quality"],
      artifacts: ["output.md"],
    };
    expect(() => validateWorkflowSpec(spec)).not.toThrow();
  });

  it("missing workflow_id fails", () => {
    const spec = {
      name: "No ID Workflow",
      architecture_type: "single_llm_call",
      nodes: [{ id: "trigger", type: "trigger", label: "Trigger" }],
    };
    expect(() => validateWorkflowSpec(spec)).toThrow();
  });

  it("unknown node type fails", () => {
    const spec = {
      workflow_id: "wf-002",
      name: "Bad Node Type",
      architecture_type: "single_llm_call",
      nodes: [{ id: "trigger", type: "unknown_type", label: "Trigger" }],
    };
    expect(() => validateWorkflowSpec(spec)).toThrow();
  });

  it("edge referencing missing node ID fails", () => {
    const spec = {
      workflow_id: "wf-003",
      name: "Bad Edge",
      architecture_type: "prompt_chain",
      nodes: [
        { id: "trigger", type: "trigger", label: "Trigger" },
        { id: "llm-node", type: "llm", label: "LLM" },
      ],
      edges: [
        { from: "trigger", to: "non-existent-node" },
      ],
    };
    expect(() => validateWorkflowSpec(spec)).toThrow();
  });

  it("workflow with destructive node and no approval node fails", () => {
    const spec = {
      workflow_id: "wf-004",
      name: "Destructive No Approval",
      architecture_type: "deterministic_workflow",
      nodes: [
        { id: "trigger", type: "trigger", label: "Trigger" },
        {
          id: "delete-node",
          type: "tool",
          label: "Delete Records",
          permission_class: "destructive",
        },
      ],
    };
    expect(() => validateWorkflowSpec(spec)).toThrow();
  });

  it("workflow with destructive node and approval node passes", () => {
    const spec = {
      workflow_id: "wf-005",
      name: "Destructive With Approval",
      architecture_type: "deterministic_workflow",
      nodes: [
        { id: "trigger", type: "trigger", label: "Trigger" },
        {
          id: "delete-node",
          type: "tool",
          label: "Delete Records",
          permission_class: "destructive",
        },
        { id: "approval-gate", type: "approval", label: "Approval Gate" },
      ],
      edges: [
        { from: "trigger", to: "approval-gate" },
        { from: "approval-gate", to: "delete-node" },
      ],
    };
    expect(() => validateWorkflowSpec(spec)).not.toThrow();
  });
});

// ── TraceEvent validation ──────────────────────────────────────────────────

describe("TraceEvent validation", () => {
  it("valid trace event passes", () => {
    const event = makeEvent();
    expect(() => validateTraceEvent(event)).not.toThrow();
  });

  it("missing event_id fails", () => {
    const event = {
      run_id: "run-001",
      workflow_id: "wf-001",
      timestamp: "2026-05-20T09:00:00.000Z",
      event_type: "run_started",
    };
    expect(() => validateTraceEvent(event)).toThrow();
  });

  it("unknown event_type fails", () => {
    const event = {
      event_id: "evt-001",
      run_id: "run-001",
      workflow_id: "wf-001",
      timestamp: "2026-05-20T09:00:00.000Z",
      event_type: "not_a_real_event",
    };
    expect(() => validateTraceEvent(event)).toThrow();
  });
});

// ── Trace event emission ──────────────────────────────────────────────────

describe("emitTraceEvent", () => {
  it("validates, stores, and returns the validated event", () => {
    clearEmittedEvents();
    const event = makeEvent({ event_id: "evt-emit-valid" });

    const emitted = emitTraceEvent(event);

    expect(emitted).toEqual(event);
    expect(getEmittedEvents()).toEqual([event]);
  });

  it("throws for invalid events and leaves the buffer unchanged", () => {
    clearEmittedEvents();

    expect(() => emitTraceEvent({ event_id: "evt-invalid" })).toThrow();
    expect(getEmittedEvents()).toEqual([]);
  });
});

// ── Trace contract ─────────────────────────────────────────────────────────

describe("assertTraceContract", () => {
  it("complete successful run passes contract", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_id: "evt-002", event_type: "run_completed", status: "completed" }),
    ];
    const result = assertTraceContract(events);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("successful trace without run_completed fails with run_completed_required", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
    ];
    const result = assertTraceContract(events);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.rule === "run_completed_required")).toBe(true);
  });

  it("run missing run_started fails with run_started_required violation", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_id: "evt-002", event_type: "run_completed", status: "completed" }),
    ];
    const result = assertTraceContract(events);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.rule === "run_started_required")).toBe(true);
  });

  it("failed run with run_failed but no error event fails with failed_run_error_required", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_id: "evt-002", event_type: "run_failed", status: "failed" }),
    ];
    const result = assertTraceContract(events);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.rule === "failed_run_error_required")).toBe(true);
  });

  it("failed run with run_failed and error event passes that rule", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_id: "evt-err", event_type: "error" }),
      makeEvent({ event_id: "evt-002", event_type: "run_failed", status: "failed" }),
    ];
    const result = assertTraceContract(events);
    const failedRunViolation = result.violations.some(
      v => v.rule === "failed_run_error_required"
    );
    expect(failedRunViolation).toBe(false);
  });

  it("failure events without run_failed fail with run_failed_required", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_id: "evt-error", event_type: "error" }),
    ];
    const result = assertTraceContract(events);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.rule === "run_failed_required")).toBe(true);
  });

  it("run_completed and run_failed together require degraded or partial metadata", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_id: "evt-error", event_type: "error" }),
      makeEvent({ event_id: "evt-failed", event_type: "run_failed" }),
      makeEvent({ event_id: "evt-completed", event_type: "run_completed" }),
    ];
    const result = assertTraceContract(events);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.rule === "terminal_conflict_requires_degraded_metadata")).toBe(true);
  });

  it("run_completed and run_failed can coexist when marked partial", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_id: "evt-error", event_type: "error" }),
      makeEvent({ event_id: "evt-failed", event_type: "run_failed" }),
      makeEvent({
        event_id: "evt-completed",
        event_type: "run_completed",
        metadata: { partial: true },
      }),
    ];
    const result = assertTraceContract(events);
    expect(result.violations.some(v => v.rule === "terminal_conflict_requires_degraded_metadata")).toBe(false);
  });

  it("tool_call_started with matching tool_call_completed passes", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({
        event_id: "evt-tool-start",
        event_type: "tool_call_started",
        node_id: "tool-node",
        metadata: { tool_name: "fetch_page" },
      }),
      makeEvent({
        event_id: "evt-tool-complete",
        event_type: "tool_call_completed",
        node_id: "tool-node",
        status: "completed",
        metadata: { tool_name: "fetch_page" },
      }),
      makeEvent({ event_id: "evt-complete", event_type: "run_completed" }),
    ];
    const result = assertTraceContract(events);
    const toolViolation = result.violations.some(
      v => v.rule === "tool_call_completion_required"
    );
    expect(toolViolation).toBe(false);
  });

  it("matches multiple tool calls from the same node by metadata.tool_call_id", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({
        event_id: "evt-tool-a-start",
        event_type: "tool_call_started",
        node_id: "tool-node",
        metadata: { tool_call_id: "tool-a", tool_name: "fetch_page" },
      }),
      makeEvent({
        event_id: "evt-tool-b-start",
        event_type: "tool_call_started",
        node_id: "tool-node",
        metadata: { tool_call_id: "tool-b", tool_name: "fetch_page" },
      }),
      makeEvent({
        event_id: "evt-tool-b-complete",
        event_type: "tool_call_completed",
        node_id: "tool-node",
        status: "completed",
        metadata: { tool_call_id: "tool-b", tool_name: "fetch_page" },
      }),
      makeEvent({
        event_id: "evt-tool-a-complete",
        event_type: "tool_call_completed",
        node_id: "tool-node",
        status: "completed",
        metadata: { tool_call_id: "tool-a", tool_name: "fetch_page" },
      }),
      makeEvent({ event_id: "evt-complete", event_type: "run_completed" }),
    ];
    const result = assertTraceContract(events);
    expect(result.passed).toBe(true);
  });

  it("does not let one tool completion satisfy a different tool_call_id", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({
        event_id: "evt-tool-a-start",
        event_type: "tool_call_started",
        node_id: "tool-node",
        metadata: { tool_call_id: "tool-a", tool_name: "fetch_page" },
      }),
      makeEvent({
        event_id: "evt-tool-b-complete",
        event_type: "tool_call_completed",
        node_id: "tool-node",
        status: "completed",
        metadata: { tool_call_id: "tool-b", tool_name: "fetch_page" },
      }),
      makeEvent({ event_id: "evt-complete", event_type: "run_completed" }),
    ];
    const result = assertTraceContract(events);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.rule === "tool_call_completion_required")).toBe(true);
  });

  it("tool_call_started without matching completion fails with tool_call_completion_required", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({
        event_id: "evt-tool-start",
        event_type: "tool_call_started",
        node_id: "tool-node",
      }),
      makeEvent({ event_id: "evt-complete", event_type: "run_completed" }),
    ];
    const result = assertTraceContract(events);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.rule === "tool_call_completion_required")).toBe(true);
  });

  it("eval_completed without metadata.passed fails with eval_pass_fail_required", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({
        event_id: "evt-eval",
        event_type: "eval_completed",
        node_id: "evaluator",
        metadata: { eval_name: "test-eval" },
      }),
      makeEvent({ event_id: "evt-complete", event_type: "run_completed" }),
    ];
    const result = assertTraceContract(events);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.rule === "eval_pass_fail_required")).toBe(true);
  });

  it("eval_completed with metadata.passed: true passes that rule", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({
        event_id: "evt-eval",
        event_type: "eval_completed",
        node_id: "evaluator",
        metadata: { passed: true, eval_name: "test-eval" },
      }),
      makeEvent({ event_id: "evt-complete", event_type: "run_completed" }),
    ];
    const result = assertTraceContract(events);
    const evalViolation = result.violations.some(
      v => v.rule === "eval_pass_fail_required"
    );
    expect(evalViolation).toBe(false);
  });
});

// ── assertRequiredEvents ───────────────────────────────────────────────────

describe("assertRequiredEvents", () => {
  it("does not throw when all required types are present", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_id: "evt-002", event_type: "run_completed" }),
    ];
    expect(() =>
      assertRequiredEvents(events, ["run_started", "run_completed"])
    ).not.toThrow();
  });

  it("throws when a required type is missing", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
    ];
    expect(() =>
      assertRequiredEvents(events, ["run_started", "run_completed"])
    ).toThrow();
  });
});

// ── classifyFailure ────────────────────────────────────────────────────────

describe("classifyFailure", () => {
  it("no failing evals returns failureType none and severity none", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_id: "evt-002", event_type: "run_completed" }),
    ];
    const evals: EvalResult[] = [
      makeEvalResult({ passed: true, severity: "info" }),
    ];
    const result = classifyFailure(events, evals);
    expect(result.failureType).toBe("none");
    expect(result.severity).toBe("none");
  });

  it("failing eval with severity fail returns eval_failure and degraded", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_id: "evt-002", event_type: "run_completed" }),
    ];
    const evals: EvalResult[] = [
      makeEvalResult({
        passed: false,
        severity: "fail",
        name: "Output Quality",
        type: "output_quality",
      }),
    ];
    const result = classifyFailure(events, evals);
    expect(result.failureType).toBe("eval_failure");
    expect(result.severity).toBe("degraded");
  });

  it("failing eval with severity critical and type safety returns eval_failure and critical", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({ event_id: "evt-002", event_type: "run_completed" }),
    ];
    const evals: EvalResult[] = [
      makeEvalResult({
        passed: false,
        severity: "critical",
        type: "safety",
        name: "Safety Check",
      }),
    ];
    const result = classifyFailure(events, evals);
    expect(result.failureType).toBe("eval_failure");
    expect(result.severity).toBe("critical");
  });

  it("approval_rejected event returns approval_rejected and degraded", () => {
    const events: TraceEvent[] = [
      makeEvent({ event_type: "run_started" }),
      makeEvent({
        event_id: "evt-approval-req",
        event_type: "approval_requested",
        node_id: "approval-gate",
      }),
      makeEvent({
        event_id: "evt-approval-rejected",
        event_type: "approval_rejected",
        node_id: "approval-gate",
      }),
    ];
    const evals: EvalResult[] = [];
    const result = classifyFailure(events, evals);
    expect(result.failureType).toBe("approval_rejected");
    expect(result.severity).toBe("degraded");
  });
});
