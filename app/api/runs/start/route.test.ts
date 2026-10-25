/**
 * /api/runs/start route tests — scoped ingest key authorization.
 *
 * Verifies that a per-integration scoped ingest key can start runs for its
 * own project but is rejected (fail-closed) for any other project, and that
 * the shared deployment-wide key keeps working unscoped (backward compat).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { fileIntegrationStore } from "@/lib/integrations/integrationStore";

const TEST_INGEST_KEY = "test-shared-ingest-key";
let tmpDir: string;
const originalIngestKey = process.env["AGENTPULSE_INGEST_KEY"];
const originalAccessKey = process.env["AGENTPULSE_ACCESS_KEY"];

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "agentpulse-runs-start-"));
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

function req(body: unknown, key: string): Request {
  return new Request("http://localhost/api/runs/start", {
    method: "POST",
    headers: { "content-type": "application/json", "x-agentpulse-key": key },
    body: JSON.stringify(body),
  });
}

describe("POST /api/runs/start — auth", () => {
  it("scrubs sensitive summary content before storing or returning the run", async () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
    const res = await POST(req({
      project_id: "privacy", project_name: "Privacy", workflow_id: "wf", summary: secret,
    }, TEST_INGEST_KEY));
    expect(res.status).toBe(201);
    expect(JSON.stringify(await res.json())).not.toContain(secret);
  });

  it("accepts the shared deployment-wide ingest key for any project (backward compat)", async () => {
    const res = await POST(
      req(
        { project_id: "any-project", project_name: "Any Project", workflow_id: "wf-1", summary: "test" },
        TEST_INGEST_KEY,
      ),
    );
    expect(res.status).toBe(201);
  });

  it("accepts a scoped key for its own project", async () => {
    const integration = await fileIntegrationStore.createIntegration({
      projectId: "proj-owned",
      projectName: "Proj Owned",
    });
    const { rawKey } = (await fileIntegrationStore.generateIngestKey(integration.integrationId))!;

    const res = await POST(
      req(
        { project_id: "proj-owned", project_name: "Proj Owned", workflow_id: "wf-1", summary: "test" },
        rawKey,
      ),
    );
    expect(res.status).toBe(201);
  });

  it("rejects a scoped key attempting to start a run for a different project", async () => {
    const integration = await fileIntegrationStore.createIntegration({
      projectId: "proj-owned",
      projectName: "Proj Owned",
    });
    const { rawKey } = (await fileIntegrationStore.generateIngestKey(integration.integrationId))!;

    const res = await POST(
      req(
        { project_id: "proj-other", project_name: "Proj Other", workflow_id: "wf-1", summary: "test" },
        rawKey,
      ),
    );
    expect(res.status).toBe(403);
  });

  it("rejects an unrecognized key entirely", async () => {
    const res = await POST(
      req(
        { project_id: "any-project", project_name: "Any Project", workflow_id: "wf-1", summary: "test" },
        "not-a-real-key",
      ),
    );
    expect(res.status).toBe(401);
  });
});
