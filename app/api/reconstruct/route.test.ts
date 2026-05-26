/**
 * /api/reconstruct route tests (Phase 5).
 *
 * Verifies that the cleaned-up POST endpoint:
 *   - rejects requests without an access key
 *   - rejects malformed/empty bodies with 400
 *   - returns 404 when reportId is not found
 *   - rejects malformed report bodies via scanReportSchema
 *   - accepts a valid { reportId }
 *   - accepts a valid { report }
 *   - validates the output against staticProofReconstructionSchema
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { fileReportStore } from "@/lib/reports/reportStore";
import { staticProofReconstructionSchema } from "@/lib/reconstruction/schema";
import type { ScanReport } from "@/lib/scanner/types";

const TEST_KEY = "test-reconstruct-key";
let tmpDir: string;
const originalAccessKey = process.env["AGENTPULSE_ACCESS_KEY"];

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "agentpulse-reconstruct-"));
  process.env["AGENTPULSE_STORE_DIR"] = tmpDir;
  process.env["AGENTPULSE_ACCESS_KEY"] = TEST_KEY;
});

afterEach(async () => {
  delete process.env["AGENTPULSE_STORE_DIR"];
  process.env["AGENTPULSE_ACCESS_KEY"] = originalAccessKey;
  await rm(tmpDir, { recursive: true, force: true });
});

function makeReport(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    reportVersion: "2.0",
    reportId: "rpt_api_test",
    projectId: "proj_api_test",
    scanId: "rpt_api_test",
    scannerVersion: "agentpulse-static-scanner-v2",
    generatedAt: "2025-01-01T00:00:00.000Z",
    repoName: "api-test-repo",
    scannedAt: "2025-01-01T00:00:00.000Z",
    filesScanned: 1,
    ignoredFiles: 0,
    projectType: "unknown_ai_project",
    detectedAgents: [],
    detectedWorkflowsDetailed: [],
    detectedCIWorkflows: [],
    detectedPrompts: [],
    detectedTools: [],
    detectedEvals: [],
    detectedTests: [],
    detectedWorkflows: [],
    findings: [],
    scores: {
      architecture: 50,
      promptQuality: 50,
      toolGovernance: 50,
      evalCoverage: 50,
      security: 80,
      documentation: 50,
      maintainability: 70,
      overall: 58,
    },
    recommendations: [],
    ...overrides,
  };
}

function makeRequest(body: unknown, withKey = true): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (withKey) headers["x-agentpulse-key"] = TEST_KEY;
  return new Request("http://localhost/api/reconstruct", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/reconstruct — auth", () => {
  it("returns 401 without an access key", async () => {
    const res = await POST(makeRequest({ reportId: "rpt_missing" }, false));
    expect(res.status).toBe(401);
  });

  it("returns 401 with a wrong access key", async () => {
    const req = new Request("http://localhost/api/reconstruct", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agentpulse-key": "wrong-key" },
      body: JSON.stringify({ reportId: "rpt_missing" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/reconstruct — body validation", () => {
  it("returns 400 on invalid JSON body", async () => {
    const res = await POST(makeRequest("{not json"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when neither reportId nor report is provided", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toMatch(/reportId|report/i);
  });

  it("returns 400 when both reportId and report are provided", async () => {
    const res = await POST(makeRequest({ reportId: "abc", report: makeReport() }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when report does not match scanReportSchema", async () => {
    const res = await POST(makeRequest({ report: { reportId: "bogus", not: "valid" } }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; issues?: unknown };
    expect(body.error).toBe("invalid_report");
    expect(Array.isArray(body.issues)).toBe(true);
  });
});

describe("POST /api/reconstruct — reportId path", () => {
  it("returns 404 when reportId does not exist", async () => {
    const res = await POST(makeRequest({ reportId: "rpt_does_not_exist" }));
    expect(res.status).toBe(404);
  });

  it("returns a schema-valid reconstruction for a saved reportId", async () => {
    const report = makeReport({
      reportId: "rpt_saved_for_recon",
      projectId: "proj_saved",
      projectType: "agent_system",
      detectedAgents: [
        {
          id: "a1",
          name: "Agent 1",
          source: "explicit",
          confidence: "high",
          displayKind: "manifest",
          promptPaths: ["prompts/p.md"],
          toolNames: [],
          evalPaths: [],
          risks: [],
          model: { provider: "openai", name: "gpt-4o" },
        },
      ],
      detectedPrompts: ["prompts/p.md"],
    });
    await fileReportStore.saveReport(report);

    const res = await POST(makeRequest({ reportId: "rpt_saved_for_recon" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    const parsed = staticProofReconstructionSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });
});

describe("POST /api/reconstruct — inline report path", () => {
  it("returns a schema-valid reconstruction for a valid inline report", async () => {
    const report = makeReport({
      projectType: "workflow_system",
      detectedWorkflowsDetailed: [
        {
          id: "wf1",
          name: "Workflow 1",
          source: "explicit",
          confidence: "high",
          configPath: "workflow.yaml",
          stagesDetailed: [{ id: "s1", name: "Stage 1" }],
        },
      ],
      detectedWorkflows: ["workflow.yaml"],
    });
    const res = await POST(makeRequest({ report }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    const parsed = staticProofReconstructionSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it("returns workflowSpecs:[] for a non-AI inline report", async () => {
    const report = makeReport({
      projectType: "unknown_ai_project",
      detectedCIWorkflows: [
        { name: "CI", path: ".github/workflows/ci.yml", provider: "github_actions" },
      ],
      detectedTests: ["tests/x.test.ts"],
    });
    const res = await POST(makeRequest({ report }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workflowSpecs: unknown[]; suggestedFiles: { path: string }[] };
    expect(body.workflowSpecs).toEqual([]);
    expect(body.suggestedFiles.length).toBe(1);
    expect(body.suggestedFiles[0]!.path).toBe("no-reconstruction.md");
  });
});
