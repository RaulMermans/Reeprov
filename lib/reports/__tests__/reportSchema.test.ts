/**
 * Phase 1 / Phase 8 — Report schema validation and golden fixture tests.
 *
 * Verifies:
 * - reportVersion is present and correct on all generated reports
 * - New identity fields (reportId, projectId, scanId, scannerVersion, generatedAt) exist
 * - Schema validation (Zod) accepts well-formed reports and rejects bad ones
 * - Golden fixture JSON files conform to the schema
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanReportSchema } from "@/lib/reports/reportSchema";
import { REPORT_VERSION } from "@/lib/reports/reportVersion";
import { SCANNER_VERSION } from "@/lib/reports/reportId";
import { staticScan } from "@/lib/scanner/staticScan";

// ── Report generation: new identity fields ────────────────────────────────────

describe("staticScan — report identity fields", () => {
  function scanEmpty() {
    return staticScan("owner/repo", [{ path: "README.md", size: 100, content: "# Test" }]);
  }

  it("includes reportVersion matching REPORT_VERSION constant", () => {
    const report = scanEmpty();
    expect(report.reportVersion).toBe(REPORT_VERSION);
    expect(report.reportVersion).toBeTruthy();
  });

  it("includes a non-empty reportId", () => {
    const report = scanEmpty();
    expect(report.reportId).toBeTruthy();
    expect(typeof report.reportId).toBe("string");
    expect(report.reportId.startsWith("rpt_")).toBe(true);
  });

  it("reportId is unique across calls", () => {
    const r1 = scanEmpty();
    const r2 = scanEmpty();
    expect(r1.reportId).not.toBe(r2.reportId);
  });

  it("includes a non-empty projectId derived from repoName", () => {
    const report = staticScan("myowner/myrepo", []);
    expect(report.projectId).toBeTruthy();
    expect(report.projectId.startsWith("proj_")).toBe(true);
    expect(report.projectId).toContain("myowner");
  });

  it("same repoName produces same projectId across scans", () => {
    const r1 = staticScan("owner/repo", []);
    const r2 = staticScan("owner/repo", []);
    expect(r1.projectId).toBe(r2.projectId);
  });

  it("different repoNames produce different projectIds", () => {
    const r1 = staticScan("owner/repo-a", []);
    const r2 = staticScan("owner/repo-b", []);
    expect(r1.projectId).not.toBe(r2.projectId);
  });

  it("scanId equals reportId for v1", () => {
    const report = scanEmpty();
    expect(report.scanId).toBe(report.reportId);
  });

  it("scannerVersion matches constant", () => {
    const report = scanEmpty();
    expect(report.scannerVersion).toBe(SCANNER_VERSION);
    expect(report.scannerVersion).toBe("agentpulse-static-scanner-v2");
  });

  it("generatedAt is a valid ISO timestamp", () => {
    const report = scanEmpty();
    expect(report.generatedAt).toBeTruthy();
    const d = new Date(report.generatedAt);
    expect(d.getTime()).not.toBeNaN();
  });

  it("generatedAt equals scannedAt", () => {
    const report = scanEmpty();
    expect(report.generatedAt).toBe(report.scannedAt);
  });
});

// ── Zod schema validation ─────────────────────────────────────────────────────

describe("scanReportSchema Zod validation", () => {
  function minimalValidReport(): object {
    return {
      reportVersion: "2.0",
      reportId: "rpt_test_abc",
      projectId: "proj_test__repo",
      scanId: "rpt_test_abc",
      scannerVersion: "agentpulse-static-scanner-v2",
      generatedAt: "2025-01-01T00:00:00.000Z",
      repoName: "test/repo",
      scannedAt: "2025-01-01T00:00:00.000Z",
      filesScanned: 0,
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
        maintainability: 80,
        overall: 60,
      },
      recommendations: [],
    };
  }

  it("accepts a well-formed report", () => {
    const result = scanReportSchema.safeParse(minimalValidReport());
    expect(result.success).toBe(true);
  });

  it("rejects a report missing reportVersion", () => {
    const bad = { ...minimalValidReport() } as Record<string, unknown>;
    delete bad["reportVersion"];
    const result = scanReportSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects a report missing reportId", () => {
    const bad = { ...minimalValidReport() } as Record<string, unknown>;
    delete bad["reportId"];
    const result = scanReportSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects a report missing projectId", () => {
    const bad = { ...minimalValidReport() } as Record<string, unknown>;
    delete bad["projectId"];
    const result = scanReportSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects a report missing scannerVersion", () => {
    const bad = { ...minimalValidReport() } as Record<string, unknown>;
    delete bad["scannerVersion"];
    const result = scanReportSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects a report missing generatedAt", () => {
    const bad = { ...minimalValidReport() } as Record<string, unknown>;
    delete bad["generatedAt"];
    const result = scanReportSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("every report from staticScan passes schema validation", () => {
    const report = staticScan("owner/repo", [
      { path: "agents.yaml", size: 100, content: "agents:\n  - id: test\n    name: Test\n" },
    ]);
    const result = scanReportSchema.safeParse(report);
    expect(result.success).toBe(true);
  });
});

// ── Golden fixture validation ─────────────────────────────────────────────────

describe("golden report fixtures", () => {
  const fixturesDir = join(process.cwd(), "tests", "fixtures", "reports");

  function loadFixture(filename: string): object {
    const raw = readFileSync(join(fixturesDir, filename), "utf8");
    return JSON.parse(raw) as object;
  }

  const fixtures = [
    "minimal-unknown.json",
    "agent-missing-config.json",
    "report-with-version.json",
  ];

  for (const fixture of fixtures) {
    it(`${fixture} has reportVersion: "2.0"`, () => {
      const data = loadFixture(fixture) as Record<string, unknown>;
      expect(data["reportVersion"]).toBe("2.0");
    });

    it(`${fixture} has reportId`, () => {
      const data = loadFixture(fixture) as Record<string, unknown>;
      expect(typeof data["reportId"]).toBe("string");
      expect(data["reportId"]).toBeTruthy();
    });

    it(`${fixture} has projectId`, () => {
      const data = loadFixture(fixture) as Record<string, unknown>;
      expect(typeof data["projectId"]).toBe("string");
      expect(data["projectId"]).toBeTruthy();
    });

    it(`${fixture} has scannerVersion`, () => {
      const data = loadFixture(fixture) as Record<string, unknown>;
      expect(data["scannerVersion"]).toBe("agentpulse-static-scanner-v2");
    });

    it(`${fixture} has required scores object`, () => {
      const data = loadFixture(fixture) as Record<string, unknown>;
      const scores = data["scores"] as Record<string, unknown>;
      expect(typeof scores["overall"]).toBe("number");
      expect(typeof scores["security"]).toBe("number");
    });
  }
});
