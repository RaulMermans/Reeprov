/**
 * File-backed integration registry store.
 *
 * Layout:
 *   .agentpulse/integrations/
 *     index.json            — array of ProjectIntegration, newest first
 *     {integrationId}.json  — full ProjectIntegration
 *
 * This implementation is swappable: callers depend only on IntegrationStore.
 * Fails gracefully if the filesystem is read-only (e.g. Vercel production).
 */

import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateIntegrationId } from "./integrationId";
import {
  type CreateIntegrationInput,
  type IntegrationLanguage,
  type IntegrationMode,
  type IntegrationStatus,
  type IntegrationStore,
  type ProjectIntegration,
  type UpdateIntegrationInput,
} from "./integrationTypes";

// ── Store directory ───────────────────────────────────────────────────────────

function storeDir(): string {
  const base =
    process.env["AGENTPULSE_STORE_DIR"] ??
    join(process.cwd(), ".agentpulse");
  return join(base, "integrations");
}

function indexPath(): string {
  return join(storeDir(), "index.json");
}

function safeId(id: string): string {
  return id.replace(/[^a-z0-9_-]/gi, "");
}

function integrationPath(integrationId: string): string {
  return join(storeDir(), `${safeId(integrationId)}.json`);
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

async function readIndex(): Promise<ProjectIntegration[]> {
  try {
    const raw = await readFile(indexPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as ProjectIntegration[];
    return [];
  } catch {
    return [];
  }
}

async function writeIndex(entries: ProjectIntegration[]): Promise<void> {
  await writeFile(indexPath(), JSON.stringify(entries, null, 2), "utf8");
}

async function readSavedIntegration(integrationId: string): Promise<ProjectIntegration | null> {
  try {
    const raw = await readFile(integrationPath(integrationId), "utf8");
    return JSON.parse(raw) as ProjectIntegration;
  } catch {
    return null;
  }
}

async function writeSavedIntegration(integration: ProjectIntegration): Promise<void> {
  await writeFile(integrationPath(integration.integrationId), JSON.stringify(integration, null, 2), "utf8");
}

async function upsertIndex(integration: ProjectIntegration): Promise<void> {
  const existing = await readIndex();
  const filtered = existing.filter((e) => e.integrationId !== integration.integrationId);
  await writeIndex([integration, ...filtered]);
}

// ── File-backed implementation ────────────────────────────────────────────────

export const fileIntegrationStore: IntegrationStore = {

  async createIntegration(input: CreateIntegrationInput): Promise<ProjectIntegration> {
    await ensureStoreDir();

    const now = new Date().toISOString();
    const integrationId = generateIntegrationId();

    const integration: ProjectIntegration = {
      integrationId,
      projectId: input.projectId,
      projectName: input.projectName,
      description: input.description,
      defaultWorkflowId: input.defaultWorkflowId,
      repositoryUrl: input.repositoryUrl,
      language: input.language,
      framework: input.framework,
      status: "waiting_for_first_event",
      mode: input.mode ?? "trace_sdk",
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await writeSavedIntegration(integration);
    await upsertIndex(integration);

    return integration;
  },

  async listIntegrations(filters): Promise<ProjectIntegration[]> {
    try {
      let entries = await readIndex();
      if (filters?.projectId) {
        entries = entries.filter((e) => e.projectId === filters.projectId);
      }
      if (filters?.status) {
        entries = entries.filter((e) => e.status === filters.status);
      }
      if (filters?.mode) {
        entries = entries.filter((e) => e.mode === filters.mode);
      }
      if (filters?.language) {
        entries = entries.filter((e) => e.language === filters.language);
      }
      if (filters?.limit && filters.limit > 0) {
        entries = entries.slice(0, filters.limit);
      }
      return entries;
    } catch {
      return [];
    }
  },

  async getIntegration(integrationId: string): Promise<ProjectIntegration | null> {
    return readSavedIntegration(integrationId);
  },

  async getIntegrationByProjectId(projectId: string): Promise<ProjectIntegration | null> {
    try {
      const index = await readIndex();
      const match = index.find((e) => e.projectId === projectId);
      if (!match) return null;
      return readSavedIntegration(match.integrationId);
    } catch {
      return null;
    }
  },

  async updateIntegration(integrationId: string, patch: UpdateIntegrationInput): Promise<ProjectIntegration | null> {
    try {
      const saved = await readSavedIntegration(integrationId);
      if (!saved) return null;

      const updated: ProjectIntegration = {
        ...saved,
        ...(patch.projectName !== undefined ? { projectName: patch.projectName } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.defaultWorkflowId !== undefined ? { defaultWorkflowId: patch.defaultWorkflowId } : {}),
        ...(patch.repositoryUrl !== undefined ? { repositoryUrl: patch.repositoryUrl } : {}),
        ...(patch.language !== undefined ? { language: patch.language } : {}),
        ...(patch.framework !== undefined ? { framework: patch.framework } : {}),
        ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        updatedAt: new Date().toISOString(),
      };

      await writeSavedIntegration(updated);
      await upsertIndex(updated);
      return updated;
    } catch {
      return null;
    }
  },

  async deleteIntegration(integrationId: string): Promise<boolean> {
    try {
      await unlink(integrationPath(integrationId));
      const existing = await readIndex();
      await writeIndex(existing.filter((e) => e.integrationId !== integrationId));
      return true;
    } catch {
      return false;
    }
  },

  async recordEventSeen(
    projectId: string,
    opts: { runId?: string; runStatus?: string },
  ): Promise<ProjectIntegration | null> {
    try {
      const index = await readIndex();
      const match = index.find((e) => e.projectId === projectId);

      if (!match) {
        // Auto-create a lightweight integration for this project.
        await ensureStoreDir();
        const now = new Date().toISOString();
        const integrationId = generateIntegrationId();
        const newIntegration: ProjectIntegration = {
          integrationId,
          projectId,
          projectName: projectId,
          status: "receiving_events",
          mode: "trace_sdk",
          lastEventAt: now,
          lastRunId: opts.runId,
          lastRunStatus: opts.runStatus,
          runCount: opts.runId ? 1 : 0,
          createdAt: now,
          updatedAt: now,
        };
        await writeSavedIntegration(newIntegration);
        await upsertIndex(newIntegration);
        return newIntegration;
      }

      // Update existing integration.
      const saved = await readSavedIntegration(match.integrationId);
      if (!saved) return null;

      const now = new Date().toISOString();
      const isNewRun = opts.runId && opts.runId !== saved.lastRunId;

      const updated: ProjectIntegration = {
        ...saved,
        status: "receiving_events",
        lastEventAt: now,
        ...(opts.runId ? { lastRunId: opts.runId } : {}),
        ...(opts.runStatus ? { lastRunStatus: opts.runStatus } : {}),
        runCount: isNewRun ? saved.runCount + 1 : saved.runCount,
        updatedAt: now,
      };

      await writeSavedIntegration(updated);
      await upsertIndex(updated);
      return updated;
    } catch {
      return null;
    }
  },
};

// ── Auto-create helper for ingestion pipeline ─────────────────────────────────

/**
 * Called from ingestion routes to keep integration status up-to-date.
 * Non-fatal: errors are logged but never propagate to callers.
 */
export async function touchIntegrationForProject(
  projectId: string,
  opts: { runId?: string; runStatus?: string } = {},
): Promise<void> {
  try {
    await fileIntegrationStore.recordEventSeen(projectId, opts);
  } catch (err) {
    console.error("[integrations] touchIntegrationForProject error:", err);
  }
}

// ── Type re-exports ───────────────────────────────────────────────────────────

export type {
  ProjectIntegration,
  CreateIntegrationInput,
  UpdateIntegrationInput,
  IntegrationStatus,
  IntegrationMode,
  IntegrationLanguage,
};
