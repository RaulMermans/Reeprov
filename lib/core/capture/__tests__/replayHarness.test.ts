import { describe, it, expect, beforeEach } from "vitest";
import { BoundaryReplayHarness, ReplayMismatchError } from "../replayHarness";
import { normalizeBoundary } from "../normalizeBoundary";
import { InMemoryContentStore, setContentStore } from "../contentStore";
import type { ExecutionBoundary } from "../../contracts/replay";

describe("Boundary Replay Harness (Limited Scope)", () => {
  let contentStore: InMemoryContentStore;

  beforeEach(() => {
    contentStore = new InMemoryContentStore();
    setContentStore(contentStore);
  });

  async function createMockBoundaries(): Promise<ExecutionBoundary[]> {
    const b1 = await normalizeBoundary({
      runId: "run_replay_test",
      sequenceIndex: 0,
      boundaryType: "model_call",
      name: "openai/gpt-4o",
      input: { prompt: "Calculate 2+2" },
      output: { text: "4" },
      declaredSideEffectClass: "read_only",
    });

    const b2 = await normalizeBoundary({
      runId: "run_replay_test",
      sequenceIndex: 1,
      boundaryType: "tool_call",
      name: "get_user_info",
      input: { userId: "user_42" },
      output: { name: "Bob", plan: "pro" },
      declaredSideEffectClass: "read_only",
    });

    const b3 = await normalizeBoundary({
      runId: "run_replay_test",
      sequenceIndex: 2,
      boundaryType: "retrieval_service",
      name: "docs_search:search",
      input: { query: "How to reset password?" },
      output: { results: [{ id: "doc_1", content: "Go to settings." }] },
      declaredSideEffectClass: "read_only",
    });

    return [b1, b2, b3];
  }

  it("deterministically substitutes recorded model, tool, and retrieval boundaries", async () => {
    const boundaries = await createMockBoundaries();
    const harness = new BoundaryReplayHarness(boundaries);

    // 1. Substitute Model
    const modelSub = await harness.substituteModel("openai/gpt-4o", { prompt: "Calculate 2+2" });
    expect(modelSub.output).toEqual({ text: "4" });
    expect(modelSub.boundary.name).toBe("openai/gpt-4o");

    // 2. Substitute Tool
    const toolSub = await harness.substituteTool("get_user_info", { userId: "user_42" });
    expect(toolSub.output).toEqual({ name: "Bob", plan: "pro" });

    // 3. Substitute Retrieval
    const retSub = await harness.substituteRetrieval("docs_search:search", { query: "How to reset password?" });
    expect(retSub.output).toEqual({ results: [{ id: "doc_1", content: "Go to settings." }] });

    const status = harness.verifyCompleteReplay();
    expect(status.complete).toBe(true);
    expect(status.substitutedCount).toBe(3);
  });

  it("strict mode REJECTS input hash mismatch (detects execution divergence)", async () => {
    const boundaries = await createMockBoundaries();
    const harness = new BoundaryReplayHarness(boundaries, { strict: true });

    // Call with diverged prompt
    await expect(
      harness.substituteModel("openai/gpt-4o", { prompt: "Calculate 5+5 instead" })
    ).rejects.toThrow(ReplayMismatchError);

    try {
      await harness.substituteModel("openai/gpt-4o", { prompt: "Calculate 5+5 instead" });
    } catch (err: any) {
      expect(err.code).toBe("INPUT_HASH_MISMATCH");
    }
  });

  it("strict mode REJECTS wrong boundary order", async () => {
    const boundaries = await createMockBoundaries();
    const harness = new BoundaryReplayHarness(boundaries, { verifyOrder: true });

    // Attempting to call tool before model call
    await expect(
      harness.substituteTool("get_user_info", { userId: "user_42" })
    ).rejects.toThrow(ReplayMismatchError);

    try {
      await harness.substituteTool("get_user_info", { userId: "user_42" });
    } catch (err: any) {
      expect(err.code).toBe("WRONG_BOUNDARY_ORDER");
    }
  });

  it("fails closed on side-effect boundaries without safe recorded substitution", async () => {
    const dangerousBoundary = await normalizeBoundary({
      runId: "run_replay_danger",
      sequenceIndex: 0,
      boundaryType: "tool_call",
      name: "delete_user_account",
      input: { userId: "user_42" },
      output: { deleted: true },
      declaredSideEffectClass: "destructive",
    });

    const harness = new BoundaryReplayHarness([dangerousBoundary], { allowSideEffects: false });

    await expect(
      harness.substituteTool("delete_user_account", { userId: "user_42" })
    ).rejects.toThrow(ReplayMismatchError);

    try {
      await harness.substituteTool("delete_user_account", { userId: "user_42" });
    } catch (err: any) {
      expect(err.code).toBe("SIDE_EFFECT_GATED");
    }
  });

  it("rejects substitution when output payload is unavailable", async () => {
    const unavailableBoundary = await normalizeBoundary({
      runId: "run_replay_unavail",
      sequenceIndex: 0,
      boundaryType: "model_call",
      name: "openai/gpt-4o",
      input: { prompt: "Hello" },
      error: { message: "Model timeout" },
    });

    const harness = new BoundaryReplayHarness([unavailableBoundary]);

    await expect(
      harness.substituteModel("openai/gpt-4o", { prompt: "Hello" })
    ).rejects.toThrow(ReplayMismatchError);

    try {
      await harness.substituteModel("openai/gpt-4o", { prompt: "Hello" });
    } catch (err: any) {
      expect(err.code).toBe("UNAVAILABLE_PAYLOAD");
    }
  });
});
