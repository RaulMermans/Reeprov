/**
 * Task 6 cleanup / Phase 1 regression tests.
 *
 * Tests the three cleanup fixes:
 *   1. eval_completed → EvalResult ingestion logic
 *   2. Campaign Sandbox FailRunInput uses error_summary
 *   3. Reconstruction types are well-formed
 */

import { describe, it, expect } from "vitest";
import type { TraceEvent } from "@/lib/proof-layer/schemas";
import { tryBuildEvalResultFromTraceEvent } from "@/lib/proof-layer/evalFromTrace";
import type { FailRunInput } from "../../examples/integrations/campaign-sandbox/agentpulse-client";

// ── 1. eval_completed → EvalResult conversion helper ─────────────────────────
// Tests import the production helper from lib/proof-layer/evalFromTrace.ts
// so this test exercises the same code path as POST /api/traces/events.

function makeEvent(
  meta: Record<string, unknown>,
  overrides: Partial<TraceEvent> = {},
): TraceEvent {
  return {
    event_id: "evt_test",
    run_id: "run-001",
    workflow_id: "wf_test",
    node_id: undefined,
    timestamp: "2025-01-01T00:00:00.000Z",
    event_type: "eval_completed",
    metadata: meta,
    ...overrides,
  };
}

describe("eval_completed → EvalResult conversion", () => {
  it("builds an EvalResult from a complete eval_completed metadata", () => {
    const event = makeEvent(
      {
        eval_id: "ev_route_quality",
        eval_name: "Route Quality Check",
        passed: true,
        score: 0.92,
        findings: ["Route A scored highest in reach."],
        severity: "info",
        type: "output_quality",
        recommendation: "Proceed to next stage.",
      },
      { node_id: "score-routes" },
    );
    const result = tryBuildEvalResultFromTraceEvent(event);
    expect(result).not.toBeNull();
    expect(result!.eval_id).toBe("ev_route_quality");
    expect(result!.name).toBe("Route Quality Check");
    expect(result!.passed).toBe(true);
    expect(result!.score).toBe(0.92);
    expect(result!.severity).toBe("info");
    expect(result!.type).toBe("output_quality");
    expect(result!.findings).toContain("Route A scored highest in reach.");
    expect(result!.run_id).toBe("run-001");
    expect(result!.node_id).toBe("score-routes");
  });

  it("returns null if eval_id is missing", () => {
    const event = makeEvent({ eval_name: "Some Eval", passed: true });
    expect(tryBuildEvalResultFromTraceEvent(event)).toBeNull();
  });

  it("returns null if eval_name is missing", () => {
    const event = makeEvent({ eval_id: "ev_001", passed: true });
    expect(tryBuildEvalResultFromTraceEvent(event)).toBeNull();
  });

  it("returns null for non-eval_completed event types", () => {
    const event = makeEvent(
      { eval_id: "ev_001", eval_name: "Some Eval" },
      { event_type: "node_completed" },
    );
    expect(tryBuildEvalResultFromTraceEvent(event)).toBeNull();
  });

  it("returns null when metadata is missing", () => {
    const event = makeEvent({});
    delete (event as Record<string, unknown>)["metadata"];
    expect(tryBuildEvalResultFromTraceEvent(event)).toBeNull();
  });

  it("infers severity=fail when passed=false and no severity provided", () => {
    const event = makeEvent({ eval_id: "ev_001", eval_name: "Safety Check", passed: false });
    const result = tryBuildEvalResultFromTraceEvent(event);
    expect(result!.severity).toBe("fail");
  });

  it("infers severity=info when passed=true and no severity provided", () => {
    const event = makeEvent({ eval_id: "ev_001", eval_name: "Safety Check", passed: true });
    const result = tryBuildEvalResultFromTraceEvent(event);
    expect(result!.severity).toBe("info");
  });

  it("uses output_quality as default type when unknown type is provided", () => {
    const event = makeEvent({
      eval_id: "ev_001",
      eval_name: "Custom Eval",
      type: "custom_unknown_type",
    });
    const result = tryBuildEvalResultFromTraceEvent(event);
    expect(result!.type).toBe("output_quality");
  });

  it("filters non-string findings", () => {
    const event = makeEvent({
      eval_id: "ev_001",
      eval_name: "Mixed Eval",
      findings: ["string finding", 42, null, "another finding"],
    });
    const result = tryBuildEvalResultFromTraceEvent(event);
    expect(result!.findings).toEqual(["string finding", "another finding"]);
  });

  it("handles missing optional fields gracefully", () => {
    const event = makeEvent({ eval_id: "ev_001", eval_name: "Bare Eval" });
    const result = tryBuildEvalResultFromTraceEvent(event);
    expect(result).not.toBeNull();
    expect(result!.score).toBeUndefined();
    expect(result!.recommendation).toBeUndefined();
    expect(result!.findings).toEqual([]);
  });
});

