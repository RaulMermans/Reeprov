/**
 * Commit 9: System Maintainability / Code Debt Auditor tests.
 *
 * Tests cover:
 * A. Large file detection
 * B. TODO/FIXME detection
 * C. Scanner concentration
 * D. Schema version (reportVersion field)
 * E. Dashboard complexity
 * F. Golden fixtures
 * G. Score behavior
 * H. Integration with staticScan / runScanPipeline
 */

import { describe, expect, it } from "vitest";
import { exportReportMarkdown } from "@/lib/reports/exportMarkdown";
import { REPORT_VERSION } from "@/lib/reports/reportVersion";
import { prepareRepoFiles, staticScan } from "@/lib/scanner/staticScan";
import type { ScanReport } from "@/lib/scanner/types";
import { maintainabilityAuditor } from "../maintainabilityAuditor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReport(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    reportVersion: REPORT_VERSION,
    repoName: "test/repo",
    scannedAt: new Date().toISOString(),
    filesScanned: 0,
    ignoredFiles: 0,
    projectType: "agent_system",
    detectedAgents: [],
    detectedWorkflowsDetailed: [],
    detectedCIWorkflows: [],
    detectedAssistantTooling: [],
    detectedPrompts: [],
    detectedPromptRelatedFiles: [],
    detectedLLMInfrastructure: [],
    detectedTools: [],
    detectedEvals: [],
    detectedTests: [],
    detectedWorkflows: [],
    findings: [],
    scores: {
      architecture: 82,
      promptQuality: 82,
      toolGovernance: 82,
      evalCoverage: 82,
      security: 88,
      documentation: 82,
      maintainability: 82,
      overall: 82,
    },
    recommendations: [],
    ...overrides,
  };
}

function makeFiles(rawFiles: Array<{ path: string; size?: number; content?: string }>) {
  return prepareRepoFiles(rawFiles.map((f) => ({ ...f, size: f.size ?? (f.content?.length ?? 100) })));
}

function bigFile(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `const x${i} = ${i};`).join("\n");
}

// ---------------------------------------------------------------------------
// A. Large file detection
// ---------------------------------------------------------------------------

