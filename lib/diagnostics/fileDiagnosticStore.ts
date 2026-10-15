/**
 * File-backed ingest diagnostics store.
 *
 * Layout:
 *   .agentpulse/diagnostics/index.json — array of IngestDiagnostic, newest first
 *
 * Retention: on every write, entries older than DIAGNOSTIC_RETENTION_MS are
 * pruned, and only the MAX_DIAGNOSTICS_PER_PROJECT most recent entries are
 * kept per projectId (entries without a projectId are capped globally).
 * Fails gracefully if the filesystem is read-only.
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateDiagnosticId } from "./diagnosticId";
import { redactDiagnosticMessage } from "./redact";
import {
  DIAGNOSTIC_RETENTION_MS,
  MAX_DIAGNOSTICS_PER_PROJECT,
  type DiagnosticStore,
  type IngestDiagnostic,
  type RecordDiagnosticInput,
} from "./diagnosticTypes";

function storeDir(): string {
  const base =
    process.env["AGENTPULSE_STORE_DIR"] ??
    process.env["AGENTPULSE_HOME"] ??
    join(process.cwd(), ".agentpulse");
  return join(base, "diagnostics");
}

function indexPath(): string {
  return join(storeDir(), "index.json");
}

async function ensureStoreDir(): Promise<void> {
  const dir = storeDir();
  try {
    await access(dir);
  } catch {
    await mkdir(dir, { recursive: true });
  }
}

async function readIndex(): Promise<IngestDiagnostic[]> {
  try {
    const raw = await readFile(indexPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as IngestDiagnostic[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeIndex(entries: IngestDiagnostic[]): Promise<void> {
  await writeFile(indexPath(), JSON.stringify(entries, null, 2), "utf8");
}

/** Prunes by age, then caps per-project (or global, for entries with no projectId). */
function applyRetention(entries: IngestDiagnostic[]): IngestDiagnostic[] {
  const cutoff = Date.now() - DIAGNOSTIC_RETENTION_MS;
  const fresh = entries.filter((e) => new Date(e.createdAt).getTime() >= cutoff);

  const counts = new Map<string, number>();
  const kept: IngestDiagnostic[] = [];
  for (const entry of fresh) {
    const key = entry.projectId ?? "__global__";
    const count = counts.get(key) ?? 0;
    if (count >= MAX_DIAGNOSTICS_PER_PROJECT) continue;
    counts.set(key, count + 1);
    kept.push(entry);
  }
  return kept;
}

export const fileDiagnosticStore: DiagnosticStore = {
  async recordDiagnostic(input: RecordDiagnosticInput): Promise<IngestDiagnostic> {
    await ensureStoreDir();

    const diagnostic: IngestDiagnostic = {
      diagnosticId: generateDiagnosticId(),
      integrationId: input.integrationId,
      projectId: input.projectId,
      runId: input.runId,
      eventType: input.eventType,
      category: input.category,
      errorCode: input.errorCode,
      message: redactDiagnosticMessage(input.message),
      schemaPath: input.schemaPath,
      createdAt: new Date().toISOString(),
    };

    const existing = await readIndex();
    const next = applyRetention([diagnostic, ...existing]);
    await writeIndex(next);

    return diagnostic;
  },

  async listDiagnostics(filters): Promise<IngestDiagnostic[]> {
    let entries = await readIndex();
    if (filters?.projectId) {
      entries = entries.filter((e) => e.projectId === filters.projectId);
    }
    if (filters?.integrationId) {
      entries = entries.filter((e) => e.integrationId === filters.integrationId);
    }
    if (filters?.limit && filters.limit > 0) {
      entries = entries.slice(0, filters.limit);
    }
    return entries;
  },
};
