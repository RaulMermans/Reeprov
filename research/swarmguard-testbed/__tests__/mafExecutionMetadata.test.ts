import { describe, expect, it } from "vitest";
import {
  modelCaptureUsage,
  resolveExternalExecution,
  type ExternalModelCallMetadata,
} from "../src/mafExecutionMetadata";

const verifiedCall = (usage: ExternalModelCallMetadata["usage"]): ExternalModelCallMetadata => ({
  provider_http_completed: true,
  execution_mode: "live_llm",
  model: "qwen2.5:7b",
  http: {
    method: "POST",
    url: "http://127.0.0.1:11434/api/chat",
    status_code: 200,
  },
  usage,
});

describe("external MAF execution metadata", () => {
  it("keeps the historical offline H2 payload offline", () => {
    const resolved = resolveExternalExecution({
      execution_mode: "offline",
      transport_label: "offline_mocked_chat_client",
      provider_http_completed: false,
      model_calls: [
        {
          provider_http_completed: false,
          execution_mode: "offline",
          model: "maf-offline-deterministic-v1",
        },
      ],
    });

    expect(resolved.canonical_mode).toBe("offline_fixture");
    expect(resolved.is_live_llm).toBe(false);
    expect(resolved.provider_http_completed).toBe(false);
    expect(resolved.actual_tokens).toBe(0);
    expect(resolved.actual_cost_usd).toBe(0);
    expect(resolved.live_blocked).toMatch(/provider_http_completed=false/);
    expect(modelCaptureUsage({ provider_http_completed: false, execution_mode: "offline" }, resolved)).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
  });

  it("does not accept a live label without a completed loopback chat response", () => {
    const resolved = resolveExternalExecution({
      execution_mode: "live_llm",
      transport_label: "ollama_local_http",
      provider_http_completed: true,
      model_calls: [
        {
          provider_http_completed: false,
          execution_mode: "live_llm",
          model: "qwen2.5:7b",
          http: { method: "POST", url: "http://127.0.0.1:11434/api/chat", status_code: 500 },
        },
      ],
    });

    expect(resolved.canonical_mode).toBe("mocked");
    expect(resolved.is_live_llm).toBe(false);
    expect(resolved.actual_tokens).toBeNull();
  });

  it("records live inference and leaves unreported usage unavailable", () => {
    const call = verifiedCall({ usage_status: "unavailable" });
    const resolved = resolveExternalExecution({
      execution_mode: "live_llm",
      transport_label: "ollama_local_http",
      provider_http_completed: true,
      model_calls: [call],
    });

    expect(resolved).toMatchObject({
      canonical_mode: "live_llm",
      is_live_llm: true,
      provider_http_completed: true,
      usage_status: "unavailable",
      actual_tokens: null,
      actual_cost_usd: null,
      cost_status: "unmetered_local",
    });
    expect(modelCaptureUsage(call, resolved)).toEqual({ usage_status: "unavailable" });
  });

  it("sums provider-reported token counts when every call reports them", () => {
    const calls = [
      verifiedCall({
        usage_status: "provider_reported",
        prompt_tokens: 20,
        completion_tokens: 5,
        total_tokens: 25,
      }),
      verifiedCall({
        usage_status: "provider_reported",
        prompt_tokens: 30,
        completion_tokens: 7,
        total_tokens: 37,
      }),
    ];
    const resolved = resolveExternalExecution({
      execution_mode: "live_llm",
      transport_label: "ollama_local_http",
      provider_http_completed: true,
      model_calls: calls,
    });

    expect(resolved.actual_tokens).toBe(62);
    expect(modelCaptureUsage(calls[0]!, resolved)).toMatchObject({
      usage_status: "provider_reported",
      inputTokens: 20,
      outputTokens: 5,
    });
  });

  it("rejects a non-loopback chat endpoint", () => {
    const resolved = resolveExternalExecution({
      execution_mode: "live_llm",
      provider_http_completed: true,
      model_calls: [
        {
          provider_http_completed: true,
          execution_mode: "live_llm",
          model: "qwen2.5:7b",
          http: { method: "POST", url: "https://example.test/api/chat", status_code: 200 },
        },
      ],
    });
    expect(resolved.is_live_llm).toBe(false);
  });
});
