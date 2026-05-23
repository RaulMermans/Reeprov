import type { ScanReport } from "@/lib/scanner/types";

// ── Severity counts ───────────────────────────────────────────────────────────

export interface FindingCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

// ── Detected artifact counts ──────────────────────────────────────────────────

export interface DetectedCounts {
  agents: number;
  prompts: number;
  tools: number;
  evals: number;
  tests: number;
  workflows: number;
}

// ── Health status ─────────────────────────────────────────────────────────────

export type HealthStatus = "healthy" | "needs-attention" | "at-risk" | "critical";

export function computeHealthStatus(score: number): HealthStatus {
  if (score >= 80) return "healthy";
  if (score >= 60) return "needs-attention";
  if (score >= 40) return "at-risk";
  return "critical";
}

export function buildFindingCounts(findings: ScanReport["findings"]): FindingCounts {
  const counts: FindingCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  return counts;
}

export function buildDetectedCounts(report: ScanReport): DetectedCounts {
  return {
    agents: report.detectedAgents.length,
    prompts: report.detectedPrompts.length,
    tools: report.detectedTools.length,
    evals: report.detectedEvals.length,
    tests: report.detectedTests.length,
    workflows: report.detectedWorkflowsDetailed.length,
  };
}

// ── Saved report summary (used for listing) ───────────────────────────────────

/**
 * Lightweight summary stored in the index — enough to render the history list
 * without loading each full report file.
 */
export interface SavedReportSummary {
  reportId: string;
  projectId: string;
  repoName: string;
  sourceType: "github" | "zip" | "mock";
  score: number;
  healthStatus: HealthStatus;
  generatedAt: string;
  reportVersion: string;
  scannerVersion: string;
  findingCounts: FindingCounts;
  detectedCounts: DetectedCounts;
}

// ── Full saved report ─────────────────────────────────────────────────────────

/** A ScanReport that has been persisted to disk. Includes the savedAt timestamp. */
export interface SavedReport extends ScanReport {
  savedAt: string;
}

// ── Store result ──────────────────────────────────────────────────────────────

export interface SaveResult {
  saved: boolean;
  reportId: string;
  savedAt?: string;
  warning?: string;
}

// ── Store interface ───────────────────────────────────────────────────────────

/**
 * Minimal persistence interface. The default implementation is file-backed.
 * A future version can swap in DB / blob storage without changing callers.
 */
export interface ReportStore {
  saveReport(report: ScanReport): Promise<SaveResult>;
  listReports(filters?: { projectId?: string; limit?: number }): Promise<SavedReportSummary[]>;
  getReport(reportId: string): Promise<SavedReport | null>;
  deleteReport(reportId: string): Promise<boolean>;
}

// ── Summary builder ───────────────────────────────────────────────────────────

export function buildSavedReportSummary(report: ScanReport): SavedReportSummary {
  return {
    reportId: report.reportId,
    projectId: report.projectId,
    repoName: report.repoName,
    sourceType: (report.scanSource?.type ?? "mock") as "github" | "zip" | "mock",
    score: report.scores.overall,
    healthStatus: computeHealthStatus(report.scores.overall),
    generatedAt: report.generatedAt,
    reportVersion: report.reportVersion,
    scannerVersion: report.scannerVersion,
    findingCounts: buildFindingCounts(report.findings),
    detectedCounts: buildDetectedCounts(report),
  };
}
