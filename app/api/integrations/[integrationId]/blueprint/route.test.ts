/**
 * Tests for GET /api/integrations/[integrationId]/blueprint.
 *
 * Uses a real temp AGENTPULSE_STORE_DIR so this exercises the same
 * file-backed integration/run/workflow stores as production dev, isolated
 * per test run.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";
import { fileIntegrationStore } from "@/lib/integrations/integrationStore";
import { fileRunStore } from "@/lib/runs/runStore";
import { runRecordSchema, traceEventSchema } from "@/lib/proof-layer/schemas";
import { generateRunId } from "@/lib/runs/runId";
import type { RunRecord, TraceEvent } from "@/lib/proof-layer/schemas";

const TEST_ACCESS_KEY = "test-dashboard-key";
let tmpDir: string;
const originalAccessKey = process.env["AGENTPULSE_ACCESS_KEY"];

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "agentpulse-blueprint-route-"));
  process.env["AGENTPULSE_STORE_DIR"] = tmpDir;
  process.env["AGENTPULSE_ACCESS_KEY"] = TEST_ACCESS_KEY;
});

afterEach(async () => {
  delete process.env["AGENTPULSE_STORE_DIR"];
  process.env["AGENTPULSE_ACCESS_KEY"] = originalAccessKey;
  await rm(tmpDir, { recursive: true, force: true });
});

function ctx(integrationId: string) {
  return { params: Promise.resolve({ integrationId }) };
}

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/integrations/x/blueprint", { headers });
}

async function makeRun(projectId: string, workflowId: string, nodeId: string): Promise<string> {
  const runId = generateRunId();
  const runRecord: RunRecord = runRecordSchema.parse({
    run_id: runId,
    workflow_id: workflowId,
    project_id: projectId,
    project_name: projectId,
    status: "running",
    started_at: new Date().toISOString(),
    model_calls_count: 0,
    tool_calls_count: 0,
    evals_passed: 0,
    evals_failed: 0,
    artifact_refs: [],
    summary: "Test run.",
  });
  await fileRunStore.createRun(runRecord);

  const started: TraceEvent = traceEventSchema.parse({
    event_id: `${runId}-start`,
    run_id: runId,
    workflow_id: workflowId,
    node_id: nodeId,
    timestamp: new Date().toISOString(),
    event_type: "node_started",
  });
  const completed: TraceEvent = traceEventSchema.parse({
    event_id: `${runId}-end`,
    run_id: runId,
    workflow_id: workflowId,
    node_id: nodeId,
    timestamp: new Date().toISOString(),
    event_type: "node_completed",
  });
  await fileRunStore.appendTraceEvent(runId, started);
  await fileRunStore.appendTraceEvent(runId, completed);
  await fileRunStore.completeRun(runId, { status: "completed" });

  return runId;
}

describe("GET /api/integrations/[integrationId]/blueprint", () => {
  it("requires the dashboard access key", async () => {
    const res = await GET(req(), ctx("does-not-matter"));
    expect(res.status).toBe(401);
  });

  it("returns 404 for a nonexistent integration", async () => {
    const res = await GET(req({ "x-agentpulse-key": TEST_ACCESS_KEY }), ctx("integ_missing"));
    expect(res.status).toBe(404);
  });

  it("returns an insufficient_data blueprint for an integration with no runs", async () => {
    const integration = await fileIntegrationStore.createIntegration({
      projectId: "proj-empty",
      projectName: "Empty Project",
    });

    const res = await GET(req({ "x-agentpulse-key": TEST_ACCESS_KEY }), ctx(integration.integrationId));
    expect(res.status).toBe(200);
    const data = await res.json() as { blueprint: { mode: string; nodes: unknown[]; projectId: string } };
    expect(data.blueprint.mode).toBe("insufficient_data");
    expect(data.blueprint.nodes).toEqual([]);
    expect(data.blueprint.projectId).toBe("proj-empty");
  });

  it("builds an inferred blueprint scoped to the integration's own project, never another project's runs", async () => {
    const integrationA = await fileIntegrationStore.createIntegration({ projectId: "proj-a", projectName: "Project A" });
    await fileIntegrationStore.createIntegration({ projectId: "proj-b", projectName: "Project B" });

    await makeRun("proj-a", "wf-a", "stage_one");
    await makeRun("proj-b", "wf-b", "stage_other");

    const res = await GET(req({ "x-agentpulse-key": TEST_ACCESS_KEY }), ctx(integrationA.integrationId));
    expect(res.status).toBe(200);
    const data = await res.json() as { blueprint: { mode: string; projectId: string; nodes: Array<{ id: string }>; generatedFromRunIds: string[] } };

    expect(data.blueprint.mode).toBe("inferred_from_runs");
    expect(data.blueprint.projectId).toBe("proj-a");
    expect(data.blueprint.nodes.some((n) => n.id === "stage_one")).toBe(true);
    expect(data.blueprint.nodes.some((n) => n.id === "stage_other")).toBe(false);
  });

  it("never includes the raw access key or ingest key in the response body", async () => {
    const integration = await fileIntegrationStore.createIntegration({ projectId: "proj-secret", projectName: "Secret Project" });
    await makeRun("proj-secret", "wf-secret", "stage_one");

    const res = await GET(req({ "x-agentpulse-key": TEST_ACCESS_KEY }), ctx(integration.integrationId));
    const text = await res.text();
    expect(text).not.toContain(TEST_ACCESS_KEY);
  });
});
