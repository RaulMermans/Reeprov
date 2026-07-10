/**
 * Fixture importer route tests.
 *
 * Verifies the customer-support-triage fixture can be imported as a fresh,
 * fully-formed run (trace events, tool calls, eval results, artifact) without
 * any BlogAgent-specific coupling, that repeated imports don't collide, and
 * that the route fails closed for unknown fixture ids and missing auth.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { fileRunStore } from "@/lib/runs/runStore";

const TEST_ACCESS_KEY = "test-dashboard-key";
let tmpDir: string;
const originalAccessKey = process.env["AGENTPULSE_ACCESS_KEY"];

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "agentpulse-fixture-import-"));
  process.env["AGENTPULSE_STORE_DIR"] = tmpDir;
  process.env["AGENTPULSE_ACCESS_KEY"] = TEST_ACCESS_KEY;
});

afterEach(async () => {
  delete process.env["AGENTPULSE_STORE_DIR"];
  process.env["AGENTPULSE_ACCESS_KEY"] = originalAccessKey;
  await rm(tmpDir, { recursive: true, force: true });
});

function ctx(fixtureId: string) {
  return { params: Promise.resolve({ fixtureId }) };
}

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/fixtures/x/import", { method: "POST", headers });
}

describe("POST /api/fixtures/[fixtureId]/import", () => {
  it("requires the dashboard access key", async () => {
    const res = await POST(req(), ctx("customer-support-triage"));
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown fixture id", async () => {
    const res = await POST(req({ "x-agentpulse-key": TEST_ACCESS_KEY }), ctx("not-a-real-fixture"));
    expect(res.status).toBe(404);
  });

  it("imports the customer-support-triage fixture as a fresh run", async () => {
    const res = await POST(req({ "x-agentpulse-key": TEST_ACCESS_KEY }), ctx("customer-support-triage"));
    expect(res.status).toBe(200);

    const data = await res.json() as { ok: boolean; runId: string; redirectTo: string };
    expect(data.ok).toBe(true);
    expect(data.runId).toMatch(/^fixture-/);
    expect(data.redirectTo).toBe(`/dashboard/runs/${data.runId}`);

    const saved = await fileRunStore.getRun(data.runId);
    expect(saved).not.toBeNull();
    expect(saved!.runRecord.project_id).toBe("customer-support-triage");
    expect(saved!.traceEvents.length).toBeGreaterThan(0);
    expect(saved!.toolCalls.length).toBeGreaterThan(0);
    expect(saved!.evalResults.length).toBeGreaterThan(0);
    expect(saved!.runRecord.artifact_refs.length).toBeGreaterThan(0);

    // Every persisted record must carry the freshly generated run_id, not the
    // fixture file's original hardcoded id.
    expect(saved!.runRecord.run_id).toBe(data.runId);
    for (const event of saved!.traceEvents) {
      expect(event.run_id).toBe(data.runId);
    }
  });

  it("generates a distinct run each time so repeated imports never collide", async () => {
    const first = await POST(req({ "x-agentpulse-key": TEST_ACCESS_KEY }), ctx("customer-support-triage"));
    const second = await POST(req({ "x-agentpulse-key": TEST_ACCESS_KEY }), ctx("customer-support-triage"));

    const firstData = await first.json() as { runId: string };
    const secondData = await second.json() as { runId: string };

    expect(firstData.runId).not.toBe(secondData.runId);

    const both = await fileRunStore.listRuns({ projectId: "customer-support-triage" });
    expect(both.length).toBe(2);
  });
});
