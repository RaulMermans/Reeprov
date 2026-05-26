/**
 * GET /api/reports/[reportId]/reconstruction tests (Phase 5).
 *
 * Verifies that:
 *   - missing access key → 401
 *   - missing reportId   → 404
 *   - saved reportId     → schema-valid StaticProofReconstruction
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";
import { fileReportStore } from "@/lib/reports/reportStore";
import { staticProofReconstructionSchema } from "@/lib/reconstruction/schema";
import type { ScanReport } from "@/lib/scanner/types";

const TEST_KEY = "test-recon-by-id-key";
let tmpDir: string;
const originalAccessKey = process.env["AGENTPULSE_ACCESS_KEY"];

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "agentpulse-recon-id-"));
  process.env["AGENTPULSE_STORE_DIR"] = tmpDir;
  process.env["AGENTPULSE_ACCESS_KEY"] = TEST_KEY;
});

afterEach(async () => {
  delete process.env["AGENTPULSE_STORE_DIR"];
  process.env["AGENTPULSE_ACCESS_KEY"] = originalAccessKey;
  await rm(tmpDir, { recursive: true, force: true });
});

function makeReport(reportId: string): ScanReport {
  return {
    reportVersion: "2.0",
    reportId,
    projectId: "proj_recon_id",
    scanId: reportId,
    scannerVersion: "agentpulse-static-scanner-v2",
    generatedAt: "2025-01-01T00:00:00.000Z",
    repoName: "recon-test-repo",
    scannedAt: "2025-01-01T00:00:00.000Z",
    filesScanned: 1,
    ignoredFiles: 0,
    projectType: "agent_system",
    detectedAgents: [
      {
        id: "a1",
        name: "Agent",
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
    detectedWorkflowsDetailed: [],
    detectedCIWorkflows: [],
    detectedPrompts: ["prompts/p.md"],
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
  };
}

function buildRequest(withKey = true): Request {
  const headers: Record<string, string> = {};
  if (withKey) headers["x-agentpulse-key"] = TEST_KEY;
  return new Request("http://localhost/api/reports/x/reconstruction", { headers });
}

describe("GET /api/reports/[reportId]/reconstruction", () => {
  it("returns 401 without the access key", async () => {
    const res = await GET(buildRequest(false), {
      params: Promise.resolve({ reportId: "rpt_anything" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 for a missing reportId", async () => {
    const res = await GET(buildRequest(), {
      params: Promise.resolve({ reportId: "rpt_missing_from_store" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns a schema-valid reconstruction for a saved reportId", async () => {
    const report = makeReport("rpt_recon_by_id");
    await fileReportStore.saveReport(report);

    const res = await GET(buildRequest(), {
      params: Promise.resolve({ reportId: "rpt_recon_by_id" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    const parsed = staticProofReconstructionSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });
});
