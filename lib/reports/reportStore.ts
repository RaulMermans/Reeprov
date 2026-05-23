/**
 * File-backed report store.
 *
 * Layout:
 *   .agentpulse/reports/
 *     index.json         — array of SavedReportSummary, newest first
 *     {reportId}.json    — full SavedReport
 *
 * This implementation is swappable: callers depend only on ReportStore.
 * Fails gracefully if the filesystem is read-only (e.g. Vercel production).
 */

import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScanReport } from "@/lib/scanner/types";
import { buildSavedReportSummary, type ReportStore, type SavedReport, type SavedReportSummary, type SaveResult } from "./reportTypes";

// ── Store directory ───────────────────────────────────────────────────────────

function storeDir(): string {
  return (
    process.env["AGENTPULSE_STORE_DIR"] ??
    join(process.cwd(), ".agentpulse", "reports")
  );
}

function indexPath(): string {
  return join(storeDir(), "index.json");
}

function reportPath(reportId: string): string {
  // Safety: only allow safe ID characters to prevent path traversal.
  const safe = reportId.replace(/[^a-z0-9_-]/gi, "");
  return join(storeDir(), `${safe}.json`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ensureStoreDir(): Promise<void> {
  const dir = storeDir();
  try {
    await access(dir);
  } catch {
    await mkdir(dir, { recursive: true });
  }
}

async function readIndex(): Promise<SavedReportSummary[]> {
  try {
    const raw = await readFile(indexPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as SavedReportSummary[];
    return [];
  } catch {
    return [];
  }
}

async function writeIndex(entries: SavedReportSummary[]): Promise<void> {
  await writeFile(indexPath(), JSON.stringify(entries, null, 2), "utf8");
}

// ── File-backed implementation ────────────────────────────────────────────────

export const fileReportStore: ReportStore = {
  async saveReport(report: ScanReport): Promise<SaveResult> {
    const reportId = report.reportId;
    const savedAt = new Date().toISOString();

    try {
      await ensureStoreDir();

      const savedReport: SavedReport = { ...report, savedAt };
      await writeFile(reportPath(reportId), JSON.stringify(savedReport, null, 2), "utf8");

      const summary = buildSavedReportSummary(report);
      const existing = await readIndex();
      // Remove any previous entry with the same reportId (idempotent upsert).
      const filtered = existing.filter((e) => e.reportId !== reportId);
      // Prepend so newest is first.
      await writeIndex([summary, ...filtered]);

      return { saved: true, reportId, savedAt };
    } catch (err) {
      const warning =
        err instanceof Error ? err.message : "Unknown persistence error";
      return { saved: false, reportId, warning };
    }
  },

  async listReports(
    filters?: { projectId?: string; limit?: number },
  ): Promise<SavedReportSummary[]> {
    try {
      let entries = await readIndex();
      if (filters?.projectId) {
        entries = entries.filter((e) => e.projectId === filters.projectId);
      }
      if (filters?.limit && filters.limit > 0) {
        entries = entries.slice(0, filters.limit);
      }
      return entries;
    } catch {
      return [];
    }
  },

  async getReport(reportId: string): Promise<SavedReport | null> {
    try {
      const raw = await readFile(reportPath(reportId), "utf8");
      return JSON.parse(raw) as SavedReport;
    } catch {
      return null;
    }
  },

  async deleteReport(reportId: string): Promise<boolean> {
    try {
      await unlink(reportPath(reportId));
      const existing = await readIndex();
      await writeIndex(existing.filter((e) => e.reportId !== reportId));
      return true;
    } catch {
      return false;
    }
  },
};
