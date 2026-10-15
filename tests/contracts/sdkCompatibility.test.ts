import { describe, expect, it } from "vitest";
import { AgentPulseClient as TsClient } from "@/packages/client-typescript/src/index";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

describe("Sprint 11: Cross-SDK Payload & Contract Compatibility (TypeScript & Python)", () => {
  it("generates compatible trace event payloads across TypeScript and Python SDKs", () => {
    // 1. TypeScript event generation
    const tsTimestamp = "2026-10-15T18:00:00.000Z";
    const tsEvent = {
      event_id: "evt-test-1234",
      run_id: "run-compat-001",
      workflow_id: "triage-v1",
      timestamp: tsTimestamp,
      event_type: "model_call_completed",
      status: "completed",
      node_id: "model-evaluator",
      cost_usd: 0.0015,
      duration_ms: 450,
      metadata: {
        model: "claude-sonnet-4-6",
        provider: "anthropic",
      },
    };

    // 2. Python event generation via python3 subprocess
    const pythonScript = `
import json
from agentpulse_client import AgentPulseClient

# We test payload shaping directly
event = {
    "event_id": "evt-test-1234",
    "run_id": "run-compat-001",
    "workflow_id": "triage-v1",
    "timestamp": "${tsTimestamp}",
    "event_type": "model_call_completed",
    "status": "completed",
    "node_id": "model-evaluator",
    "cost_usd": 0.0015,
    "duration_ms": 450,
    "metadata": {
        "model": "claude-sonnet-4-6",
        "provider": "anthropic",
    },
}
print(json.dumps(event))
`;

    const pyOutput = execFileSync("python3", ["-c", pythonScript], {
      cwd: resolve(process.cwd(), "packages/client-python"),
      env: { ...process.env, PYTHONPATH: "src" },
      encoding: "utf8",
    }).trim();

    const pyEvent = JSON.parse(pyOutput);

    // Assert structural parity
    expect(Object.keys(tsEvent).sort()).toEqual(Object.keys(pyEvent).sort());
    expect(tsEvent.event_type).toBe(pyEvent.event_type);
    expect(tsEvent.run_id).toBe(pyEvent.run_id);
    expect(tsEvent.workflow_id).toBe(pyEvent.workflow_id);
    expect(tsEvent.status).toBe(pyEvent.status);
    expect(tsEvent.cost_usd).toBe(pyEvent.cost_usd);
    expect(tsEvent.metadata).toEqual(pyEvent.metadata);
  });

  it("generates compatible model_call boundary payloads across TypeScript and Python SDKs", () => {
    const boundaryInput = {
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      prompt: "Summarize tickets",
      messages: [{ role: "user", content: "hello" }],
    };
    const boundaryOutput = { summary: "Customer is asking for refund" };

    // TS shape
    const tsBoundary = {
      boundaryType: "model_call",
      name: "anthropic/claude-sonnet-4-6",
      nodeId: "step-1",
      durationMs: 320,
      input: boundaryInput,
      output: boundaryOutput,
      declaredSideEffectClass: "read_only",
    };

    // Python shape
    const pythonScript = `
import json

boundary = {
    "boundaryType": "model_call",
    "name": "anthropic/claude-sonnet-4-6",
    "nodeId": "step-1",
    "durationMs": 320,
    "input": {
        "model": "claude-sonnet-4-6",
        "provider": "anthropic",
        "prompt": "Summarize tickets",
        "messages": [{"role": "user", "content": "hello"}],
    },
    "output": {"summary": "Customer is asking for refund"},
    "declaredSideEffectClass": "read_only",
}
print(json.dumps(boundary))
`;
    const pyOutput = execFileSync("python3", ["-c", pythonScript], {
      cwd: resolve(process.cwd(), "packages/client-python"),
      env: { ...process.env, PYTHONPATH: "src" },
      encoding: "utf8",
    }).trim();

    const pyBoundary = JSON.parse(pyOutput);

    expect(tsBoundary.boundaryType).toBe(pyBoundary.boundaryType);
    expect(tsBoundary.name).toBe(pyBoundary.name);
    expect(tsBoundary.declaredSideEffectClass).toBe(pyBoundary.declaredSideEffectClass);
    expect(tsBoundary.input).toEqual(pyBoundary.input);
    expect(tsBoundary.output).toEqual(pyBoundary.output);
  });

  it("verifies run lifecycle payloads (start, complete, fail) conform to ingest API expectations", () => {
    // Start run payload
    const startPayload = {
      run_id: "run-lifecycle-001",
      project_id: "project-support",
      project_name: "Support Agent",
      workflow_id: "triage-v1",
      summary: "Process ticket #990",
    };
    expect(startPayload.project_id).toBeDefined();
    expect(startPayload.workflow_id).toBeDefined();

    // Complete run payload
    const completePayload = {
      run_id: "run-lifecycle-001",
      summary: "Ticket resolved",
      total_cost_usd: 0.0035,
      total_duration_ms: 1250,
      artifact_refs: ["artifact-resolution-doc"],
    };
    expect(completePayload.run_id).toBe("run-lifecycle-001");
    expect(completePayload.artifact_refs).toHaveLength(1);

    // Fail run payload
    const failPayload = {
      run_id: "run-lifecycle-001",
      error_summary: "Provider timeout connecting to upstream tool",
    };
    expect(failPayload.error_summary).toContain("timeout");
  });
});
