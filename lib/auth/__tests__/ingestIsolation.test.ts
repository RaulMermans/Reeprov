import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeRequest, AccessControlError } from "../accessControl";
import { fileIntegrationStore } from "@/lib/integrations/integrationStore";

describe("Ingest Isolation Layer (Sprint Item 7)", () => {
  const originalEnv = { ...process.env };
  let projectAKey: string;
  let projectBKey: string;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    delete process.env.AGENTPULSE_MODE; // personal_local default

    // Create Project A integration & key
    const integA = await fileIntegrationStore.createIntegration({
      projectId: "project-alpha",
      projectName: "Project Alpha",
    });
    const keyResultA = await fileIntegrationStore.generateIngestKey(integA.integrationId);
    expect(keyResultA).not.toBeNull();
    projectAKey = keyResultA!.rawKey;

    // Create Project B integration & key
    const integB = await fileIntegrationStore.createIntegration({
      projectId: "project-beta",
      projectName: "Project Beta",
    });
    const keyResultB = await fileIntegrationStore.generateIngestKey(integB.integrationId);
    expect(keyResultB).not.toBeNull();
    projectBKey = keyResultB!.rawKey;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function makeRequest(
    url: string,
    key?: string,
    options?: { method?: string; headerName?: "x-agentpulse-key" | "authorization" }
  ): Request {
    const headers = new Headers();
    headers.set("host", "127.0.0.1:3000");

    if (key) {
      if (options?.headerName === "authorization") {
        headers.set("authorization", `Bearer ${key}`);
      } else {
        headers.set("x-agentpulse-key", key);
      }
    }

    return new Request(url, {
      method: options?.method || "GET",
      headers,
    });
  }

  it("1. Ingest key authorizes run start/trace/boundary/complete/fail (INGEST capability)", async () => {
    // start run
    const startReq = makeRequest("http://127.0.0.1:3000/api/runs/start", projectAKey, { method: "POST" });
    const startAuth = await authorizeRequest(startReq, { capability: "INGEST", projectId: "project-alpha" });
    expect(startAuth.authorized).toBe(true);
    expect(startAuth.capability).toBe("INGEST");
    expect(startAuth.projectId).toBe("project-alpha");

    // trace events
    const eventReq = makeRequest("http://127.0.0.1:3000/api/traces/events", projectAKey, { method: "POST" });
    const eventAuth = await authorizeRequest(eventReq, { capability: "INGEST", projectId: "project-alpha" });
    expect(eventAuth.authorized).toBe(true);

    // boundaries
    const boundReq = makeRequest("http://127.0.0.1:3000/api/traces/boundaries", projectAKey, { method: "POST" });
    const boundAuth = await authorizeRequest(boundReq, { capability: "INGEST", projectId: "project-alpha" });
    expect(boundAuth.authorized).toBe(true);

    // run complete
    const completeReq = makeRequest("http://127.0.0.1:3000/api/runs/complete", projectAKey, { method: "POST" });
    const completeAuth = await authorizeRequest(completeReq, { capability: "INGEST", projectId: "project-alpha" });
    expect(completeAuth.authorized).toBe(true);

    // run fail
    const failReq = makeRequest("http://127.0.0.1:3000/api/runs/fail", projectAKey, { method: "POST" });
    const failAuth = await authorizeRequest(failReq, { capability: "INGEST", projectId: "project-alpha" });
    expect(failAuth.authorized).toBe(true);
  });

  it("2. Ingest key DENIED for dashboard read (run browsing)", async () => {
    const req = makeRequest("http://127.0.0.1:3000/api/runs", projectAKey);

    await expect(authorizeRequest(req, { capability: "DASHBOARD_READ" }))
      .rejects.toThrow(AccessControlError);

    try {
      await authorizeRequest(req, { capability: "DASHBOARD_READ" });
    } catch (err) {
      const error = err as AccessControlError;
      expect(error.status).toBe(403);
      expect(error.code).toBe("ingest_key_disallowed");
    }
  });

  it("3. Ingest key DENIED for comparison browsing", async () => {
    const req = makeRequest("http://127.0.0.1:3000/api/runs/compare", projectAKey);

    await expect(authorizeRequest(req, { capability: "DASHBOARD_READ" }))
      .rejects.toThrow(AccessControlError);

    try {
      await authorizeRequest(req, { capability: "DASHBOARD_READ" });
    } catch (err) {
      const error = err as AccessControlError;
      expect(error.status).toBe(403);
      expect(error.code).toBe("ingest_key_disallowed");
    }
  });

  it("4. Ingest key DENIED for eval administration", async () => {
    const req = makeRequest("http://127.0.0.1:3000/api/evals/suites", projectAKey, { method: "POST" });

    await expect(authorizeRequest(req, { capability: "DASHBOARD_WRITE" }))
      .rejects.toThrow(AccessControlError);

    try {
      await authorizeRequest(req, { capability: "DASHBOARD_WRITE" });
    } catch (err) {
      const error = err as AccessControlError;
      expect(error.status).toBe(403);
      expect(error.code).toBe("ingest_key_disallowed");
    }
  });

  it("5. Ingest key DENIED for experiments", async () => {
    const req = makeRequest("http://127.0.0.1:3000/api/experiments/plan", projectAKey, { method: "POST" });

    await expect(authorizeRequest(req, { capability: "DASHBOARD_WRITE" }))
      .rejects.toThrow(AccessControlError);

    try {
      await authorizeRequest(req, { capability: "DASHBOARD_WRITE" });
    } catch (err) {
      const error = err as AccessControlError;
      expect(error.status).toBe(403);
      expect(error.code).toBe("ingest_key_disallowed");
    }
  });

  it("6. Ingest key DENIED for regression baselines", async () => {
    const req = makeRequest("http://127.0.0.1:3000/api/baselines", projectAKey, { method: "POST" });

    await expect(authorizeRequest(req, { capability: "DASHBOARD_WRITE" }))
      .rejects.toThrow(AccessControlError);

    try {
      await authorizeRequest(req, { capability: "DASHBOARD_WRITE" });
    } catch (err) {
      const error = err as AccessControlError;
      expect(error.status).toBe(403);
      expect(error.code).toBe("ingest_key_disallowed");
    }
  });

  it("7. Ingest key DENIED for project export", async () => {
    const req = makeRequest("http://127.0.0.1:3000/api/projects/project-alpha/export", projectAKey);

    await expect(authorizeRequest(req, { capability: "DASHBOARD_READ", projectId: "project-alpha" }))
      .rejects.toThrow(AccessControlError);

    try {
      await authorizeRequest(req, { capability: "DASHBOARD_READ", projectId: "project-alpha" });
    } catch (err) {
      const error = err as AccessControlError;
      expect(error.status).toBe(403);
      expect(error.code).toBe("ingest_key_disallowed");
    }
  });

  it("8. Ingest key DENIED for project deletion", async () => {
    const req = makeRequest(
      "http://127.0.0.1:3000/api/projects/project-alpha",
      projectAKey,
      { method: "DELETE" }
    );

    await expect(authorizeRequest(req, { capability: "DASHBOARD_WRITE", projectId: "project-alpha" }))
      .rejects.toThrow(AccessControlError);

    try {
      await authorizeRequest(req, { capability: "DASHBOARD_WRITE", projectId: "project-alpha" });
    } catch (err) {
      const error = err as AccessControlError;
      expect(error.status).toBe(403);
      expect(error.code).toBe("ingest_key_disallowed");
    }
  });

  it("9. Ingest key DENIED for admin operations", async () => {
    const req = makeRequest("http://127.0.0.1:3000/api/admin/migrate", projectAKey, { method: "POST" });

    await expect(authorizeRequest(req, { capability: "ADMIN" }))
      .rejects.toThrow(AccessControlError);

    try {
      await authorizeRequest(req, { capability: "ADMIN" });
    } catch (err) {
      const error = err as AccessControlError;
      expect(error.status).toBe(403);
      expect(error.code).toBe("ingest_key_disallowed");
    }
  });

  it("10. Project A key DENIED for project B ingestion", async () => {
    const req = makeRequest(
      "http://127.0.0.1:3000/api/traces/events",
      projectAKey,
      { method: "POST" }
    );

    await expect(
      authorizeRequest(req, {
        capability: "INGEST",
        projectId: "project-beta",
      })
    ).rejects.toThrow(AccessControlError);

    try {
      await authorizeRequest(req, {
        capability: "INGEST",
        projectId: "project-beta",
      });
    } catch (err) {
      const error = err as AccessControlError;
      expect(error.status).toBe(403);
      expect(error.code).toBe("forbidden_project_scope");
      expect(error.message).toContain("cannot operate on project 'project-beta'");
    }
  });

  it("rejects invalid or unknown ingest key on ingestion with 401", async () => {
    const req = makeRequest(
      "http://127.0.0.1:3000/api/runs/start",
      "ap_live_00000000000000000000000000000000",
      { method: "POST" }
    );

    await expect(
      authorizeRequest(req, { capability: "INGEST", projectId: "project-alpha" })
    ).rejects.toThrow(AccessControlError);

    try {
      await authorizeRequest(req, { capability: "INGEST", projectId: "project-alpha" });
    } catch (err) {
      const error = err as AccessControlError;
      expect(error.status).toBe(401);
      expect(error.code).toBe("invalid_ingest_key");
    }
  });
});
