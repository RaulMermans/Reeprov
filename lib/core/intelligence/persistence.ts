/**
 * Persistence for Context and Memory Intelligence Reports.
 *
 * Implements dual-mode persistence (File + Postgres) for derived intelligence reports.
 *
 * Invariant:
 * Intelligence reports reference run IDs and hashes; they never duplicate raw context
 * or memory blobs. RunArtifacts remain completely immutable.
 */

import { access, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  contextIntelligenceReportSchema,
  type ContextIntelligenceReport,
} from "../contracts/contextIntelligence";
import {
  memoryIntelligenceReportSchema,
  type MemoryIntelligenceReport,
} from "../contracts/memoryIntelligence";
import { getDb, hasDatabaseUrl } from "../../db/client";
import { ensureSchema } from "../../db/migrate";

function intelligenceDir(type: "context" | "memory"): string {
  const base = process.env["AGENTPULSE_STORE_DIR"] ?? join(process.cwd(), ".agentpulse");
  return join(base, "intelligence", type);
}

function safeId(id: string): string {
  return id.replace(/[^a-z0-9_-]/gi, "");
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await access(dirPath);
  } catch {
    await mkdir(dirPath, { recursive: true });
  }
}

// ── Context Intelligence Persistence ─────────────────────────────────────────

export async function saveContextIntelligenceReport(
  report: ContextIntelligenceReport
): Promise<void> {
  const parsed = contextIntelligenceReportSchema.parse(report);

  // 1. File persistence
  const dir = intelligenceDir("context");
  await ensureDir(dir);
  const filePath = join(dir, `${safeId(parsed.report_id)}.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  // Also write run-indexed pointer for quick run_id lookup
  const runFilePath = join(dir, `run_${safeId(parsed.run_id)}.json`);
  await writeFile(runFilePath, JSON.stringify(parsed, null, 2), "utf8");

  // 2. Postgres persistence
  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_context_intelligence_reports (
          report_id,
          run_id,
          schema_version,
          report_data,
          created_at
        ) VALUES (
          ${parsed.report_id},
          ${parsed.run_id},
          ${parsed.schema_version},
          ${JSON.stringify(parsed)},
          ${parsed.generated_at}
        )
        ON CONFLICT (report_id) DO UPDATE SET
          report_data = EXCLUDED.report_data
      `;
    } catch {
      // Degrades gracefully to file storage
    }
  }
}

export async function getContextIntelligenceReport(
  reportOrRunId: string
): Promise<ContextIntelligenceReport | null> {
  // 1. Try Postgres
  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      const rows = await sql`
        SELECT report_data
        FROM ap_context_intelligence_reports
        WHERE report_id = ${reportOrRunId} OR run_id = ${reportOrRunId}
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (rows.length > 0) {
        const raw = typeof rows[0].report_data === "string" ? JSON.parse(rows[0].report_data) : rows[0].report_data;
        return contextIntelligenceReportSchema.parse(raw);
      }
    } catch {
      // Fall through to file store
    }
  }

  // 2. Try File Store
  const dir = intelligenceDir("context");
  try {
    const directPath = join(dir, `${safeId(reportOrRunId)}.json`);
    const raw = await readFile(directPath, "utf8");
    return contextIntelligenceReportSchema.parse(JSON.parse(raw));
  } catch {
    // Try run_ prefix
    try {
      const runPath = join(dir, `run_${safeId(reportOrRunId)}.json`);
      const raw = await readFile(runPath, "utf8");
      return contextIntelligenceReportSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }
}

// ── Memory Intelligence Persistence ──────────────────────────────────────────

export async function saveMemoryIntelligenceReport(
  report: MemoryIntelligenceReport
): Promise<void> {
  const parsed = memoryIntelligenceReportSchema.parse(report);

  // 1. File persistence
  const dir = intelligenceDir("memory");
  await ensureDir(dir);
  const filePath = join(dir, `${safeId(parsed.report_id)}.json`);
  await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");

  // Also write run-indexed pointer for quick run_id lookup
  const runFilePath = join(dir, `run_${safeId(parsed.run_id)}.json`);
  await writeFile(runFilePath, JSON.stringify(parsed, null, 2), "utf8");

  // 2. Postgres persistence
  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      await sql`
        INSERT INTO ap_memory_intelligence_reports (
          report_id,
          run_id,
          schema_version,
          report_data,
          created_at
        ) VALUES (
          ${parsed.report_id},
          ${parsed.run_id},
          ${parsed.schema_version},
          ${JSON.stringify(parsed)},
          ${parsed.generated_at}
        )
        ON CONFLICT (report_id) DO UPDATE SET
          report_data = EXCLUDED.report_data
      `;
    } catch {
      // Degrades gracefully to file storage
    }
  }
}

export async function getMemoryIntelligenceReport(
  reportOrRunId: string
): Promise<MemoryIntelligenceReport | null> {
  // 1. Try Postgres
  if (hasDatabaseUrl()) {
    try {
      await ensureSchema();
      const sql = getDb();
      const rows = await sql`
        SELECT report_data
        FROM ap_memory_intelligence_reports
        WHERE report_id = ${reportOrRunId} OR run_id = ${reportOrRunId}
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (rows.length > 0) {
        const raw = typeof rows[0].report_data === "string" ? JSON.parse(rows[0].report_data) : rows[0].report_data;
        return memoryIntelligenceReportSchema.parse(raw);
      }
    } catch {
      // Fall through to file store
    }
  }

  // 2. Try File Store
  const dir = intelligenceDir("memory");
  try {
    const directPath = join(dir, `${safeId(reportOrRunId)}.json`);
    const raw = await readFile(directPath, "utf8");
    return memoryIntelligenceReportSchema.parse(JSON.parse(raw));
  } catch {
    // Try run_ prefix
    try {
      const runPath = join(dir, `run_${safeId(reportOrRunId)}.json`);
      const raw = await readFile(runPath, "utf8");
      return memoryIntelligenceReportSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }
}

export const loadContextIntelligenceReport = getContextIntelligenceReport;
export const loadMemoryIntelligenceReport = getMemoryIntelligenceReport;

export async function listContextIntelligenceReports(): Promise<ContextIntelligenceReport[]> {
  const dir = intelligenceDir("context");
  try {
    const files = await readdir(dir);
    const reports: ContextIntelligenceReport[] = [];
    for (const f of files) {
      if (f.endsWith(".json") && !f.startsWith("run_")) {
        try {
          const raw = await readFile(join(dir, f), "utf8");
          reports.push(contextIntelligenceReportSchema.parse(JSON.parse(raw)));
        } catch {
          // ignore invalid file
        }
      }
    }
    return reports;
  } catch {
    return [];
  }
}

export async function listMemoryIntelligenceReports(): Promise<MemoryIntelligenceReport[]> {
  const dir = intelligenceDir("memory");
  try {
    const files = await readdir(dir);
    const reports: MemoryIntelligenceReport[] = [];
    for (const f of files) {
      if (f.endsWith(".json") && !f.startsWith("run_")) {
        try {
          const raw = await readFile(join(dir, f), "utf8");
          reports.push(memoryIntelligenceReportSchema.parse(JSON.parse(raw)));
        } catch {
          // ignore invalid file
        }
      }
    }
    return reports;
  } catch {
    return [];
  }
}
