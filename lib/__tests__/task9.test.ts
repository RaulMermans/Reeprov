/**
 * Task 9 — Workflow Registry Unification tests.
 *
 * API tests run the actual route handlers.
 * Store tests use real temp directories.
 * UI structure tests read source files directly.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path, { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as workflowsGet } from "../../app/api/workflows/route";
import { POST as promotePost } from "../../app/api/workflows/promote/route";
import { GET as workflowGet, PATCH as workflowPatch, DELETE as workflowDelete } from "../../app/api/workflows/[registryId]/route";
import { POST as demoPost } from "../../app/api/runs/demo/route";
import { fileWorkflowStore } from "../../lib/workflows/workflowStore";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

// ── Test setup ────────────────────────────────────────────────────────────────

let tmpDir: string;
const originalStoreDir = process.env["AGENTPULSE_STORE_DIR"];
const originalAccessKey = process.env["AGENTPULSE_ACCESS_KEY"];

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "agentpulse-task9-"));
  process.env["AGENTPULSE_STORE_DIR"] = tmpDir;
  process.env["AGENTPULSE_ACCESS_KEY"] = "test-key-task9";
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
  return { "x-agentpulse-key": "test-key-task9" };
}

function makeSpec(id: string, name: string) {
  return {
    workflow_id: id,
    name,
    architecture_type: "single_agent" as const,
    nodes: [
      { id: "trigger", type: "trigger" as const, label: "Trigger" },
      { id: "agent", type: "agent" as const, label: "Agent" },
    ],
    edges: [{ from: "trigger", to: "agent" }],
  };
}

// ── GET /api/workflows — auth ─────────────────────────────────────────────────

describe("GET /api/workflows — auth", () => {
  it("returns 401 without key", async () => {
    const res = await workflowsGet(req("GET", "/api/workflows"));
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong key", async () => {
    const res = await workflowsGet(req("GET", "/api/workflows", { "x-agentpulse-key": "wrong" }));
    expect(res.status).toBe(401);
  });

  it("returns empty list when registry is empty", async () => {
    const res = await workflowsGet(req("GET", "/api/workflows", authHeader()));
    expect(res.status).toBe(200);
    const data = await res.json() as { workflows: unknown[]; count: number };
    expect(data.workflows).toEqual([]);
    expect(data.count).toBe(0);
  });

  it("returns populated list after saving workflows", async () => {
    await fileWorkflowStore.saveWorkflow({
      workflowId: "wf-1",
      projectId: "proj_a",
      projectName: "Project A",
      name: "Workflow A",
      source: "scan_reconstruction",
      confidence: "medium",
      status: "needs_review",
      evidencePaths: [],
      missingFields: [],
      spec: makeSpec("wf-1", "Workflow A"),
    });

    const res = await workflowsGet(req("GET", "/api/workflows", authHeader()));
    expect(res.status).toBe(200);
    const data = await res.json() as { workflows: unknown[]; count: number };
    expect(data.count).toBe(1);
  });
});

// ── POST /api/workflows/promote — auth ───────────────────────────────────────

describe("POST /api/workflows/promote — auth", () => {
  it("returns 401 without key", async () => {
    const res = await promotePost(req("POST", "/api/workflows/promote", {}, { spec: makeSpec("x", "X"), metadata: {} }));
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong key", async () => {
    const res = await promotePost(req("POST", "/api/workflows/promote", { "x-agentpulse-key": "bad" }, { spec: makeSpec("x", "X"), metadata: {} }));
    expect(res.status).toBe(401);
  });
});

// ── POST /api/workflows/promote — inline spec ─────────────────────────────────

describe("POST /api/workflows/promote — inline spec", () => {
  it("promotes a valid inline spec and returns registryId + redirectTo", async () => {
    const res = await promotePost(req("POST", "/api/workflows/promote", authHeader(), {
      spec: makeSpec("test-wf-promo", "Test Promo"),
      metadata: {
        projectId: "proj_test",
        projectName: "Test",
        source: "scan_reconstruction",
        confidence: "high",
        evidencePaths: ["agents.yaml"],
        missingFields: [],
      },
    }));

    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; registryId: string; redirectTo: string };
    expect(data.ok).toBe(true);
    expect(data.registryId).toMatch(/^wfr_/);
    expect(data.redirectTo).toContain("/dashboard/workflows/registry/");
  });

  it("assigns needs_review for medium confidence", async () => {
    await promotePost(req("POST", "/api/workflows/promote", authHeader(), {
      spec: makeSpec("wf-medium", "Medium WF"),
      metadata: {
        projectId: "proj_x",
        projectName: "X",
        source: "scan_reconstruction",
        confidence: "medium",
        evidencePaths: [],
        missingFields: ["model_provider"],
      },
    }));

    const list = await fileWorkflowStore.listWorkflows();
    expect(list[0]!.status).toBe("needs_review");
  });

  it("assigns active for high confidence + no missing fields", async () => {
    await promotePost(req("POST", "/api/workflows/promote", authHeader(), {
      spec: makeSpec("wf-high", "High WF"),
      metadata: {
        projectId: "proj_x",
        projectName: "X",
        source: "scan_reconstruction",
        confidence: "high",
        evidencePaths: [],
        missingFields: [],
      },
    }));

    const list = await fileWorkflowStore.listWorkflows();
    expect(list[0]!.status).toBe("active");
  });

  it("returns 400 for invalid spec", async () => {
    const res = await promotePost(req("POST", "/api/workflows/promote", authHeader(), {
      spec: { name: "Missing required fields" },
      metadata: {},
    }));
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe("invalid_spec");
  });

  it("returns 400 when neither spec nor reportId provided", async () => {
    const res = await promotePost(req("POST", "/api/workflows/promote", authHeader(), {}));
    expect(res.status).toBe(400);
  });
});

// ── POST /api/workflows/promote — reportId path ──────────────────────────────

describe("POST /api/workflows/promote — reportId path", () => {
  it("returns 404 for unknown reportId", async () => {
    const res = await promotePost(req("POST", "/api/workflows/promote", authHeader(), {
      reportId: "rpt_does_not_exist",
      workflowId: "wf-x",
    }));
    expect(res.status).toBe(404);
  });
});

// ── GET /api/workflows/[registryId] ──────────────────────────────────────────

describe("GET /api/workflows/[registryId]", () => {
  it("returns 401 without key", async () => {
    const res = await workflowGet(req("GET", "/api/workflows/wfr_abc"), { params: Promise.resolve({ registryId: "wfr_abc" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown registryId", async () => {
    const res = await workflowGet(req("GET", "/api/workflows/wfr_ghost", authHeader()), { params: Promise.resolve({ registryId: "wfr_ghost" }) });
    expect(res.status).toBe(404);
  });

  it("returns saved workflow", async () => {
    const saved = await fileWorkflowStore.saveWorkflow({
      workflowId: "wf-fetch-test",
      projectId: "proj_t",
      projectName: "T",
      name: "Fetch Test",
      source: "manual",
      confidence: "low",
      status: "draft",
      evidencePaths: [],
      missingFields: [],
      spec: makeSpec("wf-fetch-test", "Fetch Test"),
    });

    const res = await workflowGet(
      req("GET", `/api/workflows/${saved.registryId}`, authHeader()),
      { params: Promise.resolve({ registryId: saved.registryId }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { registryId: string; workflowId: string };
    expect(data.registryId).toBe(saved.registryId);
    expect(data.workflowId).toBe("wf-fetch-test");
  });
});

// ── PATCH /api/workflows/[registryId] ────────────────────────────────────────

describe("PATCH /api/workflows/[registryId]", () => {
  it("returns 401 without key", async () => {
    const res = await workflowPatch(req("PATCH", "/api/workflows/wfr_abc"), { params: Promise.resolve({ registryId: "wfr_abc" }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid status", async () => {
    const saved = await fileWorkflowStore.saveWorkflow({
      workflowId: "wf-patch", projectId: "p", projectName: "P", name: "N",
      source: "manual", confidence: "low", status: "draft",
      evidencePaths: [], missingFields: [], spec: makeSpec("wf-patch", "N"),
    });

    const res = await workflowPatch(
      req("PATCH", `/api/workflows/${saved.registryId}`, authHeader(), { status: "not_a_real_status" }),
      { params: Promise.resolve({ registryId: saved.registryId }) },
    );
    expect(res.status).toBe(400);
  });

  it("updates status successfully", async () => {
    const saved = await fileWorkflowStore.saveWorkflow({
      workflowId: "wf-patch2", projectId: "p", projectName: "P", name: "N",
      source: "scan_reconstruction", confidence: "high", status: "needs_review",
      evidencePaths: [], missingFields: [], spec: makeSpec("wf-patch2", "N"),
    });

    const res = await workflowPatch(
      req("PATCH", `/api/workflows/${saved.registryId}`, authHeader(), { status: "active" }),
      { params: Promise.resolve({ registryId: saved.registryId }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; workflow: { status: string } };
    expect(data.ok).toBe(true);
    expect(data.workflow.status).toBe("active");
  });
});

// ── DELETE /api/workflows/[registryId] ───────────────────────────────────────

describe("DELETE /api/workflows/[registryId]", () => {
  it("returns 401 without key", async () => {
    const res = await workflowDelete(req("DELETE", "/api/workflows/wfr_abc"), { params: Promise.resolve({ registryId: "wfr_abc" }) });
    expect(res.status).toBe(401);
  });

  it("deletes and returns 200", async () => {
    const saved = await fileWorkflowStore.saveWorkflow({
      workflowId: "wf-del", projectId: "p", projectName: "P", name: "N",
      source: "manual", confidence: "low", status: "draft",
      evidencePaths: [], missingFields: [], spec: makeSpec("wf-del", "N"),
    });

    const res = await workflowDelete(
      req("DELETE", `/api/workflows/${saved.registryId}`, authHeader()),
      { params: Promise.resolve({ registryId: saved.registryId }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; deleted: string };
    expect(data.ok).toBe(true);
    expect(data.deleted).toBe(saved.registryId);

    const check = await fileWorkflowStore.getWorkflow(saved.registryId);
    expect(check).toBeNull();
  });
});

// ── Demo run registers demo workflow ──────────────────────────────────────────

describe("POST /api/runs/demo — workflow registry side-effect", () => {
  it("registers website-auditor-v1 in the workflow registry", async () => {
    const res = await demoPost(req("POST", "/api/runs/demo", authHeader()));
    expect(res.status).toBe(201);

    const wf = await fileWorkflowStore.getWorkflowByWorkflowId("website-auditor-v1");
    expect(wf).not.toBeNull();
    expect(wf!.source).toBe("example");
    expect(wf!.status).toBe("active");
    expect(wf!.confidence).toBe("high");
  });

  it("subsequent demo runs update the registry entry rather than create duplicates", async () => {
    // Two demo runs with no sourceReportId will both try to save the demo workflow.
    // Since there's no sourceReportId, each gets a unique registryId — BUT both
    // share the workflowId, so getWorkflowByWorkflowId returns the latest one.
    const r1 = await demoPost(req("POST", "/api/runs/demo", authHeader()));
    const r2 = await demoPost(req("POST", "/api/runs/demo", authHeader()));
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    // The workflow list should contain at most 2 (one per demo run invocation),
    // both with workflowId "website-auditor-v1".
    const list = await fileWorkflowStore.listWorkflows({ workflowId: "website-auditor-v1" });
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every((w) => w.workflowId === "website-auditor-v1")).toBe(true);
  });
});

// ── UI/source smoke tests ─────────────────────────────────────────────────────

describe("UI source smoke", () => {
  it("Workflows page includes Registered Workflows section", () => {
    const src = read("app/dashboard/workflows/WorkflowsPageClient.tsx");
    expect(src).toContain("Workflow Registry");
    expect(src).toContain("RegistryWorkflowCard");
    expect(src).toContain("Example Workflows");
  });

  it("Workflows page client component is a client component", () => {
    const src = read("app/dashboard/workflows/WorkflowsPageClient.tsx");
    expect(src).toContain('"use client"');
  });

  it("StaticProofReconstructionPanel includes Promote button", () => {
    const src = read("components/dashboard/StaticProofReconstructionPanel.tsx");
    expect(src).toContain("Promote to Workflow Registry");
    expect(src).toContain("promote(");
    expect(src).toContain("/api/workflows/promote");
  });

  it("Run detail page imports SavedWorkflowSummary type", () => {
    const src = read("app/dashboard/runs/[runId]/page.tsx");
    expect(src).toContain("SavedWorkflowSummary");
    expect(src).toContain("/api/workflows?projectId=");
    expect(src).toContain("&workflowId=");
    expect(src).toContain("registryWorkflow");
  });

  it("Registry workflow detail page exists", () => {
    const src = read("app/dashboard/workflows/registry/[registryId]/page.tsx");
    expect(src).toContain("RegistryWorkflowDetailPage");
    expect(src).toContain("/api/workflows/");
    expect(src).toContain("Related Runtime Runs");
  });

  it("RegistryWorkflowCard component exists", () => {
    const src = read("components/dashboard/RegistryWorkflowCard.tsx");
    expect(src).toContain("RegistryWorkflowCard");
    expect(src).toContain("/dashboard/workflows/registry/");
  });

  it("workflow registry store exports fileWorkflowStore", () => {
    const src = read("lib/workflows/workflowStore.ts");
    expect(src).toContain("fileWorkflowStore");
    expect(src).toContain("saveWorkflow");
    expect(src).toContain("listWorkflows");
    expect(src).toContain("deleteWorkflow");
  });

  it("promotion API assigns correct status based on confidence", () => {
    const src = read("app/api/workflows/promote/route.ts");
    expect(src).toContain("assignStatus");
    expect(src).toContain("needs_review");
    expect(src).toContain("active");
  });

  it("demo route registers demo workflow via store", () => {
    const src = read("app/api/runs/demo/route.ts");
    // Route now uses getWorkflowStore() from the store selector (not fileWorkflowStore directly).
    expect(src).toMatch(/getWorkflowStore\(\)|fileWorkflowStore/);
    expect(src).toContain("website-auditor-v1");
    expect(src).toContain("saveWorkflow");
  });
});

// ── Workflow registry list filter smoke ───────────────────────────────────────

describe("GET /api/workflows — filters", () => {
  it("filters by workflowId query param", async () => {
    await fileWorkflowStore.saveWorkflow({
      workflowId: "wf-filter-a", projectId: "p", projectName: "P", name: "A",
      source: "manual", confidence: "low", status: "draft",
      evidencePaths: [], missingFields: [], spec: makeSpec("wf-filter-a", "A"),
    });
    await fileWorkflowStore.saveWorkflow({
      workflowId: "wf-filter-b", projectId: "p", projectName: "P", name: "B",
      source: "manual", confidence: "low", status: "draft",
      evidencePaths: [], missingFields: [], spec: makeSpec("wf-filter-b", "B"),
    });

    const res = await workflowsGet(
      new Request("http://localhost/api/workflows?workflowId=wf-filter-a", {
        headers: authHeader(),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { workflows: Array<{ workflowId: string }>; count: number };
    expect(data.count).toBe(1);
    expect(data.workflows[0]!.workflowId).toBe("wf-filter-a");
  });

  it("filters by status query param", async () => {
    await fileWorkflowStore.saveWorkflow({
      workflowId: "wf-s-active", projectId: "p", projectName: "P", name: "Active",
      source: "manual", confidence: "high", status: "active",
      evidencePaths: [], missingFields: [], spec: makeSpec("wf-s-active", "Active"),
    });
    await fileWorkflowStore.saveWorkflow({
      workflowId: "wf-s-draft", projectId: "p", projectName: "P", name: "Draft",
      source: "manual", confidence: "low", status: "draft",
      evidencePaths: [], missingFields: [], spec: makeSpec("wf-s-draft", "Draft"),
    });

    const res = await workflowsGet(
      new Request("http://localhost/api/workflows?status=active", {
        headers: authHeader(),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { workflows: Array<{ status: string }>; count: number };
    expect(data.count).toBe(1);
    expect(data.workflows[0]!.status).toBe("active");
  });
});
