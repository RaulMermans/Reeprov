/**
 * Scoped ingest key generation/rotation/revocation route tests.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST, DELETE } from "./route";
import { fileIntegrationStore } from "@/lib/integrations/integrationStore";

const TEST_ACCESS_KEY = "test-dashboard-key";
let tmpDir: string;
const originalAccessKey = process.env["AGENTPULSE_ACCESS_KEY"];

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "agentpulse-ingest-key-route-"));
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
  return new Request("http://localhost/api/integrations/x/ingest-key", {
    method: "POST",
    headers,
  });
}

describe("POST /api/integrations/[integrationId]/ingest-key", () => {
  it("requires the dashboard access key", async () => {
    const res = await POST(req(), ctx("does-not-matter"));
    expect(res.status).toBe(401);
  });

  it("returns 404 for a nonexistent integration", async () => {
    const res = await POST(req({ "x-agentpulse-key": TEST_ACCESS_KEY }), ctx("integ_missing"));
    expect(res.status).toBe(404);
  });

  it("generates a raw key exactly once and never persists it", async () => {
    const integration = await fileIntegrationStore.createIntegration({
      projectId: "proj-a",
      projectName: "Project A",
    });

    const res = await POST(req({ "x-agentpulse-key": TEST_ACCESS_KEY }), ctx(integration.integrationId));
    expect(res.status).toBe(200);
    const data = await res.json() as { integration: { ingestKeyPreview?: string }; rawKey: string };
    expect(data.rawKey).toMatch(/^ree_live_/);
    expect(data.integration.ingestKeyPreview).toBeTruthy();

    const saved = await fileIntegrationStore.getIntegration(integration.integrationId);
    expect(JSON.stringify(saved)).not.toContain(data.rawKey);
  });

  it("rotating replaces the previous key", async () => {
    const integration = await fileIntegrationStore.createIntegration({
      projectId: "proj-b",
      projectName: "Project B",
    });

    const first = await POST(req({ "x-agentpulse-key": TEST_ACCESS_KEY }), ctx(integration.integrationId));
    const firstData = await first.json() as { rawKey: string };

    const second = await POST(req({ "x-agentpulse-key": TEST_ACCESS_KEY }), ctx(integration.integrationId));
    const secondData = await second.json() as { rawKey: string };

    expect(firstData.rawKey).not.toBe(secondData.rawKey);
  });
});

describe("DELETE /api/integrations/[integrationId]/ingest-key", () => {
  it("requires the dashboard access key", async () => {
    const res = await DELETE(req(), ctx("does-not-matter"));
    expect(res.status).toBe(401);
  });

  it("clears the scoped key preview", async () => {
    const integration = await fileIntegrationStore.createIntegration({
      projectId: "proj-c",
      projectName: "Project C",
    });
    await POST(req({ "x-agentpulse-key": TEST_ACCESS_KEY }), ctx(integration.integrationId));

    const res = await DELETE(req({ "x-agentpulse-key": TEST_ACCESS_KEY }), ctx(integration.integrationId));
    expect(res.status).toBe(200);
    const data = await res.json() as { integration: { ingestKeyPreview?: string } };
    expect(data.integration.ingestKeyPreview).toBeUndefined();
  });
});
