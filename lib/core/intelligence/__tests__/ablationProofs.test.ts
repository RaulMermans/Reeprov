import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runArtifactSchema, type RunArtifact } from "../../contracts/runArtifact";
import { ForkRuntime } from "../../fork/runtime";
import { compareRuns } from "../../comparison/comparator";
import type { ExperimentMutation } from "../../contracts/lineage";

function loadFixture(filename: string): RunArtifact {
  const filePath = join(process.cwd(), "tests/fixtures/canonical", filename);
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  return runArtifactSchema.parse(raw);
}

describe("Sprint 7: Context & Memory Ablation Proofs", () => {
  const testStoreDir = join(process.cwd(), ".agentpulse-test-ablation-proofs");

  beforeEach(() => {
    process.env["AGENTPULSE_STORE_DIR"] = testStoreDir;
  });

  afterEach(() => {
    delete process.env["AGENTPULSE_STORE_DIR"];
    if (existsSync(testStoreDir)) {
      rmSync(testStoreDir, { recursive: true, force: true });
    }
  });

  describe("1. Context Ablation Proof: Controlled Exclusion of Irrelevant Chunk", () => {
    it("ablates duplicate/irrelevant context item, proves execution equivalence without it", async () => {
      const baseline = loadFixture("fixture-j-context-ablation-baseline.json");

      // Verify baseline has 5 context items with 1750 tokens
      expect(baseline.context[0].items).toHaveLength(5);
      expect(baseline.context[0].total_token_measurement?.value).toBe(1750);

      const mutation: ExperimentMutation = {
        mutation_id: "mut_ablate_dup_shipping_note",
        mutation_type: "context_exclusion",
        target_identifier: "ctx_item_irrelevant_duplicate",
        description: "Ablate irrelevant duplicate shipping note (500 tokens)",
        parameters: { item_id: "ctx_item_irrelevant_duplicate" },
        created_at: new Date().toISOString(),
      };

      const forkRuntime = new ForkRuntime(baseline, "chk_ctx_decision_01", {
        forkId: "run_fork_ctx_ablation_verified",
        mutations: [mutation],
        persist: false,
        candidateModelHandler: async () => {
          // Model receives context without the ablated shipping note (500 tokens saved)
          // Still calculates refund correctly
          return {
            action: "call_tool",
            tool: "refund.calculate",
            parameters: { order_id: "ord_101", amount: 50 },
          };
        },
        executeLogic: async (_adapter, { dependencies }) => {
          return dependencies.callModel({
            model: "claude-3-5-sonnet",
            provider: "anthropic",
            prompt: "Evaluate refund eligibility with provided policy and customer request",
            tools: [{ name: "refund.calculate" }],
          });
        },
      });

      const forkResult = await forkRuntime.fork();
      expect(forkResult.status).toBe("COMPLETED");
      expect(forkResult.child_artifact).toBeDefined();

      const candidate = forkResult.child_artifact!;

      // 1. Verify candidate context excluded the item and recalculated tokens
      expect(candidate.context[0].items).toHaveLength(4);
      expect(candidate.context[0].items.some((i) => i.item_id === "ctx_item_irrelevant_duplicate")).toBe(false);
      expect(candidate.context[0].total_token_measurement?.value).toBe(1250); // 1750 - 500

      // 2. Run deterministic comparison between baseline and ablated candidate
      const comparison = await compareRuns(baseline, candidate);

      // Verify CONTEXT difference is detected and classified as CONTROLLED_MUTATION
      const ctxDivergence = comparison.divergences.find(
        (d) => d.dimension === "CONTEXT" && d.description.includes("ctx_item_irrelevant_duplicate")
      );
      expect(ctxDivergence).toBeDefined();
      expect(ctxDivergence?.causal_status).toBe("CONTROLLED_MUTATION");
      expect(ctxDivergence?.description).toContain("ctx_item_irrelevant_duplicate");

      // Final outcome remains equivalent
      expect(comparison.outcome_diff.status_changed).toBe(false);
      expect(candidate.evidence.final_outcome.status).toBe("SUCCESS");
    });
  });

  describe("2. Memory Ablation Proof: Controlled Exclusion of User Preference", () => {
    it("ablates conciseness memory, proves causal link to verbose downstream response", async () => {
      const baseline = loadFixture("fixture-k-memory-ablation-baseline.json");

      // Verify baseline injected concise preference
      expect(baseline.memory?.operations[0].memory_id).toBe("mem_concise_01");
      expect(baseline.context[0].items.some((i) => i.item_id === "ctx_item_memory_concise")).toBe(true);

      const mutation: ExperimentMutation = {
        mutation_id: "mut_ablate_concise_preference",
        mutation_type: "memory_exclusion",
        target_identifier: "mem_concise_01",
        description: "Ablate customer concise style memory (80 tokens)",
        parameters: { memory_id: "mem_concise_01" },
        created_at: new Date().toISOString(),
      };

      const forkRuntime = new ForkRuntime(baseline, "chk_mem_decision_01", {
        forkId: "run_fork_mem_ablation_verified",
        mutations: [mutation],
        persist: false,
        candidateModelHandler: async () => {
          // Without the concise preference memory, model defaults to verbose response
          return {
            text: "Hello! Thank you for contacting our customer service department. I am pleased to assist you today. I have checked our system records for account cus_77 and can confirm that your account is currently active with a balance of 120 USD.",
          };
        },
        executeLogic: async (_adapter, { dependencies }) => {
          return dependencies.callModel({
            model: "claude-3-5-sonnet",
            provider: "anthropic",
            prompt: "Respond to user inquiry using injected preference and account details",
          });
        },
      });

      const forkResult = await forkRuntime.fork();
      expect(forkResult.status).toBe("COMPLETED");
      expect(forkResult.child_artifact).toBeDefined();

      const candidate = forkResult.child_artifact!;

      // 1. Verify candidate context snapshot excluded the memory item
      expect(candidate.context[0].items).toHaveLength(3);
      expect(candidate.context[0].items.some((i) => i.item_id === "ctx_item_memory_concise")).toBe(false);
      expect(candidate.context[0].total_token_measurement?.value).toBe(600); // 680 - 80

      // 2. Run deterministic comparison between baseline and candidate
      const comparison = await compareRuns(baseline, candidate);

      // Verify MEMORY or CONTEXT divergence for the ablated item is classified as CONTROLLED_MUTATION
      const memDivergence = comparison.divergences.find(
        (d) =>
          (d.dimension === "MEMORY" || d.dimension === "CONTEXT") &&
          (d.description.includes("ctx_item_memory_concise") || d.description.includes("mem_concise_01"))
      );
      expect(memDivergence).toBeDefined();
      expect(memDivergence?.causal_status).toBe("CONTROLLED_MUTATION");

      // Verify downstream model output changed and is classified as CAUSALLY_SUPPORTED
      const downstreamDivergence = comparison.divergences.find(
        (d) => d.dimension === "MODEL_OUTPUT" || d.dimension === "OUTCOME"
      );
      expect(downstreamDivergence).toBeDefined();
      expect(downstreamDivergence?.causal_status).toBe("CAUSALLY_SUPPORTED");
    });
  });

  describe("3. Enforcement: Silent Replay Guard Under Model Input Mutation", () => {
    it("refuses to silently reuse baseline output when model input mutated without candidate handler", async () => {
      const baseline = loadFixture("fixture-j-context-ablation-baseline.json");

      const mutation: ExperimentMutation = {
        mutation_id: "mut_ablate_no_handler",
        mutation_type: "context_exclusion",
        target_identifier: "ctx_item_irrelevant_duplicate",
        description: "Ablate context item without candidate handler",
        parameters: { item_id: "ctx_item_irrelevant_duplicate" },
        created_at: new Date().toISOString(),
      };

      const forkRuntime = new ForkRuntime(baseline, "chk_ctx_decision_01", {
        forkId: "run_fork_no_handler_fail",
        mutations: [mutation],
        persist: false,
        // candidateModelHandler deliberately omitted
        executeLogic: async (_adapter, { dependencies }) => {
          return dependencies.callModel({
            model: "claude-3-5-sonnet",
            provider: "anthropic",
            prompt: "Evaluate refund eligibility with provided policy and customer request",
          });
        },
      });

      const forkResult = await forkRuntime.fork();
      expect(forkResult.status).toBe("FAILED");
      expect(forkResult.errors[0]).toContain("ABLATION_REQUIRES_CANDIDATE_MODEL");
    });
  });

  describe("4. Non-Destructive Invariance", () => {
    it("guarantees baseline RunArtifact is never modified during ablation fork", async () => {
      const baseline = loadFixture("fixture-k-memory-ablation-baseline.json");
      const baselineJsonBefore = JSON.stringify(baseline);

      const mutation: ExperimentMutation = {
        mutation_id: "mut_ablate_invariance",
        mutation_type: "memory_exclusion",
        target_identifier: "mem_concise_01",
        description: "Test baseline immutability",
        created_at: new Date().toISOString(),
      };

      const forkRuntime = new ForkRuntime(baseline, "chk_mem_decision_01", {
        forkId: "run_fork_immutability_test",
        mutations: [mutation],
        persist: false,
        candidateModelHandler: async () => ({ text: "Response" }),
        executeLogic: async (_adapter, { dependencies }) => {
          return dependencies.callModel({
            model: "claude-3-5-sonnet",
            provider: "anthropic",
            prompt: "test",
          });
        },
      });

      await forkRuntime.fork();

      const baselineJsonAfter = JSON.stringify(baseline);
      expect(baselineJsonAfter).toBe(baselineJsonBefore);
    });
  });
});
