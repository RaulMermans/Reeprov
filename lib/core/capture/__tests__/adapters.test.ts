import { describe, it, expect, beforeEach } from "vitest";
import { captureModelInvocation } from "../adapters/modelCapture";
import { captureToolInvocation } from "../adapters/toolCapture";
import { captureRetrievalOperation } from "../adapters/retrievalCapture";
import { captureMemoryOperation, ExampleInstrumentedMemoryProvider } from "../adapters/memoryCapture";
import { captureHttpCall, sanitizeUrl } from "../adapters/httpCapture";
import { InMemoryContentStore, setContentStore } from "../contentStore";

describe("Boundary Capture Adapters", () => {
  beforeEach(() => {
    setContentStore(new InMemoryContentStore());
  });

  describe("Model Invocation Capture", () => {
    it("captures model parameters, attributes tokens, and materializes ContextSnapshot", async () => {
      const res = await captureModelInvocation({
        runId: "run_model_test_01",
        stepId: "step_01",
        model: "claude-3-5-sonnet",
        provider: "anthropic",
        prompt: "Analyze the user intent: refund request",
        response: { text: "Intent is refund request.", category: "billing" },
        inputTokens: 120,
        outputTokens: 45,
        costUsd: 0.0015,
        startedAt: "2026-10-10T09:00:00.000Z",
        completedAt: "2026-10-10T09:00:01.200Z",
      });

      // 1. ModelInvocation verified
      expect(res.modelInvocation.model_name).toBe("claude-3-5-sonnet");
      expect(res.modelInvocation.provider).toBe("anthropic");
      expect(res.modelInvocation.prompt_tokens).toBe(120);
      expect(res.modelInvocation.completion_tokens).toBe(45);
      expect(res.modelInvocation.total_tokens).toBe(165);
      expect(res.modelInvocation.cost_usd).toBe(0.0015);
      expect(res.modelInvocation.raw_captured).toBe(true);

      // 2. ContextSnapshot verified
      expect(res.contextSnapshot).toBeDefined();
      expect(res.contextSnapshot?.items).toHaveLength(1);
      expect(res.contextSnapshot?.items[0].source_type).toBe("user_input");
      expect(res.modelInvocation.context_snapshot_id).toBe(res.contextSnapshot?.snapshot_id);

      // 3. ExecutionBoundary verified
      expect(res.boundary.boundary_type).toBe("model_call");
      expect(res.boundary.name).toBe("anthropic/claude-3-5-sonnet");
      expect(res.boundary.replayability).toBe("REPLAYABLE_RECORDED");
      expect(res.boundary.side_effect_class).toBe("read_only");
      expect(res.boundary.linked_model_invocation_id).toBe(res.modelInvocation.invocation_id);
    });

    it("classifies multi-turn messages into proper ContextItem source types", async () => {
      const res = await captureModelInvocation({
        runId: "run_model_chat_02",
        model: "gpt-4o",
        provider: "openai",
        messages: [
          { role: "system", content: "You are a customer support triage assistant." },
          { role: "user", content: "My order #123 never arrived." },
        ],
        toolsExposed: [
          { name: "lookup_order", description: "Fetch order details by order ID" },
        ],
        response: "I will check order #123 for you.",
        startedAt: new Date().toISOString(),
      });

      expect(res.contextSnapshot).toBeDefined();
      expect(res.contextSnapshot?.items).toHaveLength(3);
      expect(res.contextSnapshot?.items[0].source_type).toBe("system_policy");
      expect(res.contextSnapshot?.items[1].source_type).toBe("user_input");
      expect(res.contextSnapshot?.items[2].source_type).toBe("tool_definition");
    });
  });

  describe("Tool Invocation Capture", () => {
    it("captures read-only tool invocation with argument hashes and output", async () => {
      const res = await captureToolInvocation({
        runId: "run_tool_test_01",
        toolName: "fetch_stripe_customer",
        arguments: { customer_id: "cus_12345" },
        output: { id: "cus_12345", email: "alice@example.com", delinquent: false },
        startedAt: "2026-10-10T09:05:00.000Z",
        completedAt: "2026-10-10T09:05:00.350Z",
      });

      expect(res.toolInvocation.tool_name).toBe("fetch_stripe_customer");
      expect(res.toolInvocation.permission_class).toBe("read_only");
      expect(res.boundary.replayability).toBe("REPLAYABLE_RECORDED");
      expect(res.boundary.side_effect_class).toBe("read_only");
      expect(res.boundary.content_hashes?.input_hash).toBeDefined();
      expect(res.boundary.content_hashes?.output_hash).toBeDefined();
      expect(res.toolInvocation.boundary_id).toBe(res.boundary.boundary_id);
    });

    it("classifies write/mutation tool as SIDE_EFFECT_GATED", async () => {
      const res = await captureToolInvocation({
        runId: "run_tool_mutation_02",
        toolName: "charge_customer_card",
        arguments: { customer_id: "cus_12345", amount: 5000 },
        output: { charge_id: "ch_999", status: "succeeded" },
        startedAt: new Date().toISOString(),
      });

      expect(res.toolInvocation.permission_class).toBe("external_side_effect");
      expect(res.boundary.side_effect_class).toBe("external_side_effect");
      expect(res.boundary.replayability).toBe("SIDE_EFFECT_GATED");
    });
  });

  describe("Retrieval Capture", () => {
    it("captures queries, candidate results, scores, and tracks context entry", async () => {
      const res = await captureRetrievalOperation({
        runId: "run_retrieval_01",
        serviceName: "pinecone_kb",
        query: "What is our refund window?",
        results: [
          {
            documentId: "doc_policy_1",
            chunkId: "chk_01",
            title: "Standard Return Policy",
            content: "Customers may request a full refund within 30 days of purchase.",
            score: 0.94,
            rank: 1,
            enteredModelContext: true,
          },
          {
            documentId: "doc_policy_2",
            chunkId: "chk_02",
            title: "Holiday Exceptions",
            content: "Holiday purchases have an extended 60 day return window.",
            score: 0.78,
            rank: 2,
            enteredModelContext: false, // did not enter context
          },
        ],
        startedAt: new Date().toISOString(),
      });

      expect(res.retrievalOperation.service_name).toBe("pinecone_kb");
      expect(res.retrievalOperation.results_count).toBe(2);
      expect(res.retrievalOperation.context_item_ids).toHaveLength(1); // only 1 entered context
      expect(res.boundary.boundary_type).toBe("retrieval_service");
      expect(res.boundary.replayability).toBe("REPLAYABLE_RECORDED");
    });
  });

  describe("Memory Observability Hook & Adapter", () => {
    it("captures memory reads and writes through generic hook", async () => {
      const capturedOps: any[] = [];
      const memoryProvider = new ExampleInstrumentedMemoryProvider(async (op) => {
        const res = await captureMemoryOperation(op);
        capturedOps.push(res);
      });

      // Write
      const written = await memoryProvider.write(
        "run_mem_01",
        "user_preferred_language",
        "es-ES",
        "semantic"
      );
      expect(written.value).toBe("es-ES");
      expect(capturedOps).toHaveLength(1);
      expect(capturedOps[0].memoryOperation.operation_type).toBe("committed_write");
      expect(capturedOps[0].boundary.boundary_type).toBe("memory_write");
      expect(capturedOps[0].boundary.side_effect_class).toBe("external_side_effect");

      // Read
      const readResult = await memoryProvider.read(
        "run_mem_01",
        "user_preferred_language",
        "semantic"
      );
      expect(readResult?.value).toBe("es-ES");
      expect(capturedOps).toHaveLength(2);
      expect(capturedOps[1].memoryOperation.operation_type).toBe("read");
      expect(capturedOps[1].boundary.boundary_type).toBe("memory_read");
      expect(capturedOps[1].boundary.side_effect_class).toBe("read_only");
      expect(capturedOps[1].boundary.replayability).toBe("REPLAYABLE_RECORDED");
    });
  });

  describe("HTTP Boundary Capture", () => {
    it("redacts auth headers and query credentials in external HTTP boundaries", async () => {
      const res = await captureHttpCall({
        runId: "run_http_01",
        method: "POST",
        url: "https://admin:super_secret@api.billing.com/v1/charge?api_key=my_secret_token",
        headers: {
          "Authorization": "Bearer sensitive_token_xyz",
          "Cookie": "session=abcde123",
          "Content-Type": "application/json",
        },
        body: { amount: 100 },
        status: 200,
        responseHeaders: {
          "Set-Cookie": "auth_cookie=secret_val",
          "Content-Type": "application/json",
        },
        responseBody: { success: true },
        startedAt: new Date().toISOString(),
      });

      const boundary = res.boundary;
      expect(boundary.boundary_type).toBe("external_http");
      expect(boundary.name).not.toContain("super_secret");
      expect(boundary.name).not.toContain("my_secret_token");

      const inputHeaders = (boundary.input.content as any)?.headers;
      expect(inputHeaders["Authorization"]).toBe("[REDACTED_HEADER]");
      expect(inputHeaders["Cookie"]).toBe("[REDACTED_HEADER]");
      expect(inputHeaders["Content-Type"]).toBe("application/json");

      const outputHeaders = (boundary.output?.content as any)?.headers;
      expect(outputHeaders["Set-Cookie"]).toBe("[REDACTED_HEADER]");
    });
  });
});
