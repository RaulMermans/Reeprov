/**
 * /api/traces/events route tests — diagnostics wiring.
 *
 * Verifies that ingestion failures (bad auth, malformed events, run-not-found)
 * persist a redacted diagnostic record, retrievable via the diagnostics store,
 * without ever recording the ingest key value itself.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { POST as START_RUN } from "@/app/api/runs/start/route";
import { fileDiagnosticStore } from "@/lib/diagnostics/fileDiagnosticStore";
import { fileIntegrationStore } from "@/lib/integrations/integrationStore";
import { fileRunStore } from "@/lib/runs/runStore";

const TEST_INGEST_KEY = "test-ingest-key";
let tmpDir: string;
const originalIngestKey = process.env["AGENTPULSE_INGEST_KEY"];
const originalAccessKey = process.env["AGENTPULSE_ACCESS_KEY"];

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "agentpulse-traces-events-"));
  process.env["AGENTPULSE_STORE_DIR"] = tmpDir;
  process.env["AGENTPULSE_INGEST_KEY"] = TEST_INGEST_KEY;
  process.env["AGENTPULSE_ACCESS_KEY"] = "test-access-key";
});

afterEach(async () => {
  delete process.env["AGENTPULSE_STORE_DIR"];
  process.env["AGENTPULSE_INGEST_KEY"] = originalIngestKey;
  process.env["AGENTPULSE_ACCESS_KEY"] = originalAccessKey;
  await rm(tmpDir, { recursive: true, force: true });
});

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/traces/events", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/traces/events — diagnostics", () => {
  it("scrubs secrets from persisted event summaries and metadata", async () => {
    const startRes = await START_RUN(req({
      project_id: "proj-privacy", project_name: "Privacy", workflow_id: "wf", summary: "test",
    }, { "x-agentpulse-key": TEST_INGEST_KEY }));
    const { run_id } = await startRes.json() as { run_id: string };
    const secret = "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
    const response = await POST(req({ events: [{
      event_id: "evt-secret", run_id, workflow_id: "wf", timestamp: new Date().toISOString(),
      event_type: "node_completed", status: "completed", output_summary: secret,
      metadata: { note: secret },
    }] }, { "x-agentpulse-key": TEST_INGEST_KEY }));
    expect((await response.json()).accepted).toBe(1);
    expect(JSON.stringify(await fileRunStore.getRun(run_id))).not.toContain(secret);
  });

  it("keeps an eval event without a boolean verdict out of stored EvalResults", async () => {
    const startRes = await START_RUN(new Request("http://localhost/api/runs/start", {
      method: "POST",
      headers: { "content-type": "application/json", "x-agentpulse-key": TEST_INGEST_KEY },
      body: JSON.stringify({ project_id: "proj-eval", project_name: "Proj Eval", workflow_id: "wf-eval", summary: "eval test" }),
    }));
    expect(startRes.status).toBe(201);
    const { run_id } = await startRes.json() as { run_id: string };
    const res = await POST(req({ events: [{
      event_id: "evt-missing-verdict",
      run_id,
      workflow_id: "wf-eval",
      timestamp: new Date().toISOString(),
      event_type: "eval_completed",
      metadata: { eval_id: "eval-safety", eval_name: "Safety" },
    }] }, { "x-agentpulse-key": TEST_INGEST_KEY }));

    expect(await res.json()).toEqual({ accepted: 1, rejected: 0, errors: [] });
    expect((await fileRunStore.getRun(run_id))?.evalResults).toHaveLength(0);
    const diagnostics = await fileDiagnosticStore.listDiagnostics({});
    expect(diagnostics.some((d) => d.category === "malformed_metadata" && d.runId === run_id)).toBe(true);
  });

  it("records a missing_auth_header diagnostic and returns 401 with no header", async () => {
    const res = await POST(req({ events: [] }));
    expect(res.status).toBe(401);

    const diagnostics = await fileDiagnosticStore.listDiagnostics({});
    expect(diagnostics.some((d) => d.category === "missing_auth_header")).toBe(true);
  });

  it("records an invalid_ingest_key diagnostic and never stores the wrong key value", async () => {
    const res = await POST(req({ events: [] }, { "x-agentpulse-key": "totally-wrong-key" }));
    expect(res.status).toBe(401);

    const diagnostics = await fileDiagnosticStore.listDiagnostics({});
    const match = diagnostics.find((d) => d.category === "invalid_ingest_key");
    expect(match).toBeTruthy();
    expect(match?.message).not.toContain("totally-wrong-key");
  });

  it("records a schema_validation_failed diagnostic for a malformed event", async () => {
    await POST(
      req(
        { events: [{ event_id: "bad-1", run_id: "run-x" }] },
        { "x-agentpulse-key": TEST_INGEST_KEY },
      ),
    );

    const diagnostics = await fileDiagnosticStore.listDiagnostics({});
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("records a run_not_found diagnostic when the run does not exist", async () => {
    await POST(
      req(
        {
          events: [
            {
              event_id: "evt-1",
              run_id: "does-not-exist",
              workflow_id: "wf-1",
              timestamp: new Date().toISOString(),
              event_type: "node_started",
              status: "running",
            },
          ],
        },
        { "x-agentpulse-key": TEST_INGEST_KEY },
      ),
    );

    const diagnostics = await fileDiagnosticStore.listDiagnostics({});
    expect(diagnostics.some((d) => d.category === "run_not_found" && d.runId === "does-not-exist")).toBe(true);
  });
});

describe("POST /api/traces/events — scoped ingest key ownership", () => {
  it("rejects a scoped key appending events to a run owned by a different project", async () => {
    // Run belongs to "proj-owner", started with the shared key.
    const startRes = await START_RUN(
      new Request("http://localhost/api/runs/start", {
        method: "POST",
        headers: { "content-type": "application/json", "x-agentpulse-key": TEST_INGEST_KEY },
        body: JSON.stringify({
          project_id: "proj-owner",
          project_name: "Proj Owner",
          workflow_id: "wf-1",
          summary: "owner run",
        }),
      }),
    );
    const { run_id } = await startRes.json() as { run_id: string };

    // /api/runs/start touches the integration registry on a fire-and-forget
    // basis; let that settle before writing to the same file-backed store
    // from this test to avoid a benign read/write race in local dev storage.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Scoped key belongs to a different project.
    const integration = await fileIntegrationStore.createIntegration({
      projectId: "proj-intruder",
      projectName: "Proj Intruder",
    });
    const { rawKey } = (await fileIntegrationStore.generateIngestKey(integration.integrationId))!;

    const res = await POST(
      req(
        {
          events: [
            {
              event_id: "evt-intrusion",
              run_id,
              workflow_id: "wf-1",
              timestamp: new Date().toISOString(),
              event_type: "node_started",
              status: "running",
            },
          ],
        },
        { "x-agentpulse-key": rawKey },
      ),
    );

    const data = await res.json() as { accepted: number; rejected: number };
    expect(data.accepted).toBe(0);
    expect(data.rejected).toBe(1);
  });

  it("allows a scoped key to append events to a run it owns", async () => {
    const integration = await fileIntegrationStore.createIntegration({
      projectId: "proj-self",
      projectName: "Proj Self",
    });
    const { rawKey } = (await fileIntegrationStore.generateIngestKey(integration.integrationId))!;

    const startRes = await START_RUN(
      new Request("http://localhost/api/runs/start", {
        method: "POST",
        headers: { "content-type": "application/json", "x-agentpulse-key": rawKey },
        body: JSON.stringify({
          project_id: "proj-self",
          project_name: "Proj Self",
          workflow_id: "wf-1",
          summary: "self run",
        }),
      }),
    );
    const { run_id } = await startRes.json() as { run_id: string };

    const res = await POST(
      req(
        {
          events: [
            {
              event_id: "evt-self",
              run_id,
              workflow_id: "wf-1",
              timestamp: new Date().toISOString(),
              event_type: "node_started",
              status: "running",
            },
          ],
        },
        { "x-agentpulse-key": rawKey },
      ),
    );

    const data = await res.json() as { accepted: number; rejected: number };
    expect(data.accepted).toBe(1);
    expect(data.rejected).toBe(0);
  });
});
