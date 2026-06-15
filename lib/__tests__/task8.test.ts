/**
 * Task 8 — Demo Run + Runtime Run Detail UX tests.
 *
 * API tests run the actual route handler.
 * UI structure tests read source files directly.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as demoPost } from "../../app/api/runs/demo/route";
import { GET as runsGet } from "../../app/api/runs/route";
import { GET as runGet } from "../../app/api/runs/[runId]/route";
import { assertTraceContract } from "../../lib/proof-layer/index";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

// ── Setup: use temp store dir for tests ──────────────────────────────────────

const originalStoreDir = process.env["AGENTPULSE_STORE_DIR"];
const originalAccessKey = process.env["AGENTPULSE_ACCESS_KEY"];

beforeEach(() => {
  process.env["AGENTPULSE_STORE_DIR"] = "/tmp/agentpulse-task8-test";
  process.env["AGENTPULSE_ACCESS_KEY"] = "test-access-key";
});

afterEach(() => {
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
});

function makeReq(method: string, url: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${url}`, { method, headers });
}

// ── Demo run API ──────────────────────────────────────────────────────────────

describe("POST /api/runs/demo — auth", () => {
  it("returns 401 when no access key header", async () => {
    const res = await demoPost(makeReq("POST", "/api/runs/demo"));
    expect(res.status).toBe(401);
  });

  it("returns 401 when wrong key", async () => {
    const res = await demoPost(makeReq("POST", "/api/runs/demo", { "x-agentpulse-key": "wrong" }));
    expect(res.status).toBe(401);
  });

  it("returns 201 with ok:true and runId for valid key", async () => {
    const res = await demoPost(makeReq("POST", "/api/runs/demo", { "x-agentpulse-key": "test-access-key" }));
    expect(res.status).toBe(201);
    const body = await res.json() as { ok: boolean; runId: string; redirectTo: string };
    expect(body.ok).toBe(true);
    expect(typeof body.runId).toBe("string");
    expect(body.runId.length).toBeGreaterThan(0);
  });

  it("returns redirectTo pointing to /dashboard/runs/{runId}", async () => {
    const res = await demoPost(makeReq("POST", "/api/runs/demo", { "x-agentpulse-key": "test-access-key" }));
    const body = await res.json() as { ok: boolean; runId: string; redirectTo: string };
    expect(body.redirectTo).toBe(`/dashboard/runs/${body.runId}`);
  });

  it("run ID starts with demo-", async () => {
    const res = await demoPost(makeReq("POST", "/api/runs/demo", { "x-agentpulse-key": "test-access-key" }));
    const body = await res.json() as { runId: string };
    expect(body.runId).toMatch(/^demo-/);
  });
});

describe("POST /api/runs/demo — run quality", () => {
  async function createDemo() {
    const res = await demoPost(makeReq("POST", "/api/runs/demo", { "x-agentpulse-key": "test-access-key" }));
    const body = await res.json() as { ok: boolean; runId: string; redirectTo: string };
    return body.runId;
  }

  it("created run is fetchable via GET /api/runs/{runId}", async () => {
    const runId = await createDemo();
    const res = await runGet(
      makeReq("GET", `/api/runs/${runId}`, { "x-agentpulse-key": "test-access-key" }),
      { params: Promise.resolve({ runId }) },
    );
    expect(res.status).toBe(200);
  });

  it("run record has correct project and workflow fields", async () => {
    const runId = await createDemo();
    const res = await runGet(
      makeReq("GET", `/api/runs/${runId}`, { "x-agentpulse-key": "test-access-key" }),
      { params: Promise.resolve({ runId }) },
    );
    const body = await res.json() as { runRecord: { project_name: string; workflow_id: string; status: string } };
    expect(body.runRecord.project_name).toBe("Website Auditor");
    expect(body.runRecord.workflow_id).toBe("website-auditor-v1");
  });

  it("run has status degraded (source grounding eval warning)", async () => {
    const runId = await createDemo();
    const res = await runGet(
      makeReq("GET", `/api/runs/${runId}`, { "x-agentpulse-key": "test-access-key" }),
      { params: Promise.resolve({ runId }) },
    );
    const body = await res.json() as { runRecord: { status: string } };
    expect(body.runRecord.status).toBe("degraded");
  });

  it("run has at least 4 model call events", async () => {
    const runId = await createDemo();
    const res = await runGet(
      makeReq("GET", `/api/runs/${runId}`, { "x-agentpulse-key": "test-access-key" }),
      { params: Promise.resolve({ runId }) },
    );
    const body = await res.json() as { runRecord: { model_calls_count: number } };
    expect(body.runRecord.model_calls_count).toBeGreaterThanOrEqual(4);
  });

  it("run has at least 3 tool call events", async () => {
    const runId = await createDemo();
    const res = await runGet(
      makeReq("GET", `/api/runs/${runId}`, { "x-agentpulse-key": "test-access-key" }),
      { params: Promise.resolve({ runId }) },
    );
    const body = await res.json() as { runRecord: { tool_calls_count: number } };
    expect(body.runRecord.tool_calls_count).toBeGreaterThanOrEqual(3);
  });

  it("run has at least 3 eval results", async () => {
    const runId = await createDemo();
    const res = await runGet(
      makeReq("GET", `/api/runs/${runId}`, { "x-agentpulse-key": "test-access-key" }),
      { params: Promise.resolve({ runId }) },
    );
    const body = await res.json() as { runRecord: { evals_passed: number; evals_failed: number } };
    const total = body.runRecord.evals_passed + body.runRecord.evals_failed;
    expect(total).toBeGreaterThanOrEqual(3);
  });

  it("run has at least 1 artifact ref", async () => {
    const runId = await createDemo();
    const res = await runGet(
      makeReq("GET", `/api/runs/${runId}`, { "x-agentpulse-key": "test-access-key" }),
      { params: Promise.resolve({ runId }) },
    );
    const body = await res.json() as { runRecord: { artifact_refs: string[] } };
    expect(body.runRecord.artifact_refs.length).toBeGreaterThanOrEqual(1);
  });

  it("run has non-zero total_cost_usd", async () => {
    const runId = await createDemo();
    const res = await runGet(
      makeReq("GET", `/api/runs/${runId}`, { "x-agentpulse-key": "test-access-key" }),
      { params: Promise.resolve({ runId }) },
    );
    const body = await res.json() as { runRecord: { total_cost_usd: number } };
    expect(body.runRecord.total_cost_usd).toBeGreaterThan(0);
  });

  it("run has non-zero total_duration_ms", async () => {
    const runId = await createDemo();
    const res = await runGet(
      makeReq("GET", `/api/runs/${runId}`, { "x-agentpulse-key": "test-access-key" }),
      { params: Promise.resolve({ runId }) },
    );
    const body = await res.json() as { runRecord: { total_duration_ms: number } };
    expect(body.runRecord.total_duration_ms).toBeGreaterThan(0);
  });

  it("demo run trace events satisfy trace contract", async () => {
    const runId = await createDemo();
    const res = await runGet(
      makeReq("GET", `/api/runs/${runId}`, { "x-agentpulse-key": "test-access-key" }),
      { params: Promise.resolve({ runId }) },
    );
    const body = await res.json() as { traceEvents: unknown[] };
    const contract = assertTraceContract(body.traceEvents as Parameters<typeof assertTraceContract>[0]);
    // Demo run is completed (degraded), so contract should pass
    expect(contract.passed).toBe(true);
  });

  it("demo run appears in GET /api/runs list", async () => {
    const runId = await createDemo();
    const res = await runsGet(
      makeReq("GET", "/api/runs?limit=10", { "x-agentpulse-key": "test-access-key" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { runs: Array<{ run_id: string }> };
    const found = body.runs.some((r) => r.run_id === runId);
    expect(found).toBe(true);
  });
});

// ── Runs page UI structure ────────────────────────────────────────────────────

describe("Runs page empty state", () => {
  const src = () => read("app/dashboard/runs/page.tsx");

  it("includes Create demo run button in empty state", () => {
    expect(src()).toContain("Create demo run");
  });

  it("calls /api/runs/demo to create demo run", () => {
    expect(src()).toContain("/api/runs/demo");
  });

  it("uses onUnauthorized from useDashboardAuth on 401", () => {
    const code = src();
    expect(code).toContain("useDashboardAuth");
    expect(code).toContain("onUnauthorized");
  });

  it("uses mergeAuthHeaders for API calls", () => {
    expect(src()).toContain("mergeAuthHeaders");
  });

  it("redirects to run detail on success", () => {
    expect(src()).toContain("router.push");
    expect(src()).toContain("redirectTo");
  });

  it("includes Open Repository Scanner link", () => {
    expect(src()).toContain("Open Repository Scanner");
  });

  it("explains that runs appear after trace events", () => {
    const code = src();
    expect(code).toContain("trace events");
  });
});

describe("Run detail page structure", () => {
  const src = () => read("app/dashboard/runs/[runId]/page.tsx");

  it("renders run summary fields", () => {
    // The run summary metrics are rendered via the extracted RunSummaryHeader
    // component (part of the visual run-intelligence dashboard), composed
    // into this page rather than inlined — check both sources together.
    const code = src() + read("components/proof-layer/RunSummaryHeader.tsx");
    expect(code).toContain("Started");
    expect(code).toContain("Duration");
    expect(code).toContain("Total Cost");
    expect(code).toContain("Model Calls");
    expect(code).toContain("Tool Calls");
    expect(code).toContain("Evals");
  });

  it("renders Trace Timeline section", () => {
    expect(src()).toContain("Trace Timeline");
  });

  it("renders Model Calls section", () => {
    expect(src()).toContain("Model Calls");
  });

  it("renders Tool Calls section", () => {
    expect(src()).toContain("Tool Calls");
  });

  it("renders Eval Results section", () => {
    expect(src()).toContain("Eval Results");
  });

  it("renders Artifacts section", () => {
    expect(src()).toContain("Artifacts");
  });

  it("renders Errors and Retries section with empty state", () => {
    const code = src();
    expect(code).toContain("Errors and Retries");
    expect(code).toContain("No errors or retries recorded");
  });

  it("shows Demo badge for demo- run IDs", () => {
    expect(src()).toContain("Demo");
    expect(src()).toContain("demo-");
  });

  it("uses onUnauthorized on 401", () => {
    const code = src();
    expect(code).toContain("useDashboardAuth");
    expect(code).toContain("onUnauthorized");
  });
});

// ── Overview integration ──────────────────────────────────────────────────────

describe("Overview page integration", () => {
  it("uses OverviewLiveRuns client component", () => {
    const src = read("app/dashboard/page.tsx");
    expect(src).toContain("OverviewLiveRuns");
  });

  it("does not call fileRunStore server-side", () => {
    const src = read("app/dashboard/page.tsx");
    expect(src).not.toContain("fileRunStore");
  });
});

describe("OverviewLiveRuns shows Create demo run", () => {
  it("includes Create demo run button", () => {
    const src = read("components/dashboard/OverviewLiveRuns.tsx");
    expect(src).toContain("Create demo run");
  });

  it("calls /api/runs/demo on button click", () => {
    const src = read("components/dashboard/OverviewLiveRuns.tsx");
    expect(src).toContain("/api/runs/demo");
  });

  it("calls onUnauthorized on 401", () => {
    const src = read("components/dashboard/OverviewLiveRuns.tsx");
    expect(src).toContain("onUnauthorized");
  });
});

// ── Demo run route structure ──────────────────────────────────────────────────

describe("Demo run route source", () => {
  const src = () => read("app/api/runs/demo/route.ts");

  it("exists", () => {
    expect(() => src()).not.toThrow();
  });

  it("uses requireAccessKey (not ingest key)", () => {
    const code = src();
    expect(code).toContain("requireAccessKey");
    expect(code).not.toContain("requireIngestKey");
  });

  it("includes at least 7 nodes worth of events", () => {
    const code = src();
    // Check for key node IDs
    expect(code).toContain("url-intake");
    expect(code).toContain("web-crawler");
    expect(code).toContain("brand-audit");
    expect(code).toContain("ux-audit");
    expect(code).toContain("seo-audit");
    expect(code).toContain("evidence-evaluator");
    expect(code).toContain("report-synthesizer");
  });

  it("includes model call events", () => {
    expect(src()).toContain("model_call_completed");
  });

  it("includes tool call events", () => {
    expect(src()).toContain("tool_call_completed");
  });

  it("includes eval_completed events", () => {
    expect(src()).toContain("eval_completed");
  });

  it("includes artifact_created event", () => {
    expect(src()).toContain("artifact_created");
  });

  it("returns run ID starting with demo-", () => {
    expect(src()).toContain("`demo-");
  });

  it("returns redirectTo in response", () => {
    expect(src()).toContain("redirectTo");
  });
});