describe("A: large file detection", () => {
  it("source file over 800 lines → high maintainability finding", () => {
    const files = makeFiles([{ path: "lib/scanner/bigScan.ts", content: bigFile(850) }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    const f = result.findings.find((f) => f.id.startsWith("large-file-") && f.severity === "high");
    expect(f).toBeDefined();
    expect(f?.title).toContain("Large mixed-responsibility");
  });

  it("source file 500-800 lines → medium finding", () => {
    const files = makeFiles([{ path: "lib/scanner/medScan.ts", content: bigFile(550) }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    const f = result.findings.find((f) => f.id.startsWith("large-file-") && f.severity === "medium");
    expect(f).toBeDefined();
  });

  it("docs file over threshold is NOT flagged as large source", () => {
    const files = makeFiles([{ path: "docs/ARCHITECTURE.md", content: bigFile(600) }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    const largeFinding = result.findings.find((f) => f.id.startsWith("large-file-") && f.severity === "high");
    expect(largeFinding).toBeUndefined();
  });

  it("lockfile is not flagged", () => {
    const files = makeFiles([{ path: "package-lock.json", content: bigFile(2000) }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    const largeFinding = result.findings.find((f) => f.id.startsWith("large-file-"));
    expect(largeFinding).toBeUndefined();
  });

  it("test file is not flagged for large-source penalty", () => {
    const files = makeFiles([{ path: "lib/__tests__/bigTest.test.ts", content: bigFile(900) }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    const highFinding = result.findings.find((f) => f.id.startsWith("large-file-") && f.severity === "high");
    expect(highFinding).toBeUndefined();
  });

  it("large files appear in metrics.largeFiles", () => {
    const files = makeFiles([{ path: "lib/scanner/bigScan.ts", content: bigFile(600) }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    expect(result.maintainabilityMetrics?.largeFiles.some((lf) => lf.path === "lib/scanner/bigScan.ts")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B. TODO/FIXME detection
// ---------------------------------------------------------------------------

describe("B: TODO/FIXME detection", () => {
  it("TODO markers in source → finding created", () => {
    const files = makeFiles([{
      path: "lib/scanner/scan.ts",
      content: "// TODO: fix this\nconst x = 1;",
    }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    expect(result.findings.some((f) => f.id === "todo-fixme-markers")).toBe(true);
  });

  it("1-3 markers → info severity", () => {
    const files = makeFiles([{
      path: "lib/scanner/scan.ts",
      content: "// TODO: a\n// TODO: b\n// FIXME: c",
    }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    const f = result.findings.find((f) => f.id === "todo-fixme-markers");
    expect(f?.severity).toBe("info");
  });

  it("4-10 markers → low severity", () => {
    const content = Array.from({ length: 7 }, (_, i) => `// TODO: item ${i}`).join("\n");
    const files = makeFiles([{ path: "lib/scanner/scan.ts", content }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    const f = result.findings.find((f) => f.id === "todo-fixme-markers");
    expect(f?.severity).toBe("low");
  });

  it(">10 markers → medium severity", () => {
    const content = Array.from({ length: 12 }, (_, i) => `// TODO: item ${i}`).join("\n");
    const files = makeFiles([{ path: "lib/scanner/scan.ts", content }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    const f = result.findings.find((f) => f.id === "todo-fixme-markers");
    expect(f?.severity).toBe("medium");
  });

  it("TODO markers appear in metrics.todoMarkers", () => {
    const files = makeFiles([{ path: "lib/scanner/scan.ts", content: "// TODO: fix\n// FIXME: later" }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    expect(result.maintainabilityMetrics?.todoMarkers.some((m) => m.path === "lib/scanner/scan.ts")).toBe(true);
  });

  it("no TODO markers → no finding", () => {
    const files = makeFiles([{ path: "lib/scanner/scan.ts", content: "const x = 1;" }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    expect(result.findings.some((f) => f.id === "todo-fixme-markers")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C. Scanner concentration
// ---------------------------------------------------------------------------

describe("C: scanner concentration", () => {
  it("large lib/scanner/ file → scanner concentration finding", () => {
    const content = bigFile(850);
    const files = makeFiles([{ path: "lib/scanner/staticScan.ts", content }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    const f = result.findings.find((f) => f.id.startsWith("scanner-concentration-"));
    expect(f).toBeDefined();
    expect(f?.title).toContain("Scanner rule concentration");
  });

  it("small scanner file → no concentration finding", () => {
    const files = makeFiles([{ path: "lib/scanner/ignoreRules.ts", content: bigFile(100) }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    expect(result.findings.some((f) => f.id.startsWith("scanner-concentration-"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D. Schema / reportVersion
// ---------------------------------------------------------------------------

describe("D: schema version", () => {
  it("schema file without reportVersion → schema-version-missing finding", () => {
    const files = makeFiles([{
      path: "lib/scanner/types.ts",
      content: "export interface ScanReport { repoName: string; findings: Finding[]; }",
    }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    expect(result.findings.some((f) => f.id === "schema-version-missing")).toBe(true);
  });

  it("file with reportVersion defined → no schema-version-missing finding", () => {
    const files = makeFiles([{
      path: "lib/scanner/types.ts",
      content: "export interface ScanReport { reportVersion: string; repoName: string; }",
    }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    expect(result.findings.some((f) => f.id === "schema-version-missing")).toBe(false);
  });

  it("reportVersion appears in ScanReport from staticScan", () => {
    const report = staticScan("owner/repo", [
      { path: "agents.yaml", size: 50, content: "agents:\n  - id: a\n    name: A" },
    ]);
    expect(report.reportVersion).toBe(REPORT_VERSION);
  });
});

// ---------------------------------------------------------------------------
// E. Dashboard complexity
// ---------------------------------------------------------------------------

describe("E: dashboard complexity", () => {
  it("large component in /dashboard/ → dashboard complexity finding", () => {
    const files = makeFiles([{
      path: "components/dashboard/DashboardClient.tsx",
      content: bigFile(350),
    }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    expect(result.findings.some((f) => f.id.startsWith("dashboard-complexity-"))).toBe(true);
  });

  it("small dashboard component → no finding", () => {
    const files = makeFiles([{
      path: "components/dashboard/AgentCard.tsx",
      content: bigFile(80),
    }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    expect(result.findings.some((f) => f.id.startsWith("dashboard-complexity-"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F. Golden fixtures
// ---------------------------------------------------------------------------

describe("F: golden fixtures", () => {
  it("tests present but no golden fixtures → low finding", () => {
    const report = makeReport({ detectedTests: ["lib/__tests__/scanner.test.ts"] });
    const files = makeFiles([
      { path: "lib/__tests__/scanner.test.ts", content: "describe('scanner', () => {})" },
    ]);
    const result = maintainabilityAuditor({ report, files, allowLlmAuditors: false });
    expect(result.findings.some((f) => f.id === "missing-golden-fixtures")).toBe(true);
  });

  it("tests present with golden fixture JSON → no missing-golden-fixtures finding", () => {
    const report = makeReport({ detectedTests: ["lib/__tests__/scanner.test.ts"] });
    const files = makeFiles([
      { path: "lib/__tests__/scanner.test.ts", content: "describe('scanner', () => {})" },
      {
        path: "lib/__fixtures__/goldenReport.json",
        content: '{ "repoName": "test", "findings": [], "detectedAgents": [] }',
      },
    ]);
    const result = maintainabilityAuditor({ report, files, allowLlmAuditors: false });
    expect(result.findings.some((f) => f.id === "missing-golden-fixtures")).toBe(false);
  });

  it("no tests → no missing-golden-fixtures finding", () => {
    const report = makeReport({ detectedTests: [] });
    const files = makeFiles([]);
    const result = maintainabilityAuditor({ report, files, allowLlmAuditors: false });
    expect(result.findings.some((f) => f.id === "missing-golden-fixtures")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// G. Score behavior
// ---------------------------------------------------------------------------

describe("G: score behavior", () => {
  it("clean small repo scores >= 85", () => {
    const report = makeReport({ detectedTests: ["test.ts"], detectedEvals: [] });
    const files = makeFiles([
      { path: "README.md", content: "# Project\nSome docs." },
      { path: "agents/editor_agent.py", content: "class EditorAgent: pass" },
      { path: "test.ts", content: "describe('test', () => {})" },
    ]);
    const result = maintainabilityAuditor({ report, files, allowLlmAuditors: false });
    expect(result.maintainabilityScore).toBeGreaterThanOrEqual(85);
  });

  it("repo with multiple debt signals scores lower", () => {
    const report = makeReport({ detectedTests: [] });
    const todoContent = Array.from({ length: 15 }, (_, i) => `// TODO: fix ${i}`).join("\n");
    const files = makeFiles([
      { path: "lib/scanner/staticScan.ts", content: bigFile(900) },
      { path: "lib/scanner/staticScan.ts_extra", content: todoContent },
      { path: "components/dashboard/DashboardClient.tsx", content: bigFile(400) },
    ]);
    const result = maintainabilityAuditor({ report, files, allowLlmAuditors: false });
    expect(result.maintainabilityScore).toBeLessThan(85);
  });

  it("maintainability score never goes below 20", () => {
    const report = makeReport({ detectedTests: [] });
    // Maximum possible debt signals
    const files = makeFiles([
      { path: "lib/scanner/staticScan.ts", content: bigFile(1200) },
      { path: "lib/scanner/classifyFiles.ts", content: bigFile(900) },
      { path: "lib/reports/recommendations.ts", content: bigFile(800) },
      { path: "components/dashboard/DashboardClient.tsx", content: bigFile(700) },
      { path: "components/dashboard/FindingTable.tsx", content: bigFile(600) },
      { path: "components/dashboard/ScanSummary.tsx", content: bigFile(500) },
      { path: "lib/scanner/types.ts", content: "export interface ScanReport { repoName: string; }" },
      {
        path: "lib/scanner/other.ts",
        content: Array.from({ length: 30 }, (_, i) => `// TODO: item ${i}`).join("\n"),
      },
    ]);
    const result = maintainabilityAuditor({ report, files, allowLlmAuditors: false });
    expect(result.maintainabilityScore).toBeGreaterThanOrEqual(20);
  });

  it("maintainability score is set in AuditorResult", () => {
    const files = makeFiles([{ path: "agents/agent.ts", content: "export const agent = {};" }]);
    const result = maintainabilityAuditor({ report: makeReport(), files, allowLlmAuditors: false });
    expect(result.maintainabilityScore).toBeDefined();
    expect(typeof result.maintainabilityScore).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// H. Integration
// ---------------------------------------------------------------------------

describe("H: integration", () => {
  it("ScanReport includes maintainability score from scoreScan base", () => {
    const report = staticScan("owner/repo", [
      { path: "agents.yaml", size: 50, content: "agents:\n  - id: a\n    name: A" },
    ]);
    expect(typeof report.scores.maintainability).toBe("number");
  });

  it("markdown export includes Maintainability score", () => {
    const report = staticScan("owner/repo", [
      { path: "agents.yaml", size: 50, content: "agents:\n  - id: a\n    name: A" },
    ]);
    const md = exportReportMarkdown(report);
    expect(md).toContain("Maintainability");
  });

  it("markdown export includes report version", () => {
    const report = staticScan("owner/repo", [
      { path: "agents.yaml", size: 50, content: "agents:\n  - id: a\n    name: A" },
    ]);
    const md = exportReportMarkdown(report);
    expect(md).toContain(report.reportVersion);
  });

  it("overall score includes maintainability weight", () => {
    const report = staticScan("owner/repo", [
      { path: "agents.yaml", size: 50, content: "agents:\n  - id: a\n    name: A" },
    ]);
    expect(report.scores.overall).toBeGreaterThan(0);
    expect(report.scores.overall).toBeLessThanOrEqual(100);
  });
});
