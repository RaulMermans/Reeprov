/**
 * Postgres-backed integration registry store.
 *
 * Implements the same IntegrationStore interface as fileIntegrationStore.
 * Used in production when DATABASE_URL is set.
 */

import { getDb } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/migrate";
import { generateIntegrationId } from "./integrationId";
import { generateRawIngestKey, hashIngestKey, previewIngestKey } from "./ingestKey";
import type {
  CreateIntegrationInput,
  IntegrationLanguage,
  IntegrationMode,
  IntegrationStatus,
  IntegrationStore,
  ProjectIntegration,
  UpdateIntegrationInput,
} from "./integrationTypes";

// ── Row → Domain mapping ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToIntegration(row: Record<string, any>): ProjectIntegration {
  return {
    integrationId: row["integration_id"] as string,
    projectId: row["project_id"] as string,
    projectName: row["project_name"] as string,
    description: (row["description"] as string | null) ?? undefined,
    defaultWorkflowId: (row["default_workflow_id"] as string | null) ?? undefined,
    repositoryUrl: (row["repository_url"] as string | null) ?? undefined,
    language: (row["language"] as IntegrationLanguage | null) ?? undefined,
    framework: (row["framework"] as string | null) ?? undefined,
    status: row["status"] as IntegrationStatus,
    mode: row["mode"] as IntegrationMode,
    ingestKeyHash: (row["ingest_key_hash"] as string | null) ?? undefined,
    ingestKeyPreview: (row["ingest_key_preview"] as string | null) ?? undefined,
    lastEventAt: row["last_event_at"]
      ? (row["last_event_at"] as Date).toISOString()
      : undefined,
    lastRunId: (row["last_run_id"] as string | null) ?? undefined,
    lastRunStatus: (row["last_run_status"] as string | null) ?? undefined,
    runCount: row["run_count"] as number,
    createdAt: (row["created_at"] as Date).toISOString(),
    updatedAt: (row["updated_at"] as Date).toISOString(),
  };
}

// ── Postgres implementation ───────────────────────────────────────────────────

