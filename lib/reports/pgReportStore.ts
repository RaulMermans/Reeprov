/**
 * Postgres-backed report store.
 *
 * Implements the same ReportStore interface as fileReportStore.
 * Used in production when DATABASE_URL is set.
 *
 * The full ScanReport is stored in the `report_data` JSONB column.
 * Indexed summary fields (score, project_id, etc.) are stored as typed columns
 * for efficient list queries.
 */

import { getDb } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/migrate";
import type { ScanReport } from "@/lib/scanner/types";
import {
  buildSavedReportSummary,
  computeHealthStatus,
  buildFindingCounts,
  buildDetectedCounts,
  type ReportStore,
  type SavedReport,
  type SavedReportSummary,
  type SaveResult,
} from "./reportTypes";

// ── Row → Domain mapping ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToSummary(row: Record<string, any>): SavedReportSummary {
  return {
    reportId: row["report_id"] as string,
    projectId: row["project_id"] as string,
    repoName: row["repo_name"] as string,
    sourceType: row["source_type"] as "github" | "zip" | "mock",
    score: Number(row["overall_score"]),
    healthStatus: computeHealthStatus(Number(row["overall_score"])),
    generatedAt: (row["generated_at"] as Date).toISOString(),
    reportVersion: row["report_version"] as string,
    scannerVersion: row["scanner_version"] as string,
    findingCounts: typeof row["finding_counts"] === "string"
      ? JSON.parse(row["finding_counts"])
      : row["finding_counts"],
    detectedCounts: typeof row["detected_counts"] === "string"
      ? JSON.parse(row["detected_counts"])
      : row["detected_counts"],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToSavedReport(row: Record<string, any>): SavedReport {
  const data = typeof row["report_data"] === "string"
    ? JSON.parse(row["report_data"])
    : row["report_data"];
  return {
    ...data,
    savedAt: (row["saved_at"] as Date).toISOString(),
  } as SavedReport;
}

// ── Postgres implementation ───────────────────────────────────────────────────

export const pgReportStore: ReportStore = {

  async saveReport(report: ScanReport): Promise<SaveResult> {
    const reportId = report.reportId;
    const savedAt = new Date();

    try {
      await ensureSchema();
      const sql = getDb();

      const summary = buildSavedReportSummary(report);
      const sourceType = (report.scanSource?.type ?? "mock") as "github" | "zip" | "mock";

      await sql`
        INSERT INTO ap_reports (
          report_id, project_id, repo_name, source_type,
          overall_score, health_status, report_version, scanner_version,
          generated_at, saved_at, finding_counts, detected_counts, report_data
        ) VALUES (
          ${reportId},
          ${report.projectId},
          ${report.repoName},
          ${sourceType},
          ${report.scores.overall},
          ${summary.healthStatus},
          ${report.reportVersion},
          ${report.scannerVersion},
          ${new Date(report.generatedAt)},
          ${savedAt},
          ${JSON.stringify(buildFindingCounts(report.findings))},
          ${JSON.stringify(buildDetectedCounts(report))},
          ${JSON.stringify({ ...report, savedAt: savedAt.toISOString() })}
        )
        ON CONFLICT (report_id) DO UPDATE SET
          overall_score   = EXCLUDED.overall_score,
          health_status   = EXCLUDED.health_status,
          saved_at        = EXCLUDED.saved_at,
          finding_counts  = EXCLUDED.finding_counts,
          detected_counts = EXCLUDED.detected_counts,
          report_data     = EXCLUDED.report_data
      `;

      return { saved: true, reportId, savedAt: savedAt.toISOString() };
    } catch (err) {
      const warning = err instanceof Error ? err.message : "Unknown persistence error";
      return { saved: false, reportId, warning };
    }
  },

  async listReports(
    filters?: { projectId?: string; limit?: number },
  ): Promise<SavedReportSummary[]> {
    try {
      await ensureSchema();
      const sql = getDb();
      const limit = filters?.limit && filters.limit > 0 ? filters.limit : 50;

      if (filters?.projectId) {
        const rows = await sql`
          SELECT report_id, project_id, repo_name, source_type,
                 overall_score, health_status, report_version, scanner_version,
                 generated_at, saved_at, finding_counts, detected_counts
          FROM ap_reports
          WHERE project_id = ${filters.projectId}
          ORDER BY saved_at DESC
          LIMIT ${limit}
        `;
        return rows.map((r) => rowToSummary(r as Record<string, unknown>));
      }

      const rows = await sql`
        SELECT report_id, project_id, repo_name, source_type,
               overall_score, health_status, report_version, scanner_version,
               generated_at, saved_at, finding_counts, detected_counts
        FROM ap_reports
        ORDER BY saved_at DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => rowToSummary(r as Record<string, unknown>));
    } catch {
      return [];
    }
  },

  async getReport(reportId: string): Promise<SavedReport | null> {
    try {
      await ensureSchema();
      const sql = getDb();
      const rows = await sql`
        SELECT * FROM ap_reports WHERE report_id = ${reportId} LIMIT 1
      `;
      if (rows.length === 0) return null;
      return rowToSavedReport(rows[0] as Record<string, unknown>);
    } catch {
      return null;
    }
  },

  async deleteReport(reportId: string): Promise<boolean> {
    try {
      await ensureSchema();
      const sql = getDb();
      const result = await sql`DELETE FROM ap_reports WHERE report_id = ${reportId}`;
      return (result.count ?? 0) > 0;
    } catch {
      return false;
    }
  },
};
