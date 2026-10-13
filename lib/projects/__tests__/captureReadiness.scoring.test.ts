import { describe, expect, it } from "vitest";
import { computeCaptureReadiness } from "../captureReadiness";
import type { RunArtifact } from "@/lib/core/contracts/runArtifact";

function createBaseRun(overrides?: Partial<RunArtifact>): RunArtifact {
  return {
    schema_version: "1.0.0-alpha",
    identity: {
      run_id: "test-run-score-001",
      project_id: "test-project",
    },
    execution: {
      status: "completed",
      started_at: "2026-10-13T10:00:00.000Z",
      completed_at: "2026-10-13T10:00:05.000Z",
      duration_ms: 5000,
      summary: "Test execution",
    },
    trajectory: [],
    ...overrides,
  };
}

describe("CaptureReadiness Scoring & Dimensional Model (Sprint Item 20, 30)", () => {
  it("handles null / undefined run artifact with score=0 and INSUFFICIENT rating", async () => {
    const reportNull = await computeCaptureReadiness(null);
    expect(reportNull.overallScore).toBe(0);
    expect(reportNull.rating).toBe("INSUFFICIENT");
    expect(reportNull.dimensions).toEqual([]);

    const reportUndef = await computeCaptureReadiness(undefined);
    expect(reportUndef.overallScore).toBe(0);
    expect(reportUndef.rating).toBe("INSUFFICIENT");
  });

  describe("NOT_APPLICABLE Denominator Exclusion & Zero Score (Fix Verification)", () => {
    it("ensures NOT_APPLICABLE dimensions score 0 and are excluded from denominator", async () => {
      // Run with only complete lifecycle, and no tools or retrieval
      const run = createBaseRun();
      const report = await computeCaptureReadiness(run);

      const toolsDim = report.dimensions.find((d) => d.category === "TOOLS");
      const retrievalDim = report.dimensions.find((d) => d.category === "RETRIEVAL");

      expect(toolsDim).toBeDefined();
      expect(toolsDim?.level).toBe("NOT_APPLICABLE");
      expect(toolsDim?.score).toBe(0);

      expect(retrievalDim).toBeDefined();
      expect(retrievalDim?.level).toBe("NOT_APPLICABLE");
      expect(retrievalDim?.score).toBe(0);

      // Applicable dimensions: RUN_LIFECYCLE (10), MODEL (0), STATE (0), CONFIGURATION (0), EVALS (0)
      // Total applicable = 5 dimensions * 10 = 50 total possible.
      // Sum = 10.
      // Overall score should be 10 / 50 = 20%.
      // If NOT_APPLICABLE inflated score (previously 10 each), sum would have been 30 / 70 = 43%.
      expect(report.overallScore).toBe(20);
      expect(report.rating).toBe("INSUFFICIENT");
    });

    it("does not penalize a pure reasoning agent lacking tools or retrieval", async () => {
      // Agent with complete lifecycle, model with tokens, state, config, and evals, but NO tools/retrieval
      const run = createBaseRun({
        models: [
          {
            model_name: "gpt-4o",
            total_tokens: 1500,
            prompt_tokens: 1000,
            completion_tokens: 500,
          },
        ],
        observability: { total_tokens: 1500 },
        checkpoints: [
          {
            checkpoint_id: "chk-1",
            step_index: 0,
            state_hash: "hash-123",
            timestamp: "2026-10-13T10:00:01.000Z",
          },
        ],
        configuration_snapshot: {
          snapshot_id: "cfg-1",
          run_id: "test-run-score-001",
          captured_at: "2026-10-13T10:00:00.000Z",
          declaration_type: "EFFECTIVE",
          config_hash: "config-hash-abcdef123456",
        },
        evals: [
          {
            eval_id: "ev-1",
            name: "accuracy",
            status: "PASS",
            score: 1.0,
          },
        ],
      });

      const report = await computeCaptureReadiness(run);

      // 5 applicable dimensions, all COMPLETE (10 each) -> 50 / 50 = 100%
      expect(report.overallScore).toBe(100);
      expect(report.rating).toBe("OPTIMAL");

      const notApplicable = report.dimensions.filter((d) => d.level === "NOT_APPLICABLE");
      expect(notApplicable.length).toBe(2);
      expect(notApplicable.every((d) => d.score === 0)).toBe(true);
    });
  });

  describe("Dimension: RUN_LIFECYCLE", () => {
    it("scores COMPLETE (10) when started, completed, and status are present", async () => {
      const run = createBaseRun({
        execution: {
          status: "completed",
          started_at: "2026-10-13T10:00:00.000Z",
          completed_at: "2026-10-13T10:00:05.000Z",
          duration_ms: 5000,
        },
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "RUN_LIFECYCLE");
      expect(dim?.level).toBe("COMPLETE");
      expect(dim?.score).toBe(10);
    });

    it("scores PARTIAL (5) when started or status present but completed missing", async () => {
      const run = createBaseRun({
        execution: {
          status: "running",
          started_at: "2026-10-13T10:00:00.000Z",
        },
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "RUN_LIFECYCLE");
      expect(dim?.level).toBe("PARTIAL");
      expect(dim?.score).toBe(5);
    });

    it("scores ABSENT (0) when lifecycle execution fields are empty", async () => {
      const run = createBaseRun({
        execution: undefined,
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "RUN_LIFECYCLE");
      expect(dim?.level).toBe("ABSENT");
      expect(dim?.score).toBe(0);
    });
  });

  describe("Dimension: MODEL", () => {
    it("scores COMPLETE (10) when model calls and token metrics are captured", async () => {
      const run = createBaseRun({
        models: [
          {
            model_name: "claude-3-5-sonnet",
            total_tokens: 800,
          },
        ],
        observability: { total_tokens: 800 },
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "MODEL");
      expect(dim?.level).toBe("COMPLETE");
      expect(dim?.score).toBe(10);
    });

    it("scores PARTIAL (6) when model calls exist but token metrics are missing", async () => {
      const run = createBaseRun({
        models: [
          {
            model_name: "claude-3-5-sonnet",
            total_tokens: 0,
          },
        ],
        observability: { total_tokens: 0 },
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "MODEL");
      expect(dim?.level).toBe("PARTIAL");
      expect(dim?.score).toBe(6);
    });

    it("scores ABSENT (0) when no model calls exist in models or trajectory", async () => {
      const run = createBaseRun({
        models: [],
        trajectory: [],
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "MODEL");
      expect(dim?.level).toBe("ABSENT");
      expect(dim?.score).toBe(0);
    });
  });

  describe("Dimension: TOOLS", () => {
    it("scores COMPLETE (10) when tool invocations exist with parameters and outputs", async () => {
      const run = createBaseRun({
        tools: [
          {
            tool_name: "calculator",
            parameters: { expr: "2 + 2" },
            output: "4",
          },
        ],
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "TOOLS");
      expect(dim?.level).toBe("COMPLETE");
      expect(dim?.score).toBe(10);
    });

    it("scores PARTIAL (6) when tool steps exist in trajectory but without full payload", async () => {
      const run = createBaseRun({
        tools: [],
        trajectory: [
          {
            step_index: 0,
            step_type: "tool_call",
            name: "web_search",
            status: "completed",
          },
        ],
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "TOOLS");
      expect(dim?.level).toBe("PARTIAL");
      expect(dim?.score).toBe(6);
    });

    it("scores NOT_APPLICABLE (0) when agent did not execute tools", async () => {
      const run = createBaseRun({
        tools: [],
        trajectory: [],
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "TOOLS");
      expect(dim?.level).toBe("NOT_APPLICABLE");
      expect(dim?.score).toBe(0);
    });
  });

  describe("Dimension: RETRIEVAL", () => {
    it("scores COMPLETE (10) when retrieval operations exist", async () => {
      const run = createBaseRun({
        retrieval: [
          {
            query: "vector search",
            document_count: 3,
          },
        ],
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "RETRIEVAL");
      expect(dim?.level).toBe("COMPLETE");
      expect(dim?.score).toBe(10);
    });

    it("scores NOT_APPLICABLE (0) when no retrieval operations occurred", async () => {
      const run = createBaseRun({
        retrieval: [],
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "RETRIEVAL");
      expect(dim?.level).toBe("NOT_APPLICABLE");
      expect(dim?.score).toBe(0);
    });
  });

  describe("Dimension: STATE / CHECKPOINTS", () => {
    it("scores COMPLETE (10) when execution checkpoints exist", async () => {
      const run = createBaseRun({
        checkpoints: [
          {
            checkpoint_id: "chk-001",
            step_index: 1,
            state_hash: "sha256:abc",
            timestamp: "2026-10-13T10:00:02.000Z",
          },
        ],
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "STATE");
      expect(dim?.level).toBe("COMPLETE");
      expect(dim?.score).toBe(10);
    });

    it("scores ABSENT (0) when checkpoints are missing", async () => {
      const run = createBaseRun({
        checkpoints: [],
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "STATE");
      expect(dim?.level).toBe("ABSENT");
      expect(dim?.score).toBe(0);
    });
  });

  describe("Dimension: CONFIGURATION", () => {
    it("scores COMPLETE (10) when configuration snapshot has config_hash", async () => {
      const run = createBaseRun({
        configuration_snapshot: {
          snapshot_id: "cfg-001",
          run_id: "test-run-score-001",
          captured_at: "2026-10-13T10:00:00.000Z",
          declaration_type: "EFFECTIVE",
          config_hash: "hash-xyz-987",
        },
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "CONFIGURATION");
      expect(dim?.level).toBe("COMPLETE");
      expect(dim?.score).toBe(10);
    });

    it("scores ABSENT (0) when configuration snapshot is absent", async () => {
      const run = createBaseRun({
        configuration_snapshot: undefined,
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "CONFIGURATION");
      expect(dim?.level).toBe("ABSENT");
      expect(dim?.score).toBe(0);
    });
  });

  describe("Dimension: EVALS", () => {
    it("scores COMPLETE (10) when evaluation results are recorded", async () => {
      const run = createBaseRun({
        evals: [
          {
            eval_id: "eval-1",
            name: "schema_check",
            status: "PASS",
          },
        ],
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "EVALS");
      expect(dim?.level).toBe("COMPLETE");
      expect(dim?.score).toBe(10);
    });

    it("scores ABSENT (0) when evaluation assertions are absent", async () => {
      const run = createBaseRun({
        evals: [],
      });
      const report = await computeCaptureReadiness(run);
      const dim = report.dimensions.find((d) => d.category === "EVALS");
      expect(dim?.level).toBe("ABSENT");
      expect(dim?.score).toBe(0);
    });
  });

  describe("Overall Rating Thresholds", () => {
    it("categorizes score < 50 as INSUFFICIENT", async () => {
      // 1 COMPLETE (10) out of 5 applicable = 20%
      const run = createBaseRun();
      const report = await computeCaptureReadiness(run);
      expect(report.overallScore).toBe(20);
      expect(report.rating).toBe("INSUFFICIENT");
    });

    it("categorizes score 50..74 as BASIC", async () => {
      // 3 COMPLETE (30) out of 5 applicable = 60%
      const run = createBaseRun({
        models: [{ model_name: "gpt-4", total_tokens: 500 }],
        checkpoints: [{ checkpoint_id: "c1", step_index: 0, state_hash: "h", timestamp: "t" }],
      });
      const report = await computeCaptureReadiness(run);
      expect(report.overallScore).toBe(60);
      expect(report.rating).toBe("BASIC");
    });

    it("categorizes score 75..89 as ACTIONABLE", async () => {
      // 4 COMPLETE (40) out of 5 applicable = 80%
      const run = createBaseRun({
        models: [{ model_name: "gpt-4", total_tokens: 500 }],
        checkpoints: [{ checkpoint_id: "c1", step_index: 0, state_hash: "h", timestamp: "t" }],
        configuration_snapshot: {
          snapshot_id: "cfg-1",
          run_id: "r1",
          captured_at: "t",
          declaration_type: "EFFECTIVE",
          config_hash: "abcdef123456",
        },
      });
      const report = await computeCaptureReadiness(run);
      expect(report.overallScore).toBe(80);
      expect(report.rating).toBe("ACTIONABLE");
    });

    it("categorizes score >= 90 as OPTIMAL", async () => {
      // 5 COMPLETE (50) out of 5 applicable = 100%
      const run = createBaseRun({
        models: [{ model_name: "gpt-4", total_tokens: 500 }],
        checkpoints: [{ checkpoint_id: "c1", step_index: 0, state_hash: "h", timestamp: "t" }],
        configuration_snapshot: {
          snapshot_id: "cfg-1",
          run_id: "r1",
          captured_at: "t",
          declaration_type: "EFFECTIVE",
          config_hash: "abcdef123456",
        },
        evals: [{ eval_id: "e1", name: "check", status: "PASS" }],
      });
      const report = await computeCaptureReadiness(run);
      expect(report.overallScore).toBe(100);
      expect(report.rating).toBe("OPTIMAL");
    });
  });
});
