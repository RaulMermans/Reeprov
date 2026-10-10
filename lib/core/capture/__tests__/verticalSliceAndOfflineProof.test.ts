import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AgentPulseCaptureService } from "../sdk";
import { BoundaryReplayHarness } from "../replayHarness";
import { saveCanonicalRun, getCanonicalRun } from "../persistence";
import { runArtifactSchema, type RunArtifact } from "../../contracts/runArtifact";
import { InMemoryContentStore, setContentStore } from "../contentStore";
import { ReplayRuntime } from "../../replay/runtime";
import { validateExecutionIntegrity } from "../integrity";

describe("Reference Vertical Slice & Deterministic Offline Replay Proof", () => {
  beforeEach(() => {
    setContentStore(new InMemoryContentStore());
  });

  // ── Reference Agent Definition ────────────────────────────────────────────

  interface AgentDependencies {
    callModel: (input: { model: string; prompt: string; messages?: any[]; tools?: any[] }) => Promise<any>;
    callRetrieval: (input: { service: string; query: string }) => Promise<any>;
    callTool: (input: { name: string; args: any }) => Promise<any>;
  }

  interface StepLifecycle {
    step: <T>(name: string, stepType: any, fn: (stepId: string) => Promise<T>) => Promise<T>;
    captureState?: (stateData: Record<string, unknown>, options?: any) => any;
    createCheckpoint?: (options?: any) => any;
  }

  /**
   * Canonical Reference Agent:
   * USER -> Step 0 (Model Plan) -> Step 1 (Retrieval & Reasoning) -> Step 2 (Tool Lookup) -> Step 3 (Model Synthesis) -> FINAL
   */
  async function runSupportTriageAgent(
    deps: AgentDependencies,
    userInput: string,
    lifecycle?: StepLifecycle
  ) {
    const stepFn = lifecycle?.step ?? (async (_, __, fn) => fn("step_direct"));

    // Step 0: Initial planning & tool selection
    const plan = await stepFn("planning", "model_call", async (stepId) => {
      lifecycle?.captureState?.({ phase: "planning", userInput }, { stepId, type: "INITIAL_STATE" });
      lifecycle?.createCheckpoint?.({ stepId });

      return deps.callModel({
        model: "claude-3-5-sonnet",
        prompt: `User query: "${userInput}". Decide next steps.`,
        tools: [{ name: "search_policy" }, { name: "get_customer_account" }],
      });
    });

    // Step 1: Retrieval: Search refund policy + model reasoning
    const { retrievalResults, toolCallPlan } = await stepFn("policy_retrieval", "retrieval", async (stepId) => {
      const results = await deps.callRetrieval({
        service: "pinecone_kb",
        query: "refund policy and eligibility criteria",
      });

      const nextPlan = await deps.callModel({
        model: "claude-3-5-sonnet",
        prompt: `Policy retrieved: "${results[0].content}". Now lookup customer details for user in query "${userInput}".`,
      });

      lifecycle?.captureState?.({ phase: "retrieval", resultsCount: results.length }, { stepId });
      return { retrievalResults: results, toolCallPlan: nextPlan };
    });

    // Step 2: Read-Only Tool: Lookup customer account
    const accountDetails = await stepFn("account_lookup", "tool_call", async (stepId) => {
      const details = await deps.callTool({
        name: "get_customer_account",
        args: { customerId: "cus_1001" },
      });
      lifecycle?.captureState?.({ phase: "account_lookup", accountDetails: details }, { stepId });
      return details;
    });

    // Step 3: Model Synthesis: Final answer
    const finalAnswer = await stepFn("synthesis", "model_call", async (stepId) => {
      const answer = await deps.callModel({
        model: "claude-3-5-sonnet",
        prompt: `Synthesize answer using policy "${retrievalResults[0].content}" and balance "${accountDetails.balance} ${accountDetails.currency}".`,
      });
      lifecycle?.captureState?.({ phase: "synthesis", finalAnswer: answer }, { stepId, type: "FINAL_STATE" });
      return answer;
    });

    return {
      plan,
      retrievalResults,
      toolCallPlan,
      accountDetails,
      finalAnswer,
    };
  }

  it("captures full vertical slice into canonical RunArtifact with real linked evidence", async () => {
    const capture = new AgentPulseCaptureService();
    const session = capture.startRun({
      projectId: "customer-support-agent",
      projectName: "Customer Support Agent",
      workflowId: "triage-v1",
      summary: "Customer support query for balance and refund policy",
      runId: "run_vertical_slice_ref_001",
      strict: true,
    });

    // Instrumented dependencies
    const liveDeps: AgentDependencies = {
      callModel: async (input) => {
        const response =
          input.prompt.includes("Synthesize")
            ? "Your account cus_1001 balance is 150 USD. Per company policy, full refunds are eligible within 30 days."
            : input.prompt.includes("Policy retrieved")
              ? "Calling get_customer_account for cus_1001."
              : "Step 1 plan: Search refund policy then fetch balance.";

        await session.captureModel({
          model: input.model,
          provider: "anthropic",
          prompt: input.prompt,
          toolsExposed: input.tools,
          response,
          inputTokens: 150,
          outputTokens: 60,
          costUsd: 0.002,
          startedAt: new Date().toISOString(),
        });

        return response;
      },
      callRetrieval: async (input) => {
        const results = [
          {
            documentId: "doc_refund_policy_01",
            chunkId: "chk_01",
            title: "Standard Refund Policy",
            content: "Full refunds are eligible within 30 days of purchase upon verification.",
            score: 0.96,
            rank: 1,
            enteredModelContext: true,
          },
        ];

        await session.captureRetrieval({
          serviceName: input.service,
          query: input.query,
          results,
          startedAt: new Date().toISOString(),
        });

        return results;
      },
      callTool: async (input) => {
        const output = { customerId: "cus_1001", balance: 150, currency: "USD", status: "active" };

        await session.captureTool({
          toolName: input.name,
          arguments: input.args,
          output,
          declaredPermissionClass: "read_only",
          startedAt: new Date().toISOString(),
        });

        return output;
      },
    };

    // Execute reference agent with full step lifecycle instrumentation
    const result = await runSupportTriageAgent(
      liveDeps,
      "What is customer cus_1001's current balance and our refund policy?",
      {
        step: (name, stepType, fn) => session.step(name, stepType, fn),
        captureState: (data, opts) => session.captureState(data, opts),
        createCheckpoint: (opts) => session.createCheckpoint(opts),
      }
    );

    expect(result.finalAnswer).toContain("balance is 150 USD");

    // Complete run and obtain canonical RunArtifact
    const artifact = await session.finishRun({
      summary: "Successfully triaged refund and balance request",
      status: "completed",
    });

    // Validate against canonical contract
    const validated = runArtifactSchema.parse(artifact);

    // Verify all canonical links and structures
    expect(validated.identity.run_id).toBe("run_vertical_slice_ref_001");
    expect(validated.trajectory).toHaveLength(4); // 4 real execution steps!
    expect(validated.boundaries).toHaveLength(5); // Model1, Retrieval, Model2, Tool, Model3
    expect(validated.models).toHaveLength(3);
    expect(validated.retrieval).toHaveLength(1);
    expect(validated.tools).toHaveLength(1);
    expect(validated.state.length).toBeGreaterThanOrEqual(4); // State snapshots captured
    expect(validated.lineage.checkpoint_reference).toBeDefined();

    // Verify monotonic sequence indices: 0, 1, 2, 3, 4
    for (let i = 0; i < validated.boundaries.length; i++) {
      expect(validated.boundaries[i].sequence_index).toBe(i);
    }

    // Verify unique boundary IDs (no duplicates)
    const boundaryIds = validated.boundaries.map((b) => b.boundary_id);
    expect(new Set(boundaryIds).size).toBe(5);

    // Verify canonical boundary type
    expect(validated.boundaries[1].boundary_type).toBe("retrieval_call");

    // Verify step <-> boundary linkages
    const integrity = validateExecutionIntegrity(validated);
    expect(integrity.valid).toBe(true);
    expect(integrity.errors).toHaveLength(0);
    expect(integrity.linkedBoundaryCount).toBe(5);

    // Persist to file store
    await saveCanonicalRun(validated);

    // Save as canonical fixture file for regression testing
    const fixtureDir = path.join(process.cwd(), "tests/fixtures/canonical");
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(
      path.join(fixtureDir, "fixture-h-vertical-slice.json"),
      JSON.stringify(validated, null, 2),
      "utf8"
    );
  });

  it("PROVES DETERMINISTIC OFFLINE REPLAY: reproduces execution trajectory offline with live providers disabled", async () => {
    // 1. Reload the captured RunArtifact from storage
    const recordedArtifact = await getCanonicalRun("run_vertical_slice_ref_001");
    expect(recordedArtifact).not.toBeNull();

    // 2. Spy / mock live providers that throw an error if called
    const liveModelStub = vi.fn().mockImplementation(() => {
      throw new Error("FAIL: Live model call attempted during offline replay!");
    });
    const liveRetrievalStub = vi.fn().mockImplementation(() => {
      throw new Error("FAIL: Live retrieval call attempted during offline replay!");
    });
    const liveToolStub = vi.fn().mockImplementation(() => {
      throw new Error("FAIL: Live tool call attempted during offline replay!");
    });

    // 3. Execute via new ReplayRuntime with STRICT_OFFLINE mode
    const runtime = new ReplayRuntime();
    const replayResult = await runtime.replay(
      recordedArtifact!,
      async (adapter) => {
        const deps = adapter.getDependencies();

        const replayDeps: AgentDependencies = {
          callModel: async (input) => {
            expect(liveModelStub).not.toHaveBeenCalled();
            return deps.callModel(input);
          },
          callRetrieval: async (input) => {
            expect(liveRetrievalStub).not.toHaveBeenCalled();
            return deps.callRetrieval(input);
          },
          callTool: async (input) => {
            expect(liveToolStub).not.toHaveBeenCalled();
            return deps.callTool(input);
          },
        };

        return runSupportTriageAgent(
          replayDeps,
          "What is customer cus_1001's current balance and our refund policy?"
        );
      },
      { mode: "STRICT_OFFLINE" }
    );

    // 4. Assert full reproduction
    expect(replayResult.status).toBe("MATCHED");
    expect(replayResult.deterministic_match).toBe(true);
    expect(replayResult.boundaries_substituted).toBe(5);
    expect(replayResult.divergences).toHaveLength(0);
    expect(replayResult.live_calls_attempted).toBe(0);
    expect(replayResult.live_calls_blocked).toBe(0);

    // Confirm live providers were never touched
    expect(liveModelStub).toHaveBeenCalledTimes(0);
    expect(liveRetrievalStub).toHaveBeenCalledTimes(0);
    expect(liveToolStub).toHaveBeenCalledTimes(0);

    // Confirm produced final output matched recorded value
    const replayed = replayResult.final_output as any;
    expect(replayed.finalAnswer).toBe(
      "Your account cus_1001 balance is 150 USD. Per company policy, full refunds are eligible within 30 days."
    );
    expect(replayed.accountDetails.balance).toBe(150);

    // 5. Also verify legacy BoundaryReplayHarness works seamlessly with the canonical artifact
    const harness = new BoundaryReplayHarness(recordedArtifact!);
    const sub0 = await harness.substituteModel("anthropic/claude-3-5-sonnet", {
      model: "claude-3-5-sonnet",
      provider: "anthropic",
      prompt: 'User query: "What is customer cus_1001\'s current balance and our refund policy?". Decide next steps.',
      tools: [{ name: "search_policy" }, { name: "get_customer_account" }],
    });
    expect(sub0.output).toContain("Search refund policy");

    const sub1 = await harness.substituteRetrieval("pinecone_kb:search", {
      query: "refund policy and eligibility criteria",
    });
    expect(sub1.output).toBeDefined();
  });
});
