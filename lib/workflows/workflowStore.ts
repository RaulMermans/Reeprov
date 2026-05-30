/**
 * File-backed workflow registry store.
 *
 * Layout:
 *   .agentpulse/workflows/
 *     index.json            — array of SavedWorkflowSummary, newest first
 *     {registryId}.json     — full SavedWorkflowSpec
 *
 * This implementation is swappable: callers depend only on WorkflowStore.
 * Fails gracefully if the filesystem is read-only (e.g. Vercel production).
 *
 * Deduplication:
 *   If a workflow with the same workflowId + sourceReportId already exists,
 *   saveWorkflow() updates/replaces the existing entry rather than creating
 *   a duplicate. Entries with no sourceReportId are treated as unique by
 *   registryId (callers control identity).
 */

import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateRegistryId } from "./workflowId";
import {
  buildWorkflowSummary,
  type SavedWorkflowSpec,
  type SavedWorkflowSummary,
  type SaveWorkflowInput,
  type WorkflowRegistryStatus,
  type WorkflowStore,
} from "./workflowTypes";

// ── Store directory ───────────────────────────────────────────────────────────

function storeDir(): string {
  const base =
    process.env["AGENTPULSE_STORE_DIR"] ??
    join(process.cwd(), ".agentpulse");
  return join(base, "workflows");
}

function indexPath(): string {
  return join(storeDir(), "index.json");
}

function safeId(id: string): string {
  return id.replace(/[^a-z0-9_-]/gi, "");
}

function workflowPath(registryId: string): string {
  return join(storeDir(), `${safeId(registryId)}.json`);
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

async function readIndex(): Promise<SavedWorkflowSummary[]> {
  try {
    const raw = await readFile(indexPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as SavedWorkflowSummary[];
    return [];
  } catch {
    return [];
  }
}

async function writeIndex(entries: SavedWorkflowSummary[]): Promise<void> {
  await writeFile(indexPath(), JSON.stringify(entries, null, 2), "utf8");
}

async function readSavedWorkflow(registryId: string): Promise<SavedWorkflowSpec | null> {
  try {
    const raw = await readFile(workflowPath(registryId), "utf8");
    return JSON.parse(raw) as SavedWorkflowSpec;
  } catch {
    return null;
  }
}

async function writeSavedWorkflow(saved: SavedWorkflowSpec): Promise<void> {
  await writeFile(workflowPath(saved.registryId), JSON.stringify(saved, null, 2), "utf8");
}

async function upsertIndex(summary: SavedWorkflowSummary): Promise<void> {
  const existing = await readIndex();
  const filtered = existing.filter((e) => e.registryId !== summary.registryId);
  await writeIndex([summary, ...filtered]);
}

// ── Find existing by deduplication key ───────────────────────────────────────

async function findExistingByDedupeKey(
  workflowId: string,
  sourceReportId: string | undefined,
): Promise<SavedWorkflowSummary | null> {
  if (!sourceReportId) return null;
  const index = await readIndex();
  return index.find(
    (e) => e.workflowId === workflowId && e.sourceReportId === sourceReportId,
  ) ?? null;
}

// ── File-backed implementation ────────────────────────────────────────────────

export const fileWorkflowStore: WorkflowStore = {

  async saveWorkflow(input: SaveWorkflowInput): Promise<SavedWorkflowSpec> {
    await ensureStoreDir();

    const now = new Date().toISOString();

    // Deduplication: if same workflowId + sourceReportId exists, replace it.
    const existing = await findExistingByDedupeKey(input.workflowId, input.sourceReportId);
    const registryId = existing?.registryId ?? generateRegistryId();
    const createdAt = existing ? (await readSavedWorkflow(registryId))?.createdAt ?? now : now;

    const saved: SavedWorkflowSpec = {
      registryId,
      workflowId: input.workflowId,
      projectId: input.projectId,
      projectName: input.projectName,
      name: input.name,
      description: input.spec.description,
      version: input.spec.version ?? "1.0",
      architectureType: input.spec.architecture_type,
      source: input.source,
      confidence: input.confidence,
      status: input.status,
      sourceReportId: input.sourceReportId,
      sourceReconstructionId: input.sourceReconstructionId,
      evidencePaths: input.evidencePaths,
      missingFields: input.missingFields,
      missingLinks: input.missingLinks,
      createdAt,
      updatedAt: now,
      spec: input.spec,
    };

    await writeSavedWorkflow(saved);
    await upsertIndex(buildWorkflowSummary(saved));

    return saved;
  },

  async listWorkflows(filters): Promise<SavedWorkflowSummary[]> {
    try {
      let entries = await readIndex();
      if (filters?.projectId) {
        entries = entries.filter((e) => e.projectId === filters.projectId);
      }
      if (filters?.source) {
        entries = entries.filter((e) => e.source === filters.source);
      }
      if (filters?.status) {
        entries = entries.filter((e) => e.status === filters.status);
      }
      if (filters?.confidence) {
        entries = entries.filter((e) => e.confidence === filters.confidence);
      }
      if (filters?.workflowId) {
        entries = entries.filter((e) => e.workflowId === filters.workflowId);
      }
      if (filters?.limit && filters.limit > 0) {
        entries = entries.slice(0, filters.limit);
      }
      return entries;
    } catch {
      return [];
    }
  },

  async getWorkflow(registryId: string): Promise<SavedWorkflowSpec | null> {
    return readSavedWorkflow(registryId);
  },

  async getWorkflowByWorkflowId(workflowId: string): Promise<SavedWorkflowSpec | null> {
    try {
      const index = await readIndex();
      const match = index.find((e) => e.workflowId === workflowId);
      if (!match) return null;
      return readSavedWorkflow(match.registryId);
    } catch {
      return null;
    }
  },

  async updateWorkflowStatus(registryId: string, status: WorkflowRegistryStatus): Promise<SavedWorkflowSpec | null> {
    try {
      const saved = await readSavedWorkflow(registryId);
      if (!saved) return null;
      saved.status = status;
      saved.updatedAt = new Date().toISOString();
      await writeSavedWorkflow(saved);
      await upsertIndex(buildWorkflowSummary(saved));
      return saved;
    } catch {
      return null;
    }
  },

  async deleteWorkflow(registryId: string): Promise<boolean> {
    try {
      await unlink(workflowPath(registryId));
      const existing = await readIndex();
      await writeIndex(existing.filter((e) => e.registryId !== registryId));
      return true;
    } catch {
      return false;
    }
  },
};
