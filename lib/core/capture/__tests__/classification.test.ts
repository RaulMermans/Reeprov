import { describe, it, expect } from "vitest";
import { classifySideEffect } from "../sideEffectClassifier";
import { classifyReplayability } from "../replayabilityClassifier";
import { normalizeBoundaryType, deriveDependencyIdentity } from "../boundaryClassifier";

describe("Boundary Classification & Safety Evaluation", () => {
  describe("Side-Effect Classification", () => {
    it("classifies read-only tool calls by prefixes", () => {
      expect(classifySideEffect("tool_call", "get_stripe_customer")).toBe("read_only");
      expect(classifySideEffect("tool_call", "fetch_weather_forecast")).toBe("read_only");
      expect(classifySideEffect("tool_call", "search_knowledge_base")).toBe("read_only");
      expect(classifySideEffect("tool_call", "list_active_campaigns")).toBe("read_only");
    });

    it("classifies write-draft tools", () => {
      expect(classifySideEffect("tool_call", "save_draft_email")).toBe("write_draft");
      expect(classifySideEffect("tool_call", "create_draft_pr")).toBe("write_draft");
      expect(classifySideEffect("filesystem_write", "write_temp_file")).toBe("write_draft");
    });

    it("classifies external side effects and mutations", () => {
      expect(classifySideEffect("tool_call", "send_slack_notification")).toBe("external_side_effect");
      expect(classifySideEffect("tool_call", "charge_customer_card")).toBe("external_side_effect");
      expect(classifySideEffect("tool_call", "execute_sql_migration")).toBe("external_side_effect");
    });

    it("classifies destructive tools", () => {
      expect(classifySideEffect("tool_call", "delete_all_users")).toBe("destructive");
      expect(classifySideEffect("tool_call", "purge_cache_store")).toBe("destructive");
      expect(classifySideEffect("external_http", "https://api.test/resource", undefined, "DELETE")).toBe("destructive");
    });

    it("classifies sensitive data operations", () => {
      expect(classifySideEffect("tool_call", "decrypt_wallet_credentials")).toBe("sensitive_data");
      expect(classifySideEffect("tool_call", "fetch_auth_token")).toBe("sensitive_data");
    });

    it("classifies HTTP requests according to method", () => {
      expect(classifySideEffect("external_http", "https://api.github.com/repos", undefined, "GET")).toBe("read_only");
      expect(classifySideEffect("external_http", "https://api.github.com/repos", undefined, "POST")).toBe("external_side_effect");
      expect(classifySideEffect("external_http", "https://api.github.com/repos", undefined, "PUT")).toBe("external_side_effect");
    });

    it("FAILS CLOSED for unknown tool names — NEVER defaults to read_only", () => {
      const unknownResult = classifySideEffect("tool_call", "custom_black_box_action_xyz");
      expect(unknownResult).not.toBe("read_only");
      expect(unknownResult).toBe("external_side_effect");
    });

    it("respects valid explicitly declared classes", () => {
      expect(classifySideEffect("tool_call", "send_email", "write_draft")).toBe("write_draft");
    });
  });

  describe("Replayability Classification", () => {
    it("classifies captured read-only boundaries as REPLAYABLE_RECORDED", () => {
      const res = classifyReplayability({
        boundaryType: "model_call",
        sideEffectClass: "read_only",
        inputCaptured: true,
        outputCaptured: true,
        contentAvailability: "CAPTURED",
      });
      expect(res).toBe("REPLAYABLE_RECORDED");
    });

    it("classifies external side-effects as SIDE_EFFECT_GATED even when outputs exist", () => {
      const res = classifyReplayability({
        boundaryType: "tool_call",
        sideEffectClass: "external_side_effect",
        inputCaptured: true,
        outputCaptured: true,
        contentAvailability: "CAPTURED",
      });
      expect(res).toBe("SIDE_EFFECT_GATED");
    });

    it("classifies uncaptured output as NON_REPLAYABLE", () => {
      const res = classifyReplayability({
        boundaryType: "model_call",
        sideEffectClass: "read_only",
        inputCaptured: true,
        outputCaptured: false,
        contentAvailability: "not_captured",
      });
      expect(res).toBe("NON_REPLAYABLE");
    });

    it("classifies sandboxed boundaries as REPLAYABLE_SANDBOXED", () => {
      const res = classifyReplayability({
        boundaryType: "code_execution",
        sideEffectClass: "write_draft",
        inputCaptured: true,
        outputCaptured: true,
        contentAvailability: "CAPTURED",
        isSandboxed: true,
      });
      expect(res).toBe("REPLAYABLE_SANDBOXED");
    });

    it("classifies pure deterministic transforms as REPLAYABLE_DETERMINISTIC", () => {
      const res = classifyReplayability({
        boundaryType: "tool_call",
        sideEffectClass: "read_only",
        inputCaptured: true,
        outputCaptured: true,
        contentAvailability: "CAPTURED",
        isDeterministic: true,
      });
      expect(res).toBe("REPLAYABLE_DETERMINISTIC");
    });
  });

  describe("Boundary Type Normalization", () => {
    it("maps synonym types to canonical enum values", () => {
      expect(normalizeBoundaryType("llm")).toBe("model_call");
      expect(normalizeBoundaryType("tool")).toBe("tool_call");
      expect(normalizeBoundaryType("rag")).toBe("retrieval_call");
      expect(normalizeBoundaryType("retrieval_service")).toBe("retrieval_call");
      expect(normalizeBoundaryType("retrieval_call")).toBe("retrieval_call");
      expect(normalizeBoundaryType("memory_read")).toBe("memory_read");
      expect(normalizeBoundaryType("memory_write")).toBe("memory_write");
      expect(normalizeBoundaryType("fetch")).toBe("external_http");
      expect(normalizeBoundaryType("sandbox")).toBe("code_execution");
      expect(normalizeBoundaryType("unknown_custom_boundary")).toBe("custom");
    });

    it("derives standardized dependency identities", () => {
      expect(deriveDependencyIdentity("model_call", "gpt-4o", { provider: "openai" })).toBe("openai:gpt-4o");
      expect(deriveDependencyIdentity("tool_call", "fetch_user")).toBe("tool:fetch_user");
      expect(deriveDependencyIdentity("external_http", "api.stripe.com", { host: "api.stripe.com" })).toBe("http:api.stripe.com");
    });
  });
});
