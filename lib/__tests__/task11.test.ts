/**
 * Task 11 — Integration Registry API tests and UI smoke tests.
 *
 * API tests run the actual route handlers.
 * UI structure tests read source files directly.
 * Template tests verify SDK file invariants.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path, { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as integrationsGet, POST as integrationsPost } from "../../app/api/integrations/route";
import {
  GET as integrationGet,
  PATCH as integrationPatch,
  DELETE as integrationDelete,
} from "../../app/api/integrations/[integrationId]/route";
import { POST as testEventPost } from "../../app/api/integrations/[integrationId]/test-event/route";
import { fileIntegrationStore } from "../../lib/integrations/integrationStore";
import { fileRunStore } from "../../lib/runs/runStore";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

// ── Test setup ────────────────────────────────────────────────────────────────

let tmpDir: string;
const originalStoreDir = process.env["AGENTPULSE_STORE_DIR"];
const originalAccessKey = process.env["AGENTPULSE_ACCESS_KEY"];

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "agentpulse-task11-"));
  process.env["AGENTPULSE_STORE_DIR"] = tmpDir;
  process.env["AGENTPULSE_ACCESS_KEY"] = "test-key-task11";
});

afterEach(async () => {
  if (originalStoreDir === undefined) {
    delete process.env["AGENTPULSE_STORE_DIR"];
  } else {
    process.env["AGENTPULSE_STORE_DIR"] = originalStoreDir;
  }
  if (originalAccessKey === undefined) {
    delete process.env["AGENTPULSE_ACCESS_KEY"];
  } else {
    process.env["AGENTPULSE_ACCESS_KEY"] = originalAccessKey;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

function req(method: string, url: string, headers: Record<string, string> = {}, body?: unknown) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function authHeader() {
  return { "x-agentpulse-key": "test-key-task11" };
}

// ── GET /api/integrations — auth ──────────────────────────────────────────────

describe("GET /api/integrations — auth", () => {
  it("returns 401 without key", async () => {
    const res = await integrationsGet(req("GET", "/api/integrations"));
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong key", async () => {
    const res = await integrationsGet(req("GET", "/api/integrations", { "x-agentpulse-key": "wrong" }));
    expect(res.status).toBe(401);
  });

  it("returns empty list when registry is empty", async () => {
    const res = await integrationsGet(req("GET", "/api/integrations", authHeader()));
    expect(res.status).toBe(200);
    const data = await res.json() as { integrations: unknown[]; count: number };
    expect(data.integrations).toEqual([]);
    expect(data.count).toBe(0);
  });

  it("returns populated list after creating integrations", async () => {
    await fileIntegrationStore.createIntegration({
      projectId: "blog-agent",
      projectName: "Blog Agent",
    });

    const res = await integrationsGet(req("GET", "/api/integrations", authHeader()));
    expect(res.status).toBe(200);
    const data = await res.json() as { integrations: Array<{ projectId: string }>; count: number };
    expect(data.count).toBe(1);
    expect(data.integrations[0]!.projectId).toBe("blog-agent");
  });
});

// ── POST /api/integrations — create ──────────────────────────────────────────

describe("POST /api/integrations", () => {
  it("returns 401 without key", async () => {
    const res = await integrationsPost(req("POST", "/api/integrations", {}, {
      projectId: "x",
      projectName: "X",
    }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when projectId is missing", async () => {
    const res = await integrationsPost(req("POST", "/api/integrations", authHeader(), {
      projectName: "X",
    }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when projectName is missing", async () => {
    const res = await integrationsPost(req("POST", "/api/integrations", authHeader(), {
      projectId: "my-project",
    }));
    expect(res.status).toBe(400);
  });

  it("creates integration and returns 201", async () => {
    const res = await integrationsPost(req("POST", "/api/integrations", authHeader(), {
      projectId: "blog-agent",
      projectName: "Blog Agent",
      description: "Multi-agent blog pipeline",
      language: "python",
    }));
    expect(res.status).toBe(201);
    const data = await res.json() as {
      integrationId: string;
      projectId: string;
      status: string;
      runCount: number;
    };
    expect(data.integrationId).toMatch(/^integ_/);
    expect(data.projectId).toBe("blog-agent");
    expect(data.status).toBe("waiting_for_first_event");
    expect(data.runCount).toBe(0);
  });

  it("created integration appears in the list", async () => {
    await integrationsPost(req("POST", "/api/integrations", authHeader(), {
      projectId: "campaign-sandbox",
      projectName: "Campaign Sandbox",
    }));

    const listRes = await integrationsGet(req("GET", "/api/integrations", authHeader()));
    const data = await listRes.json() as { integrations: Array<{ projectId: string }>; count: number };
    expect(data.count).toBe(1);
    expect(data.integrations[0]!.projectId).toBe("campaign-sandbox");
  });
});

// ── GET /api/integrations/[integrationId] ─────────────────────────────────────

describe("GET /api/integrations/[integrationId]", () => {
  it("returns 401 without key", async () => {
    const res = await integrationGet(
      req("GET", "/api/integrations/integ_abc"),
      { params: Promise.resolve({ integrationId: "integ_abc" }) },
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown integrationId", async () => {
    const res = await integrationGet(
      req("GET", "/api/integrations/integ_ghost", authHeader()),
      { params: Promise.resolve({ integrationId: "integ_ghost" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns integration and recentRuns", async () => {
    const integration = await fileIntegrationStore.createIntegration({
      projectId: "website-auditor",
      projectName: "Website Auditor",
    });

    const res = await integrationGet(
      req("GET", `/api/integrations/${integration.integrationId}`, authHeader()),
      { params: Promise.resolve({ integrationId: integration.integrationId }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as {
      integration: { integrationId: string; projectId: string };
      recentRuns: unknown[];
    };
    expect(data.integration.integrationId).toBe(integration.integrationId);
    expect(data.integration.projectId).toBe("website-auditor");
    expect(Array.isArray(data.recentRuns)).toBe(true);
  });
});

// ── PATCH /api/integrations/[integrationId] ───────────────────────────────────

describe("PATCH /api/integrations/[integrationId]", () => {
  it("returns 401 without key", async () => {
    const res = await integrationPatch(
      req("PATCH", "/api/integrations/integ_abc"),
      { params: Promise.resolve({ integrationId: "integ_abc" }) },
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown integrationId", async () => {
    const res = await integrationPatch(
      req("PATCH", "/api/integrations/integ_ghost", authHeader(), { projectName: "New Name" }),
      { params: Promise.resolve({ integrationId: "integ_ghost" }) },
    );
    expect(res.status).toBe(404);
  });

  it("updates allowed fields", async () => {
    const integration = await fileIntegrationStore.createIntegration({
      projectId: "blog-agent",
      projectName: "Blog Agent",
    });

    const res = await integrationPatch(
      req("PATCH", `/api/integrations/${integration.integrationId}`, authHeader(), {
        projectName: "Blog Agent V2",
        description: "Updated description",
        language: "typescript",
      }),
      { params: Promise.resolve({ integrationId: integration.integrationId }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { projectName: string; description: string; language: string };
    expect(data.projectName).toBe("Blog Agent V2");
    expect(data.description).toBe("Updated description");
    expect(data.language).toBe("typescript");
  });
});

// ── DELETE /api/integrations/[integrationId] ──────────────────────────────────

describe("DELETE /api/integrations/[integrationId]", () => {
  it("returns 401 without key", async () => {
    const res = await integrationDelete(
      req("DELETE", "/api/integrations/integ_abc"),
      { params: Promise.resolve({ integrationId: "integ_abc" }) },
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown integrationId", async () => {
    const res = await integrationDelete(
      req("DELETE", "/api/integrations/integ_ghost", authHeader()),
      { params: Promise.resolve({ integrationId: "integ_ghost" }) },
    );
    expect(res.status).toBe(404);
  });

  it("deletes integration and returns ok", async () => {
    const integration = await fileIntegrationStore.createIntegration({
      projectId: "to-delete",
      projectName: "To Delete",
    });

    const res = await integrationDelete(
      req("DELETE", `/api/integrations/${integration.integrationId}`, authHeader()),
      { params: Promise.resolve({ integrationId: integration.integrationId }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);

    const check = await fileIntegrationStore.getIntegration(integration.integrationId);
    expect(check).toBeNull();
  });
});

// ── POST /api/integrations/[integrationId]/test-event ────────────────────────

describe("POST /api/integrations/[integrationId]/test-event", () => {
  it("returns 401 without key", async () => {
    const res = await testEventPost(
      req("POST", "/api/integrations/integ_abc/test-event"),
      { params: Promise.resolve({ integrationId: "integ_abc" }) },
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown integrationId", async () => {
    const res = await testEventPost(
      req("POST", "/api/integrations/integ_ghost/test-event", authHeader()),
      { params: Promise.resolve({ integrationId: "integ_ghost" }) },
    );
    expect(res.status).toBe(404);
  });

  it("creates a test run and returns redirectTo", async () => {
    const integration = await fileIntegrationStore.createIntegration({
      projectId: "blog-agent",
      projectName: "Blog Agent",
      defaultWorkflowId: "blog-agent-v1",
    });

    const res = await testEventPost(
      req("POST", `/api/integrations/${integration.integrationId}/test-event`, authHeader()),
      { params: Promise.resolve({ integrationId: integration.integrationId }) },
    );
    expect(res.status).toBe(201);
    const data = await res.json() as { ok: boolean; runId: string; redirectTo: string };
    expect(data.ok).toBe(true);
    expect(data.runId).toMatch(/^test-/);
    expect(data.redirectTo).toContain("/dashboard/runs/");
  });

  it("test run is visible in run store", async () => {
    const integration = await fileIntegrationStore.createIntegration({
      projectId: "website-auditor",
      projectName: "Website Auditor",
    });

    const res = await testEventPost(
      req("POST", `/api/integrations/${integration.integrationId}/test-event`, authHeader()),
      { params: Promise.resolve({ integrationId: integration.integrationId }) },
    );
    expect(res.status).toBe(201);
    const data = await res.json() as { runId: string };

    const run = await fileRunStore.getRun(data.runId);
    expect(run).not.toBeNull();
    expect(run!.runRecord.project_id).toBe("website-auditor");
    expect(run!.runRecord.status).toBe("completed");
    expect(run!.runRecord.evals_passed).toBeGreaterThan(0);
  });

  it("test event marks integration as receiving_events", async () => {
    const integration = await fileIntegrationStore.createIntegration({
      projectId: "test-project",
      projectName: "Test Project",
    });
    expect(integration.status).toBe("waiting_for_first_event");

    await testEventPost(
      req("POST", `/api/integrations/${integration.integrationId}/test-event`, authHeader()),
      { params: Promise.resolve({ integrationId: integration.integrationId }) },
    );

    const updated = await fileIntegrationStore.getIntegrationByProjectId("test-project");
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("receiving_events");
    expect(updated!.lastEventAt).toBeDefined();
  });

  it("test run has model, tool, eval, artifact, and warning evidence", async () => {
    const integration = await fileIntegrationStore.createIntegration({
      projectId: "model-test",
      projectName: "Model Test",
    });

    const res = await testEventPost(
      req("POST", `/api/integrations/${integration.integrationId}/test-event`, authHeader()),
      { params: Promise.resolve({ integrationId: integration.integrationId }) },
    );
    const data = await res.json() as { runId: string };

    const run = await fileRunStore.getRun(data.runId);
    expect(run!.runRecord.model_calls_count).toBe(1);
    expect(run!.runRecord.tool_calls_count).toBe(1);
    expect(run!.runRecord.evals_passed).toBe(1);
    expect(run!.runRecord.evals_failed).toBe(0);
    expect(run!.runRecord.total_cost_usd).toBeGreaterThan(0);
    expect(run!.runRecord.artifact_refs).toHaveLength(1);
    expect(run!.traceEvents.some((event) => event.event_type === "error")).toBe(true);
    expect(run!.toolCalls[0]?.permission_class).toBe("read_only");
  });
});

// ── Ingestion pipeline auto-update ────────────────────────────────────────────

describe("ingestion pipeline auto-updates integration", () => {
  it("touchIntegrationForProject auto-creates an integration for unknown projectId", async () => {
    const { touchIntegrationForProject } = await import("../../lib/integrations/integrationStore");
    await touchIntegrationForProject("auto-created-project", { runId: "run_001" });

    const found = await fileIntegrationStore.getIntegrationByProjectId("auto-created-project");
    expect(found).not.toBeNull();
    expect(found!.status).toBe("receiving_events");
    expect(found!.lastRunId).toBe("run_001");
  });

  it("touchIntegrationForProject is non-fatal for errors", async () => {
    const { touchIntegrationForProject } = await import("../../lib/integrations/integrationStore");
    // Should not throw even if store fails for any reason
    await expect(
      touchIntegrationForProject("safe-project", { runId: "run_x" }),
    ).resolves.not.toThrow();
  });
});

// ── NavBar includes Integrations ──────────────────────────────────────────────

describe("NavBar routes — Integrations", () => {
  it("includes an Integrations link to /dashboard/integrations", () => {
    const src = read("components/layout/NavBar.tsx");
    expect(src).toContain('href: "/dashboard/integrations"');
    expect(src).toContain("Integrations");
  });
});

// ── Integrations dashboard page smoke ─────────────────────────────────────────

describe("Integrations dashboard page", () => {
  it("page file exists", () => {
    const src = read("app/dashboard/integrations/page.tsx");
    expect(src).toContain("IntegrationsPage");
  });

  it("page is a client component", () => {
    const src = read("app/dashboard/integrations/page.tsx");
    expect(src).toContain('"use client"');
  });

  it("page shows Project Integrations heading", () => {
    const src = read("app/dashboard/integrations/page.tsx");
    expect(src).toContain("Project Integrations");
  });

  it("page includes Add integration CTA", () => {
    const src = read("app/dashboard/integrations/page.tsx");
    expect(src).toContain("Add integration");
  });

  it("page uses /api/integrations endpoint", () => {
    const src = read("app/dashboard/integrations/page.tsx");
    expect(src).toContain("/api/integrations");
  });

  it("page uses mergeAuthHeaders and onUnauthorized", () => {
    const src = read("app/dashboard/integrations/page.tsx");
    expect(src).toContain("mergeAuthHeaders");
    expect(src).toContain("onUnauthorized");
  });
});

// ── Integration detail page smoke ─────────────────────────────────────────────

describe("Integration detail page", () => {
  it("detail page file exists", () => {
    const src = read("app/dashboard/integrations/[integrationId]/page.tsx");
    expect(src).toContain("IntegrationDetailPage");
  });

  it("shows environment variable block", () => {
    const src = read("app/dashboard/integrations/[integrationId]/page.tsx");
    expect(src).toContain("AGENTPULSE_URL");
    expect(src).toContain("AGENTPULSE_INGEST_KEY");
    expect(src).toContain("AGENTPULSE_PROJECT_ID");
    expect(src).toContain("AGENTPULSE_ENABLED");
  });

  it("includes TypeScript, Python, and REST snippet tabs", () => {
    const src = read("app/dashboard/integrations/[integrationId]/page.tsx");
    expect(src).toContain("typescript");
    expect(src).toContain("python");
    expect(src).toContain("rest");
  });

  it("includes Send test event button that uses test-event endpoint", () => {
    const src = read("app/dashboard/integrations/[integrationId]/page.tsx");
    expect(src).toContain("Send test event");
    expect(src).toContain("test-event");
  });

  it("includes troubleshooting section explaining env vars alone do not send events", () => {
    const src = read("app/dashboard/integrations/[integrationId]/page.tsx");
    expect(src).toContain("Environment variables alone do not send events");
    expect(src).toContain("AGENTPULSE_ENABLED=true");
  });

  it("includes recent runs section", () => {
    const src = read("app/dashboard/integrations/[integrationId]/page.tsx");
    expect(src).toContain("Recent Runs");
  });
});

// ── TypeScript SDK template smoke ─────────────────────────────────────────────

describe("TypeScript SDK template", () => {
  it("client file exists", () => {
    const src = read("examples/integrations/typescript/agentpulseClient.ts");
    expect(src).toContain("AgentPulseClient");
  });

  it("reads AGENTPULSE_URL, AGENTPULSE_INGEST_KEY, AGENTPULSE_PROJECT_ID from env", () => {
    const src = read("examples/integrations/typescript/agentpulseClient.ts");
    expect(src).toContain("AGENTPULSE_URL");
    expect(src).toContain("AGENTPULSE_INGEST_KEY");
    expect(src).toContain("AGENTPULSE_PROJECT_ID");
    expect(src).toContain("AGENTPULSE_ENABLED");
  });

  it("is no-op when AGENTPULSE_ENABLED is not true", () => {
    const src = read("examples/integrations/typescript/agentpulseClient.ts");
    expect(src).toContain("AGENTPULSE_ENABLED");
    expect(src).toContain("noop-");
  });

  it("does not log or print the ingest key", () => {
    const src = read("examples/integrations/typescript/agentpulseClient.ts");
    // Must never console.log the key
    expect(src).not.toMatch(/console\.log.*ingestKey/);
    expect(src).not.toMatch(/console\.log.*INGEST_KEY/);
  });

  it("exports startRun, completeRun, failRun, modelCallCompleted, toolCallCompleted, evalCompleted, artifactCreated", () => {
    const src = read("examples/integrations/typescript/agentpulseClient.ts");
    expect(src).toContain("startRun");
    expect(src).toContain("completeRun");
    expect(src).toContain("failRun");
    expect(src).toContain("modelCallCompleted");
    expect(src).toContain("toolCallCompleted");
    expect(src).toContain("evalCompleted");
    expect(src).toContain("artifactCreated");
  });

  it("has a README", () => {
    const src = read("examples/integrations/typescript/README.md");
    expect(src).toContain("AGENTPULSE_ENABLED");
  });
});

// ── Python SDK template smoke ─────────────────────────────────────────────────

describe("Python SDK template", () => {
  it("client file exists", () => {
    const src = read("examples/integrations/python/agentpulse_client.py");
    expect(src).toContain("AgentPulseClient");
  });

  it("reads env vars", () => {
    const src = read("examples/integrations/python/agentpulse_client.py");
    expect(src).toContain("AGENTPULSE_URL");
    expect(src).toContain("AGENTPULSE_INGEST_KEY");
    expect(src).toContain("AGENTPULSE_PROJECT_ID");
    expect(src).toContain("AGENTPULSE_ENABLED");
  });

  it("is no-op when AGENTPULSE_ENABLED is not true", () => {
    const src = read("examples/integrations/python/agentpulse_client.py");
    expect(src).toContain("AGENTPULSE_ENABLED");
    expect(src).toContain("is_enabled");
    expect(src).toContain("noop-");
  });

  it("does not log or print the ingest key", () => {
    const src = read("examples/integrations/python/agentpulse_client.py");
    expect(src).not.toMatch(/print.*ingest_key/i);
    expect(src).not.toMatch(/print.*INGEST_KEY/);
  });

  it("exports start_run, complete_run, fail_run, model_call_completed, tool_call_completed, eval_completed, artifact_created", () => {
    const src = read("examples/integrations/python/agentpulse_client.py");
    expect(src).toContain("def start_run");
    expect(src).toContain("def complete_run");
    expect(src).toContain("def fail_run");
    expect(src).toContain("def model_call_completed");
    expect(src).toContain("def tool_call_completed");
    expect(src).toContain("def eval_completed");
    expect(src).toContain("def artifact_created");
  });

  it("has a README", () => {
    const src = read("examples/integrations/python/README.md");
    expect(src).toContain("AGENTPULSE_ENABLED");
  });
});

// ── REST template smoke ───────────────────────────────────────────────────────

describe("REST template", () => {
  it("README exists with all three endpoint examples", () => {
    const src = read("examples/integrations/rest/README.md");
    expect(src).toContain("/api/runs/start");
    expect(src).toContain("/api/traces/events");
    expect(src).toContain("/api/runs/complete");
    expect(src).toContain("/api/runs/fail");
  });

  it("README uses x-agentpulse-key header", () => {
    const src = read("examples/integrations/rest/README.md");
    expect(src).toContain("x-agentpulse-key");
  });

  it("README explains AGENTPULSE_INGEST_KEY is separate from dashboard key", () => {
    const src = read("examples/integrations/rest/README.md");
    expect(src).toContain("AGENTPULSE_INGEST_KEY");
    expect(src).toContain("dashboard");
  });
});

// ── Runs page and Overview reference Integrations ─────────────────────────────

describe("Runs page and Overview integration links", () => {
  it("Runs page empty state links to /dashboard/integrations", () => {
    const src = read("app/dashboard/runs/page.tsx");
    expect(src).toContain("/dashboard/integrations");
    expect(src).toContain("Add integration");
  });

  it("OverviewLiveRuns empty state links to /dashboard/integrations", () => {
    const src = read("components/dashboard/OverviewLiveRuns.tsx");
    expect(src).toContain("/dashboard/integrations");
    expect(src).toContain("Add integration");
  });
});

// ── GET /api/integrations — filters ──────────────────────────────────────────

describe("GET /api/integrations — filters", () => {
  it("filters by projectId query param", async () => {
    await fileIntegrationStore.createIntegration({ projectId: "filter-a", projectName: "A" });
    await fileIntegrationStore.createIntegration({ projectId: "filter-b", projectName: "B" });

    const res = await integrationsGet(
      new Request("http://localhost/api/integrations?projectId=filter-a", {
        headers: authHeader(),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { integrations: Array<{ projectId: string }>; count: number };
    expect(data.count).toBe(1);
    expect(data.integrations[0]!.projectId).toBe("filter-a");
  });

  it("respects limit query param", async () => {
    for (let i = 0; i < 5; i++) {
      await fileIntegrationStore.createIntegration({ projectId: `proj-${i}`, projectName: `Proj ${i}` });
    }

    const res = await integrationsGet(
      new Request("http://localhost/api/integrations?limit=3", {
        headers: authHeader(),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { integrations: unknown[]; count: number };
    expect(data.integrations).toHaveLength(3);
    expect(data.count).toBe(3);
  });
});

// ── Regression: integration must survive list-after-create ────────────────────
//
// Regression for the bug: "create integration → return to /integrations →
// list shows 'No integrations yet'."
//
// Root causes addressed:
//   1. readIndex() was catching ALL errors including I/O failures and returning [],
//      masking real persistence failures with a "No integrations yet" empty state.
//   2. The page fetch() had no cache: 'no-store', allowing browser caching of the
//      empty response.
//   3. After creating an integration and navigating away, Next.js Router Cache could
//      serve a stale version of /integrations without re-running the effect.

describe("Regression: Blog Agent integration persists across create → list (bug: list shows empty after create)", () => {
  it("Blog Agent (projectId: blog-agent, workflowId: blog-agent-v1, language: python) appears in list after POST then GET", async () => {
    // Step 1: Create via the POST route handler (simulates the Add integration form submit).
    const createRes = await integrationsPost(
      req("POST", "/api/integrations", authHeader(), {
        projectId: "blog-agent",
        projectName: "Blog Agent",
        defaultWorkflowId: "blog-agent-v1",
        language: "python",
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { integrationId: string; projectId: string };
    expect(created.projectId).toBe("blog-agent");

    // Step 2: Simulate "refresh" or "navigate back to /integrations" by calling
    // the GET route handler directly (a fresh request, no shared in-memory state).
    const listRes = await integrationsGet(
      req("GET", "/api/integrations", authHeader()),
    );
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as {
      integrations: Array<{ integrationId: string; projectId: string; defaultWorkflowId?: string; language?: string }>;
      count: number;
    };

    // The integration MUST appear — regression assertion.
    expect(list.count).toBe(1);
    const found = list.integrations[0];
    expect(found).toBeDefined();
    expect(found!.projectId).toBe("blog-agent");
    expect(found!.defaultWorkflowId).toBe("blog-agent-v1");
    expect(found!.language).toBe("python");
    expect(found!.integrationId).toBe(created.integrationId);
  });

  it("integration persists through multiple GET calls (not consumed or evicted on first read)", async () => {
    await integrationsPost(req("POST", "/api/integrations", authHeader(), {
      projectId: "website-auditor",
      projectName: "Website Auditor",
    }));

    // Call GET three times — each simulates a page load / refresh.
    for (let i = 0; i < 3; i++) {
      const res = await integrationsGet(req("GET", "/api/integrations", authHeader()));
      expect(res.status).toBe(200);
      const data = await res.json() as { count: number };
      expect(data.count).toBe(1, `GET call ${i + 1}: expected 1 integration, got ${data.count}`);
    }
  });

  it("multiple integrations all appear in list after creation (no index overwrite)", async () => {
    await integrationsPost(req("POST", "/api/integrations", authHeader(), {
      projectId: "blog-agent",
      projectName: "Blog Agent",
    }));
    await integrationsPost(req("POST", "/api/integrations", authHeader(), {
      projectId: "campaign-sandbox",
      projectName: "Campaign Sandbox",
    }));
    await integrationsPost(req("POST", "/api/integrations", authHeader(), {
      projectId: "website-auditor",
      projectName: "Website Auditor",
    }));

    const listRes = await integrationsGet(req("GET", "/api/integrations", authHeader()));
    const data = await listRes.json() as { integrations: Array<{ projectId: string }>; count: number };
    expect(data.count).toBe(3);
    const ids = data.integrations.map((i) => i.projectId).sort();
    expect(ids).toEqual(["blog-agent", "campaign-sandbox", "website-auditor"]);
  });

  it("detail route returns the correct integration after creation (GET by id)", async () => {
    const createRes = await integrationsPost(
      req("POST", "/api/integrations", authHeader(), {
        projectId: "blog-agent",
        projectName: "Blog Agent",
        defaultWorkflowId: "blog-agent-v1",
        language: "python",
      }),
    );
    const created = await createRes.json() as { integrationId: string };

    // Simulate navigating to the detail page (GET by id).
    const getRes = await integrationGet(
      req("GET", `/api/integrations/${created.integrationId}`, authHeader()),
      { params: Promise.resolve({ integrationId: created.integrationId }) },
    );
    expect(getRes.status).toBe(200);
    const data = await getRes.json() as {
      integration: { projectId: string; defaultWorkflowId?: string; language?: string };
      recentRuns: unknown[];
    };
    expect(data.integration.projectId).toBe("blog-agent");
    expect(data.integration.defaultWorkflowId).toBe("blog-agent-v1");
    expect(data.integration.language).toBe("python");
  });

  it("send test event on a persisted integration works and integration appears in list afterwards", async () => {
    const createRes = await integrationsPost(
      req("POST", "/api/integrations", authHeader(), {
        projectId: "blog-agent",
        projectName: "Blog Agent",
        defaultWorkflowId: "blog-agent-v1",
      }),
    );
    const created = await createRes.json() as { integrationId: string };

    const testRes = await testEventPost(
      req("POST", `/api/integrations/${created.integrationId}/test-event`, authHeader()),
      { params: Promise.resolve({ integrationId: created.integrationId }) },
    );
    expect(testRes.status).toBe(201);

    // Navigate back to the list — integration must still be there.
    const listRes = await integrationsGet(req("GET", "/api/integrations", authHeader()));
    const data = await listRes.json() as { integrations: Array<{ projectId: string; status: string }>; count: number };
    expect(data.count).toBe(1);
    expect(data.integrations[0]!.projectId).toBe("blog-agent");
    expect(data.integrations[0]!.status).toBe("receiving_events");
  });

  it("delete removes the integration from the list (not just the detail)", async () => {
    const createRes = await integrationsPost(
      req("POST", "/api/integrations", authHeader(), {
        projectId: "to-delete",
        projectName: "To Delete",
      }),
    );
    const created = await createRes.json() as { integrationId: string };

    await integrationDelete(
      req("DELETE", `/api/integrations/${created.integrationId}`, authHeader()),
      { params: Promise.resolve({ integrationId: created.integrationId }) },
    );

    const listRes = await integrationsGet(req("GET", "/api/integrations", authHeader()));
    const data = await listRes.json() as { count: number };
    expect(data.count).toBe(0);
  });
});

// ── No silent failure: store I/O errors must surface, not hide as empty list ───

describe("Persistence failure visibility: I/O errors surface as 500, not empty list", () => {
  it("GET /api/integrations returns 200 with empty list when store dir does not exist (legitimate empty state)", async () => {
    // Store dir doesn't exist yet → empty list (not an error).
    const res = await integrationsGet(req("GET", "/api/integrations", authHeader()));
    expect(res.status).toBe(200);
    const data = await res.json() as { integrations: unknown[]; count: number };
    expect(data.integrations).toEqual([]);
    expect(data.count).toBe(0);
  });

  it("GET /api/integrations returns 500 when index.json is corrupted (not empty list)", async () => {
    // Ensure the store dir exists and write a corrupted index.json.
    const { mkdir: mkdirFn, writeFile: writeFn } = await import("node:fs/promises");
    const { join: joinFn } = await import("node:path");
    const indexDir = joinFn(tmpDir, "integrations");
    await mkdirFn(indexDir, { recursive: true });
    await writeFn(joinFn(indexDir, "index.json"), "NOT VALID JSON !!!", "utf8");

    const res = await integrationsGet(req("GET", "/api/integrations", authHeader()));
    // A corrupted index MUST return 500, not 200 with an empty list.
    // This ensures I/O errors cannot masquerade as "No integrations yet."
    expect(res.status).toBe(500);
  });

  it("listIntegrations throws when index.json has a parse error (not swallowed to empty)", async () => {
    const { mkdir: mkdirFn, writeFile: writeFn } = await import("node:fs/promises");
    const { join: joinFn } = await import("node:path");
    const indexDir = joinFn(tmpDir, "integrations");
    await mkdirFn(indexDir, { recursive: true });
    await writeFn(joinFn(indexDir, "index.json"), "{ broken json", "utf8");

    await expect(fileIntegrationStore.listIntegrations()).rejects.toThrow();
  });
});

// ── Page source guards ─────────────────────────────────────────────────────────

describe("Integrations page fetch guards (regression for browser caching stale empty list)", () => {
  it("loadIntegrations fetch uses cache: no-store to prevent browser caching", () => {
    const src = read("app/dashboard/integrations/page.tsx");
    // The fetch must not allow browser caching of the (initially empty) list.
    expect(src).toContain('cache: "no-store"');
  });

  it("handleCreated calls router.refresh() to invalidate Next.js Router Cache before navigating", () => {
    const src = read("app/dashboard/integrations/page.tsx");
    // Invalidating the Router Cache ensures navigating back shows fresh data.
    expect(src).toContain("router.refresh()");
  });
});