export const pgIntegrationStore: IntegrationStore = {

  async createIntegration(input: CreateIntegrationInput): Promise<ProjectIntegration> {
    await ensureSchema();
    const sql = getDb();
    const now = new Date();
    const integrationId = generateIntegrationId();

    const rows = await sql`
      INSERT INTO ap_integrations (
        integration_id, project_id, project_name, description,
        default_workflow_id, repository_url, language, framework,
        status, mode, run_count, created_at, updated_at
      ) VALUES (
        ${integrationId},
        ${input.projectId},
        ${input.projectName},
        ${input.description ?? null},
        ${input.defaultWorkflowId ?? null},
        ${input.repositoryUrl ?? null},
        ${input.language ?? null},
        ${input.framework ?? null},
        'waiting_for_first_event',
        ${input.mode ?? "trace_sdk"},
        0,
        ${now},
        ${now}
      )
      RETURNING *
    `;
    return rowToIntegration(rows[0] as Record<string, unknown>);
  },

  async listIntegrations(filters): Promise<ProjectIntegration[]> {
    await ensureSchema();
    const sql = getDb();

    // Build dynamic conditions using postgres.js tagged templates.
    // We apply filters in JS after the base query for simplicity.
    const limit = filters?.limit && filters.limit > 0 ? filters.limit : 200;

    let rows = await sql`
      SELECT * FROM ap_integrations
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;

    let items = rows.map((r) => rowToIntegration(r as Record<string, unknown>));

    if (filters?.projectId) {
      items = items.filter((i) => i.projectId === filters.projectId);
    }
    if (filters?.status) {
      items = items.filter((i) => i.status === filters.status);
    }
    if (filters?.mode) {
      items = items.filter((i) => i.mode === filters.mode);
    }
    if (filters?.language) {
      items = items.filter((i) => i.language === filters.language);
    }

    return items;
  },

  async getIntegration(integrationId: string): Promise<ProjectIntegration | null> {
    await ensureSchema();
    const sql = getDb();
    const rows = await sql`
      SELECT * FROM ap_integrations WHERE integration_id = ${integrationId} LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rowToIntegration(rows[0] as Record<string, unknown>);
  },

  async getIntegrationByProjectId(projectId: string): Promise<ProjectIntegration | null> {
    await ensureSchema();
    const sql = getDb();
    const rows = await sql`
      SELECT * FROM ap_integrations WHERE project_id = ${projectId}
      ORDER BY created_at ASC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rowToIntegration(rows[0] as Record<string, unknown>);
  },

  async updateIntegration(
    integrationId: string,
    patch: UpdateIntegrationInput,
  ): Promise<ProjectIntegration | null> {
    await ensureSchema();
    const sql = getDb();
    const now = new Date();

    const rows = await sql`
      UPDATE ap_integrations SET
        project_name        = COALESCE(${patch.projectName ?? null}, project_name),
        description         = CASE WHEN ${patch.description !== undefined} THEN ${patch.description ?? null} ELSE description END,
        default_workflow_id = CASE WHEN ${patch.defaultWorkflowId !== undefined} THEN ${patch.defaultWorkflowId ?? null} ELSE default_workflow_id END,
        repository_url      = CASE WHEN ${patch.repositoryUrl !== undefined} THEN ${patch.repositoryUrl ?? null} ELSE repository_url END,
        language            = CASE WHEN ${patch.language !== undefined} THEN ${patch.language ?? null} ELSE language END,
        framework           = CASE WHEN ${patch.framework !== undefined} THEN ${patch.framework ?? null} ELSE framework END,
        mode                = COALESCE(${patch.mode ?? null}, mode),
        status              = COALESCE(${patch.status ?? null}, status),
        updated_at          = ${now}
      WHERE integration_id = ${integrationId}
      RETURNING *
    `;
    if (rows.length === 0) return null;
    return rowToIntegration(rows[0] as Record<string, unknown>);
  },

  async deleteIntegration(integrationId: string): Promise<boolean> {
    await ensureSchema();
    const sql = getDb();
    const result = await sql`
      DELETE FROM ap_integrations WHERE integration_id = ${integrationId}
    `;
    return (result.count ?? 0) > 0;
  },

  async recordEventSeen(
    projectId: string,
    opts: { runId?: string; runStatus?: string },
  ): Promise<ProjectIntegration | null> {
    await ensureSchema();
    const sql = getDb();
    const now = new Date();

    // Find existing integration for this project.
    const existing = await this.getIntegrationByProjectId(projectId);

    if (!existing) {
      // Auto-create a lightweight integration.
      const integrationId = generateIntegrationId();
      const rows = await sql`
        INSERT INTO ap_integrations (
          integration_id, project_id, project_name, status, mode,
          last_event_at, last_run_id, last_run_status, run_count,
          created_at, updated_at
        ) VALUES (
          ${integrationId},
          ${projectId},
          ${projectId},
          'receiving_events',
          'trace_sdk',
          ${now},
          ${opts.runId ?? null},
          ${opts.runStatus ?? null},
          ${opts.runId ? 1 : 0},
          ${now},
          ${now}
        )
        RETURNING *
      `;
      return rowToIntegration(rows[0] as Record<string, unknown>);
    }

    // Update existing: increment runCount only for a new run_id.
    const isNewRun = opts.runId != null && opts.runId !== existing.lastRunId;
    const newRunCount = isNewRun ? existing.runCount + 1 : existing.runCount;

    const rows = await sql`
      UPDATE ap_integrations SET
        status          = 'receiving_events',
        last_event_at   = ${now},
        last_run_id     = COALESCE(${opts.runId ?? null}, last_run_id),
        last_run_status = COALESCE(${opts.runStatus ?? null}, last_run_status),
        run_count       = ${newRunCount},
        updated_at      = ${now}
      WHERE integration_id = ${existing.integrationId}
      RETURNING *
    `;
    if (rows.length === 0) return null;
    return rowToIntegration(rows[0] as Record<string, unknown>);
  },

  async generateIngestKey(integrationId: string): Promise<{ integration: ProjectIntegration; rawKey: string } | null> {
    await ensureSchema();
    const sql = getDb();
    const rawKey = generateRawIngestKey();
    const hash = hashIngestKey(rawKey);
    const preview = previewIngestKey(rawKey);
    const now = new Date();

    const rows = await sql`
      UPDATE ap_integrations SET
        ingest_key_hash    = ${hash},
        ingest_key_preview = ${preview},
        updated_at         = ${now}
      WHERE integration_id = ${integrationId}
      RETURNING *
    `;
    if (rows.length === 0) return null;
    return { integration: rowToIntegration(rows[0] as Record<string, unknown>), rawKey };
  },

  async revokeIngestKey(integrationId: string): Promise<ProjectIntegration | null> {
    await ensureSchema();
    const sql = getDb();
    const now = new Date();

    const rows = await sql`
      UPDATE ap_integrations SET
        ingest_key_hash    = NULL,
        ingest_key_preview = NULL,
        updated_at         = ${now}
      WHERE integration_id = ${integrationId}
      RETURNING *
    `;
    if (rows.length === 0) return null;
    return rowToIntegration(rows[0] as Record<string, unknown>);
  },

  async findByIngestKeyHash(hash: string): Promise<ProjectIntegration | null> {
    await ensureSchema();
    const sql = getDb();
    const rows = await sql`
      SELECT * FROM ap_integrations WHERE ingest_key_hash = ${hash} LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rowToIntegration(rows[0] as Record<string, unknown>);
  },
};
