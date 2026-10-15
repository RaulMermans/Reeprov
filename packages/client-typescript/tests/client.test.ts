import test from "node:test";
import assert from "node:assert";
import { AgentPulseClient, AgentPulseError } from "../src/index.js";

test("AgentPulseClient instantiates with default options", () => {
  const client = new AgentPulseClient({
    endpoint: "http://127.0.0.1:3000",
    apiKey: "test_key",
    projectId: "test_project",
  });

  assert.ok(client);
  assert.strictEqual(client.isEnabled, true);
});

test("AgentPulseClient handles disabled posture cleanly", async () => {
  const client = new AgentPulseClient({
    enabled: false,
    projectId: "test_project",
  });

  assert.strictEqual(client.isEnabled, false);
  const run = await client.startRun({ summary: "Noop execution" });
  assert.ok(run.run_id.startsWith("noop-"));
  assert.strictEqual(run.status, "running");

  // Telemetry methods should noop without throwing
  await client.modelCallCompleted({
    run_id: run.run_id,
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    response: { ok: true },
  });

  await client.toolCallCompleted({
    run_id: run.run_id,
    tool_name: "test_tool",
    arguments: { query: "test" },
  });

  await client.completeRun({ run_id: run.run_id });
});

test("AgentPulseError constructs properly", () => {
  const err = new AgentPulseError("Unauthorized", 401, false);
  assert.strictEqual(err.message, "Unauthorized");
  assert.strictEqual(err.status, 401);
  assert.strictEqual(err.isRetryable, false);
  assert.strictEqual(err.name, "AgentPulseError");
});
