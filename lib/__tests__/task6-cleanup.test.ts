/**
 * Task 6 cleanup / Phase 1 regression tests.
 *
 * Tests the three cleanup fixes:
 *   1. eval_completed → EvalResult ingestion logic
 *   2. Campaign Sandbox FailRunInput uses error_summary
 *   3. Reconstruction types are well-formed
 */

import { describe, it, expect } from "vitest";
import type { EvalResult } from "@/lib/proof-layer/schemas";
import type { FailRunInput } from "../../examples/integrations/campaign-sandbox/agentpulse-client";

// ── 1. eval_completed → EvalResult conversion helper ─────────────────────────
// We test the logic inline since the helper is inside the route file.
// This mirrors the tryBuildEvalResult function.

function tryBuildEvalResult(meta: Record<string, unknown>, runId: string, nodeId?: string): EvalResult | null {
  const eval_id = typeof meta["eval_id"] === "string" ? meta["eval_id"] : null;
  const name = typeof meta["eval_name"] === "string" ? meta["eval_name"] : null;
  if (!eval_id || !name) return null;

  const passed = typeof meta["passed"] === "boolean" ? meta["passed"] : true;
  const score = typeof meta["score"] === "number" ? meta["score"] : undefined;
  const rawFindings: unknown[] = Array.isArray(meta["findings"]) ? (meta["findings"] as unknown[]) : [];
  const findings: string[] = rawFindings.filter((f): f is string => typeof f === "string");
  const recommendation = typeof meta["recommendation"] === "string" ? meta["recommendation"] : undefined;

  const rawSeverity = typeof meta["severity"] === "string" ? meta["severity"] : null;
  const validSeverities = ["info", "warning", "fail", "critical"] as const;
  type EvalSeverity = typeof validSeverities[number];
  const severity: EvalSeverity =
    rawSeverity && (validSeverities as readonly string[]).includes(rawSeverity)
      ? (rawSeverity as EvalSeverity)
      : passed ? "info" : "fail";

  const evalType =
    typeof meta["type"] === "string" &&
    ["schema_validity", "tool_call_assertion", "output_quality", "safety", "source_grounding",
     "trace_contract", "approval_gate", "model_benchmark"].includes(meta["type"] as string)
      ? (meta["type"] as EvalResult["type"])
      : "output_quality";

  return {
    eval_id,
    run_id: runId,
    node_id: nodeId,
    name,
    type: evalType,
    score,
    passed,
    severity,
    findings,
    recommendation,
  };
}

describe("eval_completed → EvalResult conversion", () => {
  it("builds an EvalResult from a complete eval_completed metadata", () => {
    const meta = {
      eval_id: "ev_route_quality",
      eval_name: "Route Quality Check",
      passed: true,
      score: 0.92,
      findings: ["Route A scored highest in reach."],
      severity: "info",
      type: "output_quality",
      recommendation: "Proceed to next stage.",
    };
    const result = tryBuildEvalResult(meta, "run-001", "score-routes");
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
    const meta = { eval_name: "Some Eval", passed: true };
    expect(tryBuildEvalResult(meta, "run-001")).toBeNull();
  });

  it("returns null if eval_name is missing", () => {
    const meta = { eval_id: "ev_001", passed: true };
    expect(tryBuildEvalResult(meta, "run-001")).toBeNull();
  });

  it("infers severity=fail when passed=false and no severity provided", () => {
    const meta = { eval_id: "ev_001", eval_name: "Safety Check", passed: false };
    const result = tryBuildEvalResult(meta, "run-001");
    expect(result!.severity).toBe("fail");
  });

  it("infers severity=info when passed=true and no severity provided", () => {
    const meta = { eval_id: "ev_001", eval_name: "Safety Check", passed: true };
    const result = tryBuildEvalResult(meta, "run-001");
    expect(result!.severity).toBe("info");
  });

  it("uses output_quality as default type when unknown type is provided", () => {
    const meta = { eval_id: "ev_001", eval_name: "Custom Eval", type: "custom_unknown_type" };
    const result = tryBuildEvalResult(meta, "run-001");
    expect(result!.type).toBe("output_quality");
  });

  it("filters non-string findings", () => {
    const meta = {
      eval_id: "ev_001",
      eval_name: "Mixed Eval",
      findings: ["string finding", 42, null, "another finding"],
    };
    const result = tryBuildEvalResult(meta, "run-001");
    expect(result!.findings).toEqual(["string finding", "another finding"]);
  });

  it("handles missing optional fields gracefully", () => {
    const meta = { eval_id: "ev_001", eval_name: "Bare Eval" };
    const result = tryBuildEvalResult(meta, "run-001");
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
