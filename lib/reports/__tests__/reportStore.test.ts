/**
 * Phase 2 / Phase 11 — File-backed report store tests.
 *
 * Uses a real temp directory per test run so we verify actual I/O behavior.
 * Overrides AGENTPULSE_STORE_DIR so tests don't pollute .agentpulse/reports.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileReportStore } from "@/lib/reports/reportStore";
import { staticScan } from "@/lib/scanner/staticScan";
import type { ScanReport } from "@/lib/scanner/types";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "agentpulse-test-"));
  process.env["AGENTPULSE_STORE_DIR"] = tmpDir;
});

afterEach(async () => {
  delete process.env["AGENTPULSE_STORE_DIR"];
  await rm(tmpDir, { recursive: true, force: true });
});

function makeReport(repoName = "owner/repo"): ScanReport {
  return staticScan(repoName, [
    { path: "README.md", size: 100, content: "# Test repo" },
  ]);
}

// ── saveReport ────────────────────────────────────────────────────────────────

describe("fileReportStore.saveReport", () => {
  it("returns saved: true on success", async () => {
    const report = makeReport();
    const result = await fileReportStore.saveReport(report);
    expect(result.saved).toBe(true);
    expect(result.reportId).toBe(report.reportId);
    expect(result.savedAt).toBeTruthy();
  });

  it("saving the same reportId twice is idempotent (upsert)", async () => {
    const report = makeReport();
    await fileReportStore.saveReport(report);
    await fileReportStore.saveReport(report);

    const summaries = await fileReportStore.listReports();
    // Should only appear once in the index.
    const matches = summaries.filter((s) => s.reportId === report.reportId);
    expect(matches).toHaveLength(1);
  });

  it("fails gracefully when store dir is read-only (no exception thrown)", async () => {
    // Override to an invalid path so writes fail.
    process.env["AGENTPULSE_STORE_DIR"] = "/nonexistent/deeply/nested/path";
    const report = makeReport();
    const result = await fileReportStore.saveReport(report);
    // Should not throw — returns saved: false with a warning.
    expect(result.saved).toBe(false);
    expect(result.warning).toBeTruthy();
  });
});

// ── listReports ───────────────────────────────────────────────────────────────

describe("fileReportStore.listReports", () => {
  it("returns empty array when no reports saved", async () => {
    const result = await fileReportStore.listReports();
    expect(result).toEqual([]);
  });

  it("returns saved report summaries", async () => {
    const report = makeReport("owner/repo");
    await fileReportStore.saveReport(report);

    const result = await fileReportStore.listReports();
    expect(result).toHaveLength(1);
    expect(result[0].reportId).toBe(report.reportId);
    expect(result[0].repoName).toBe("owner/repo");
  });

  it("lists newest first", async () => {
    const r1 = makeReport("owner/repo-a");
    const r2 = makeReport("owner/repo-b");
    await fileReportStore.saveReport(r1);
    await fileReportStore.saveReport(r2);

    const result = await fileReportStore.listReports();
    expect(result).toHaveLength(2);
    // r2 was saved last, so it should be first (newest first).
    expect(result[0].reportId).toBe(r2.reportId);
  });

  it("filters by projectId", async () => {
    const r1 = makeReport("owner/repo-a");
    const r2 = makeReport("owner/repo-b");
    await fileReportStore.saveReport(r1);
    await fileReportStore.saveReport(r2);

    const result = await fileReportStore.listReports({ projectId: r1.projectId });
    expect(result).toHaveLength(1);
    expect(result[0].reportId).toBe(r1.reportId);
  });

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await fileReportStore.saveReport(makeReport(`owner/repo-${i}`));
    }
    const result = await fileReportStore.listReports({ limit: 3 });
    expect(result).toHaveLength(3);
  });

  it("summary includes correct findingCounts and detectedCounts", async () => {
    const report = makeReport();
    await fileReportStore.saveReport(report);

    const [summary] = await fileReportStore.listReports();
    expect(typeof summary.findingCounts.high).toBe("number");
    expect(typeof summary.detectedCounts.agents).toBe("number");
    expect(summary.score).toBe(report.scores.overall);
    expect(summary.reportVersion).toBe(report.reportVersion);
  });
});

// ── getReport ─────────────────────────────────────────────────────────────────

describe("fileReportStore.getReport", () => {
  it("returns the full report after saving", async () => {
    const report = makeReport();
    await fileReportStore.saveReport(report);

    const retrieved = await fileReportStore.getReport(report.reportId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.reportId).toBe(report.reportId);
    expect(retrieved?.repoName).toBe(report.repoName);
    expect(retrieved?.savedAt).toBeTruthy();
  });

  it("returns null for unknown reportId", async () => {
    const result = await fileReportStore.getReport("rpt_nonexistent");
    expect(result).toBeNull();
  });

  it("ignores path traversal attempts in reportId", async () => {
    // Should return null, not read an arbitrary file path.
    const result = await fileReportStore.getReport("../../../etc/passwd");
    expect(result).toBeNull();
  });
});

// ── deleteReport ──────────────────────────────────────────────────────────────

describe("fileReportStore.deleteReport", () => {
  it("deletes an existing report", async () => {
    const report = makeReport();
    await fileReportStore.saveReport(report);

    const deleted = await fileReportStore.deleteReport(report.reportId);
    expect(deleted).toBe(true);

    // Should no longer appear in list.
    const list = await fileReportStore.listReports();
    expect(list.find((s) => s.reportId === report.reportId)).toBeUndefined();

    // Should return null when fetched.
    const retrieved = await fileReportStore.getReport(report.reportId);
    expect(retrieved).toBeNull();
  });

  it("returns false when deleting a non-existent report", async () => {
    const result = await fileReportStore.deleteReport("rpt_nonexistent_999");
    expect(result).toBe(false);
  });
});
