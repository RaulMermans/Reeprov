import { afterEach, describe, expect, it, vi } from "vitest";
import { ReeprovClient } from "../../packages/client-typescript/src/client";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("SDK ingestion acknowledgement", () => {
  it("rejects an HTTP 200 batch that stored no boundary in fail-closed mode", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      accepted: 0, rejected: 1, errors: [{ message: "Evidence unavailable" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new ReeprovClient({ ingestKey: "synthetic-key", failOpen: false });
    await expect(client.captureBoundary("run-1", {
      boundaryType: "tool_call", name: "lookup", input: {}, output: {},
    })).rejects.toThrow("Evidence unavailable");
  });

  it("rejects an HTTP 200 event batch with rejected records", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      accepted: 0, rejected: 1, errors: [{ message: "Run not found" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new ReeprovClient({ ingestKey: "synthetic-key", failOpen: false });
    await expect(client.emitTraceEvent({
      event_id: "event-1", run_id: "missing", workflow_id: "wf", timestamp: new Date().toISOString(),
      event_type: "node_completed", status: "completed",
    })).rejects.toThrow("Run not found");
  });

  it("sends the eval identifier required for stored evaluation results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      accepted: 1, rejected: 0, errors: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    globalThis.fetch = fetchMock;
    const client = new ReeprovClient({ ingestKey: "synthetic-key", failOpen: false });
    await client.evalCompleted({ run_id: "run-1", eval_id: "critical-escalation",
      eval_name: "Critical escalation", passed: false, score: 0 });
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(payload.events[0].metadata).toMatchObject({
      eval_id: "critical-escalation", eval_name: "Critical escalation", passed: false,
    });
  });
});