// ── 2. Campaign Sandbox FailRunInput uses error_summary ────────────────────────

describe("Campaign Sandbox FailRunInput", () => {
  it("uses error_summary field instead of summary", () => {
    // Type check: FailRunInput should have error_summary, not summary
    const input: FailRunInput = {
      run_id: "test-run",
      error_summary: "Something went wrong",
      error_code: "ERR_TIMEOUT",
    };
    expect(input.error_summary).toBe("Something went wrong");
    expect(input.run_id).toBe("test-run");
    // TypeScript would catch this at compile time — this is a runtime sanity check
    expect("summary" in input).toBe(false);
  });

  it("does not have a summary field on FailRunInput", () => {
    const input: FailRunInput = {
      run_id: "test-run",
      error_summary: "Error message",
    };
    // @ts-expect-error - summary should not be a valid field
    expect(() => { const _x = (input as unknown as Record<string, unknown>)["summary"]; void _x; }).not.toThrow();
    // The actual field check
    expect((input as unknown as Record<string, unknown>)["summary"]).toBeUndefined();
  });
});

// ── 3. Reconstruction types are well-formed ────────────────────────────────────

describe("Reconstruction types", () => {
  it("StaticProofReconstruction from reconstructFromScanReport has all required fields", async () => {
    const { reconstructFromScanReport } = await import("@/lib/reconstruction/reconstructWorkflowSpec");
    const minimalReport = {
      reportVersion: "2.0",
      reportId: "rpt_test_types",
      projectId: "proj_test_types",
      scanId: "rpt_test_types",
      scannerVersion: "agentpulse-static-scanner-v2",
      generatedAt: "2025-01-01T00:00:00.000Z",
      repoName: "type-check-repo",
      scannedAt: "2025-01-01T00:00:00.000Z",
      filesScanned: 1,
      ignoredFiles: 0,
      projectType: "unknown_ai_project" as const,
      detectedAgents: [],
      detectedWorkflowsDetailed: [],
      detectedCIWorkflows: [],
      detectedPrompts: [],
      detectedTools: [],
      detectedEvals: [],
      detectedTests: [],
      detectedWorkflows: [],
      findings: [],
      scores: {
        architecture: 50, promptQuality: 50, toolGovernance: 50,
        evalCoverage: 50, security: 80, documentation: 50,
        maintainability: 70, overall: 58,
      },
      recommendations: [],
    };

    const result = reconstructFromScanReport(minimalReport);

    // Required fields
    expect(typeof result.reconstructionId).toBe("string");
    expect(typeof result.reportId).toBe("string");
    expect(typeof result.projectId).toBe("string");
    expect(typeof result.generatedAt).toBe("string");
    expect(result.mode).toBe("static_inference");
    expect(["high", "medium", "low"]).toContain(result.confidence);
    expect(Array.isArray(result.workflowSpecs)).toBe(true);
    expect(result.systemGraph).toBeDefined();
    expect(Array.isArray(result.systemGraph.nodes)).toBe(true);
    expect(Array.isArray(result.systemGraph.edges)).toBe(true);
    expect(result.mappingSummary).toBeDefined();
    expect(Array.isArray(result.missingLinks)).toBe(true);
    expect(Array.isArray(result.suggestedFiles)).toBe(true);
    expect(result.instrumentationPlan).toBeDefined();
    expect(result.instrumentationPlan.required).toBe(false);
    expect(result.instrumentationPlan.available).toBe(true);
  });
});
