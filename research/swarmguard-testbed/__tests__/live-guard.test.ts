import { describe, expect, it } from "vitest";
import { classifyRecordedInvocations, resolveExecutionMode } from "../src/modes";
import { invokeModel, ModelInvocationError } from "../src/llm";
import { softwareEngineeringDomain } from "../domains/softwareEngineering";
import { runExperiment } from "../src/harness";
import { turn, useTestStore } from "./helpers";
import { miniDomain } from "./helpers";

const liveConfigured = Boolean(process.env["OPENAI_API_KEY"] || process.env["ANTHROPIC_API_KEY"]);
const liveRequested = process.env["REEPROV_P2_LIVE_LLM"] === "1";

describe("P2 live-guard: credentials and fixtures cannot substitute for live proof", () => {
  const store = useTestStore("p2-live-guard");

  it("does not label fixture runs as live_llm", async () => {
    const result = await runExperiment(softwareEngineeringDomain, {
      mode: "offline_fixture",
      persist: true,
      outputDir: store.outputDir(),
    });
    expect(result.execution_mode).toBe("offline_fixture");
    expect(classifyRecordedInvocations(result.artifact.models)).toBe("offline_fixture");
    expect(result.artifact.models.some((model) => model.metadata?.["provider_http_completed"] === true)).toBe(false);
  });

  it("does not label mocked runs as live_llm", async () => {
    const result = await runExperiment(miniDomain(), {
      mode: "mocked",
      persist: true,
      outputDir: store.outputDir(),
      mockTurns: {
        alpha: turn({ summary: "a" }),
        beta: turn({ summary: "b" }),
      },
    });
    expect(result.execution_mode).toBe("mocked");
    expect(classifyRecordedInvocations(result.artifact.models)).toBe("mocked");
  });

  it("rejects live invocation when no key is configured", async () => {
    const previousOpen = process.env["OPENAI_API_KEY"];
    const previousAnthropic = process.env["ANTHROPIC_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    try {
      await expect(
        invokeModel({
          mode: "live_llm",
          agentId: "coder",
          domainId: "software-engineering",
          scenarioId: "se-normalize-severity-v1",
          messages: [{ role: "user", content: "ping" }],
          maxTokens: 16,
          timeoutMs: 1000,
        })
      ).rejects.toSatisfy((error: unknown) => error instanceof ModelInvocationError && error.code === "live_blocked");
      const resolved = resolveExecutionMode("live_llm", {});
      expect(resolved.live_blocked).toBeTruthy();
      expect(resolved.mode).toBe("offline_fixture");
    } finally {
      if (previousOpen) process.env["OPENAI_API_KEY"] = previousOpen;
      if (previousAnthropic) process.env["ANTHROPIC_API_KEY"] = previousAnthropic;
    }
  });
});

describe.skipIf(!liveConfigured || !liveRequested)("P2 live-llm: real provider execution", () => {
  const store = useTestStore("p2-live");

  it("completes Domain A with actual provider HTTP responses", async () => {
    const result = await runExperiment(softwareEngineeringDomain, {
      mode: "live_llm",
      persist: true,
      outputDir: store.outputDir(),
      seed: "live-se",
      budget: { max_cost_usd: 0.15, max_tokens_per_call: 600, max_model_calls: 6 },
    });
    expect(result.live_blocked).toBeUndefined();
    expect(result.execution_mode).toBe("live_llm");
    expect(result.artifact.models.length).toBeGreaterThanOrEqual(3);
    for (const model of result.artifact.models) {
      expect(model.metadata?.["execution_mode"]).toBe("live_llm");
      expect(model.metadata?.["provider_http_completed"]).toBe(true);
      expect(model.provider === "openai" || model.provider === "anthropic").toBe(true);
      expect(model.model).not.toBe("recorded-fixture");
      expect(model.model).not.toBe("mock");
    }
    expect(result.participating_agent_ids).toEqual(
      expect.arrayContaining(["coder", "reviewer", "release-decision"])
    );
    expect(result.artifact.handoffs).toHaveLength(2);
  }, 180_000);
});
