import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "./route";
import { fileDiagnosticStore } from "@/lib/diagnostics/fileDiagnosticStore";
import { fileIntegrationStore } from "@/lib/integrations/integrationStore";

const ACCESS_KEY = "dashboard-test-key";
let storeDir: string;
const originalAccessKey = process.env["AGENTPULSE_ACCESS_KEY"];

beforeEach(async () => {
  storeDir = await mkdtemp(join(tmpdir(), "agentpulse-pulse-route-"));
  process.env["AGENTPULSE_STORE_DIR"] = storeDir;
  process.env["AGENTPULSE_ACCESS_KEY"] = ACCESS_KEY;
});

afterEach(async () => {
  delete process.env["AGENTPULSE_STORE_DIR"];
  process.env["AGENTPULSE_ACCESS_KEY"] = originalAccessKey;
  await rm(storeDir, { recursive: true, force: true });
});

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/dashboard/pulse", { headers });
}

describe("GET /api/dashboard/pulse", () => {
  it("requires dashboard access", async () => {
    expect((await GET(request())).status).toBe(401);
  });

  it("returns a stable, empty pulse", async () => {
    const response = await GET(request({ "x-agentpulse-key": ACCESS_KEY }));
    expect(response.status).toBe(200);
    const data = await response.json() as { pulse: { integrationCount: number; integrations: unknown[]; runWindow: { count: number } } };
    expect(data.pulse.integrationCount).toBe(0);
    expect(data.pulse.integrations).toEqual([]);
    expect(data.pulse.runWindow.count).toBe(0);
  });

  it("returns only redacted diagnostics for an integration", async () => {
    await fileIntegrationStore.createIntegration({ projectId: "pulse-project", projectName: "Pulse Project" });
    await fileDiagnosticStore.recordDiagnostic({
      projectId: "pulse-project",
      category: "schema_validation_failed",
      errorCode: "400",
      message: "Rejected API_KEY=very-secret-token",
    });
    const response = await GET(request({ "x-agentpulse-key": ACCESS_KEY }));
    const body = await response.text();
    expect(body).toContain("schema_validation_failed");
    expect(body).not.toContain("very-secret-token");
    expect(body).not.toContain(ACCESS_KEY);
  });
});
