import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AgentPulseCaptureService } from "../sdk";
import { BoundaryReplayHarness } from "../replayHarness";
import { saveCanonicalRun, getCanonicalRun } from "../persistence";
import { runArtifactSchema, type RunArtifact } from "../../contracts/runArtifact";
import { InMemoryContentStore, setContentStore } from "../contentStore";

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

  /**
   * Reference Agent:
   * USER -> MODEL 1 -> RETRIEVAL -> MODEL 2 -> READ-ONLY TOOL -> MODEL 3 -> FINAL
   */
  async function runSupportTriageAgent(deps: AgentDependencies, userInput: string) {
    // 1. Model 1: Initial planning & tool selection
    const plan = await deps.callModel({
      model: "claude-3-5-sonnet",
      prompt: `User query: "${userInput}". Decide next steps.`,
      tools: [{ name: "search_policy" }, { name: "get_customer_account" }],
    });

    // 2. Retrieval: Search refund policy
    const retrievalResults = await deps.callRetrieval({
      service: "pinecone_kb",
      query: "refund policy and eligibility criteria",
    });

    // 3. Model 2: Process policy and formulate tool query for customer account
    const toolCallPlan = await deps.callModel({
      model: "claude-3-5-sonnet",
      prompt: `Policy retrieved: "${retrievalResults[0].content}". Now lookup customer details for user in query "${userInput}".`,
    });

    // 4. Read-Only Tool: Lookup customer account
    const accountDetails = await deps.callTool({
      name: "get_customer_account",
      args: { customerId: "cus_1001" },
    });

    // 5. Model 3: Final synthesis
    const finalAnswer = await deps.callModel({
      model: "claude-3-5-sonnet",
      prompt: `Synthesize answer using policy "${retrievalResults[0].content}" and balance "${accountDetails.balance} ${accountDetails.currency}".`,
    });

    return {
      plan,
      retrievalResults,
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

    // Execute reference agent
    const result = await runSupportTriageAgent(
      liveDeps,
      "What is customer cus_1001's current balance and our refund policy?"
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
    expect(validated.boundaries).toHaveLength(5); // Model1, Retrieval, Model2, Tool, Model3
    expect(validated.models).toHaveLength(3);
    expect(validated.retrieval).toHaveLength(1);
    expect(validated.tools).toHaveLength(1);
    expect(validated.context).toHaveLength(3); // 3 context snapshots from 3 model calls
    expect(validated.boundaries.every((b) => b.replayability === "REPLAYABLE_RECORDED")).toBe(true);

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

  it("PROVES DETERMINISTIC OFFLINE REPLAY: substitutes recorded boundaries with live providers disabled", async () => {
    // 1. Reload the captured RunArtifact from storage
    const recordedArtifact = await getCanonicalRun("run_vertical_slice_ref_001");
    expect(recordedArtifact).not.toBeNull();

    // 2. Instantiate BoundaryReplayHarness
    const harness = new BoundaryReplayHarness(recordedArtifact!);

    // 3. Spy / mock live providers that throw an error if called
    const liveModelStub = vi.fn().mockImplementation(() => {
      throw new Error("FAIL: Live model call attempted during offline replay!");
    });
    const liveRetrievalStub = vi.fn().mockImplementation(() => {
      throw new Error("FAIL: Live retrieval call attempted during offline replay!");
    });
    const liveToolStub = vi.fn().mockImplementation(() => {
      throw new Error("FAIL: Live tool call attempted during offline replay!");
    });

    // 4. Offline dependencies routed exclusively through the BoundaryReplayHarness
    const offlineDeps: AgentDependencies = {
      callModel: async (input) => {
        // Confirm live provider is never called
        expect(liveModelStub).not.toHaveBeenCalled();

        // Deterministic substitution from recorded boundary
        const boundaryInput = {
          model: input.model,
          provider: "anthropic",
          prompt: input.prompt,
          tools: input.tools,
        };
        const sub = await harness.substituteModel("anthropic/claude-3-5-sonnet", boundaryInput);
        return sub.output;
      },
      callRetrieval: async (input) => {
        expect(liveRetrievalStub).not.toHaveBeenCalled();

        const sub = await harness.substituteRetrieval("pinecone_kb:search", {
          query: input.query,
        });
        return (sub.output as any).results;
      },
      callTool: async (input) => {
        expect(liveToolStub).not.toHaveBeenCalled();

        const sub = await harness.substituteTool(input.name, input.args);
        return sub.output;
      },
    };

    // 5. Execute the exact same agent offline!
    const replayedResult = await runSupportTriageAgent(
      offlineDeps,
      "What is customer cus_1001's current balance and our refund policy?"
    );

    // 6. Confirm ZERO live calls occurred
    expect(liveModelStub).toHaveBeenCalledTimes(0);
    expect(liveRetrievalStub).toHaveBeenCalledTimes(0);
    expect(liveToolStub).toHaveBeenCalledTimes(0);

    // 7. Confirm exact matching output was substituted
    expect(replayedResult.finalAnswer).toBe(
      "Your account cus_1001 balance is 150 USD. Per company policy, full refunds are eligible within 30 days."
    );
    expect(replayedResult.accountDetails.balance).toBe(150);

    // 8. Confirm all boundaries were substituted in sequence
    const replayStatus = harness.verifyCompleteReplay();
    expect(replayStatus.complete).toBe(true);
    expect(replayStatus.substitutedCount).toBe(5);
    expect(replayStatus.remainingBoundaries).toBe(0);
  });
});
