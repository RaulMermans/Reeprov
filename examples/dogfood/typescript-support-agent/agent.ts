import { AgentPulseClient } from "./agentpulseClient.js";

const ingestKey = process.env["AGENTPULSE_INGEST_KEY"];
if (!ingestKey) {
  console.error(
    "No AgentPulse ingest key configured.\n" +
    "Create a project in AgentPulse Studio and copy its generated ingest key."
  );
  process.exit(1);
}

// Read configuration from environment
const pulse = new AgentPulseClient({
  endpoint: process.env["AGENTPULSE_URL"] || "http://127.0.0.1:3000",
  ingestKey,
  projectId: process.env["AGENTPULSE_PROJECT_ID"] || "support-agent",
  projectName: process.env["AGENTPULSE_PROJECT_NAME"] || "Customer Support Agent",
  workflowId: process.env["AGENTPULSE_WORKFLOW_ID"] || "customer-support-v1",
  enabled: process.env["AGENTPULSE_ENABLED"] !== "false",
});

async function runSupportAgent() {
  console.log("=== AgentPulse Dogfood: TypeScript Support Agent ===");
  console.log(`Endpoint: ${process.env["AGENTPULSE_URL"] || "http://127.0.0.1:3000"}`);
  console.log(`Enabled:  ${pulse.isEnabled}`);

  // 1. Start run
  const runId = await pulse.startRun({
    summary: "Customer inquiry: Package status for order #ORD-9872",
  });
  console.log(`[Run Started] runId=${runId}`);

  try {
    // 2. Emit model call evidence: Intent classification
    console.log("Step 1: Classifying user inquiry...");
    await pulse.modelCallCompleted(runId, {
      nodeId: "intent_classifier",
      modelProvider: "openai",
      modelName: "gpt-4o-mini",
      inputTokens: 145,
      outputTokens: 42,
      costUsd: 0.00012,
      durationMs: 380,
      inputSummary: "Customer inquiry: 'Hi, where is my package for order ORD-9872?'",
      outputSummary: "Intent classified: order_status_lookup (orderId: ORD-9872)",
    });

    // 3. Emit tool call evidence: Order lookup
    console.log("Step 2: Calling shipping database tool...");
    const toolInput = { orderId: "ORD-9872" };
    const toolOutput = {
      orderId: "ORD-9872",
      status: "in_transit",
      carrier: "ExpressCourier",
      estimatedDelivery: "Tomorrow by 2:00 PM",
      lastCheckpoint: "Distribution Center, Chicago IL",
    };

    await pulse.toolCallCompleted(runId, {
      nodeId: "lookup_order",
      toolName: "order_status_api",
      permissionClass: "read_only",
      durationMs: 95,
      costUsd: 0.0,
      inputSummary: JSON.stringify(toolInput),
      outputSummary: JSON.stringify(toolOutput),
    });

    // 4. Emit replay-grade boundary capture
    console.log("Step 3: Emitting replay boundary...");
    await pulse.captureBoundary(runId, {
      boundaryType: "tool_call",
      name: "order_status_api",
      nodeId: "lookup_order",
      durationMs: 95,
      input: toolInput,
      output: toolOutput,
      declaredSideEffectClass: "read_only",
    });

    // 5. Emit model call evidence: Drafting customer response
    console.log("Step 4: Generating personalized response...");
    await pulse.modelCallCompleted(runId, {
      nodeId: "response_generator",
      modelProvider: "openai",
      modelName: "gpt-4o-mini",
      inputTokens: 280,
      outputTokens: 85,
      costUsd: 0.00021,
      durationMs: 490,
      inputSummary: "Draft helpful response informing customer order ORD-9872 is in transit",
      outputSummary: "Your order ORD-9872 is currently in transit with ExpressCourier and scheduled for delivery tomorrow by 2:00 PM.",
    });

    // 6. Complete run
    console.log("Step 5: Completing run...");
    await pulse.completeRun(runId, {
      summary: "Inquiry resolved: informed customer of in-transit shipment",
      totalCostUsd: 0.00033,
      totalDurationMs: 965,
    });

    console.log("✓ Success: Agent run completed and recorded to AgentPulse.");
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`✗ Agent run failed: ${errorMsg}`);
    await pulse.failRun(runId, { errorSummary: errorMsg });
    process.exit(1);
  }
}

runSupportAgent().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
