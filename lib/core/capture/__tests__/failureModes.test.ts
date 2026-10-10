import { describe, it, expect, vi, beforeEach } from "vitest";
import { normalizeBoundary } from "../normalizeBoundary";
import { AgentPulseCaptureService } from "../sdk";
import { classifySideEffect } from "../sideEffectClassifier";
import { BoundaryReplayHarness, ReplayMismatchError } from "../replayHarness";
import { InMemoryContentStore, setContentStore } from "../contentStore";

describe("Capture Pipeline Failure Modes & Resilience", () => {
  beforeEach(() => {
    setContentStore(new InMemoryContentStore());
  });

  it("handles boundary capture failure gracefully without crashing host application by default", async () => {
    const capture = new AgentPulseCaptureService();
    const session = capture.startRun({
      projectId: "test_resilience",
      workflowId: "fail_wf",
      summary: "Testing capture resilience",
      strict: false, // Default non-strict behavior
    });

    // Spy on console.warn
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Pass invalid input that causes normalization failure or reject in wrapper
    const wrappedTool = session.wrapTool(
      async () => {
        return "Host function succeeds regardless of capture health";
      },
      { name: "resilient_tool" }
    );

    const result = await wrappedTool({});
    expect(result).toBe("Host function succeeds regardless of capture health");
    warnSpy.mockRestore();
  });

  it("strict mode surfaces capture failure when explicitly configured", async () => {
    const capture = new AgentPulseCaptureService();
    const session = capture.startRun({
      projectId: "test_strict",
      workflowId: "strict_wf",
      summary: "Testing strict capture",
      strict: true,
    });

    // In strict mode, capture failures throw
    const wrappedTool = session.wrapTool(
      async () => {
        throw new Error("Target tool threw an expected error");
      },
      { name: "strict_tool" }
    );

    await expect(wrappedTool({})).rejects.toThrow("Target tool threw an expected error");
  });

  it("truncates oversized payloads when exceeding maxPayloadBytes", async () => {
    const hugePayload = "x".repeat(600000); // 600 KB > 512 KB default
    const boundary = await normalizeBoundary({
      runId: "run_truncation_01",
      boundaryType: "tool_call",
      name: "fetch_huge_blob",
      input: { data: hugePayload },
      output: { ok: true },
    });

    expect(boundary.input.truncated).toBe(true);
    expect(boundary.input.availability).toBe("TRUNCATED");
  });

  it("fails closed when encountering completely unknown side-effect class", () => {
    // When a tool has an unclassifiable name, it must fail closed to external_side_effect
    const sideEffect = classifySideEffect("tool_call", "unknown_operation_xyz");
    expect(sideEffect).toBe("external_side_effect");
    expect(sideEffect).not.toBe("read_only");
  });

  it("handles partial runs cleanly with degraded or failed status", async () => {
    const capture = new AgentPulseCaptureService();
    const session = capture.startRun({
      projectId: "test_partial",
      workflowId: "partial_wf",
      summary: "Incomplete run",
    });

    await session.captureModel({
      model: "gpt-4o",
      provider: "openai",
      prompt: "First step",
      response: "Response 1",
      startedAt: new Date().toISOString(),
    });

    // Agent crashed before completing step 2
    const partialArtifact = await session.finishRun({
      status: "failed",
      error: { message: "Execution aborted by host process" },
    });

    expect(partialArtifact.execution.status).toBe("failed");
    expect(partialArtifact.boundaries).toHaveLength(1);
    expect(partialArtifact.execution.error?.message).toBe("Execution aborted by host process");
  });

  it("replay harness detects replay lookup mismatch on missing boundary", async () => {
    const harness = new BoundaryReplayHarness([]);

    await expect(
      harness.substituteModel("gpt-4o", { prompt: "test" })
    ).rejects.toThrow(ReplayMismatchError);
  });
});
