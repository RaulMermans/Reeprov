/**
 * Postgres-backed ingest diagnostics store.
 *
 * Implements the same DiagnosticStore interface as fileDiagnosticStore.
 * Used in production when DATABASE_URL is set.
 *
 * Retention: on every insert, rows older than DIAGNOSTIC_RETENTION_MS for the
 * same projectId are deleted, and only the MAX_DIAGNOSTICS_PER_PROJECT most
 * recent rows per projectId are kept. Cleanup is best-effort and non-fatal —
 * a cleanup failure never blocks the insert from succeeding.
 */

import { getDb } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/migrate";
import { generateDiagnosticId } from "./diagnosticId";
import { redactDiagnosticMessage } from "./redact";
import {
  DIAGNOSTIC_RETENTION_MS,
  MAX_DIAGNOSTICS_PER_PROJECT,
  type DiagnosticStore,
  type IngestDiagnostic,
  type IngestDiagnosticCategory,
  type RecordDiagnosticInput,
} from "./diagnosticTypes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToDiagnostic(row: Record<string, any>): IngestDiagnostic {
  return {
    diagnosticId: row["diagnostic_id"] as string,
    integrationId: (row["integration_id"] as string | null) ?? undefined,
    projectId: (row["project_id"] as string | null) ?? undefined,
    runId: (row["run_id"] as string | null) ?? undefined,
    eventType: (row["event_type"] as string | null) ?? undefined,
    category: row["category"] as IngestDiagnosticCategory,
    errorCode: row["error_code"] as string,
    message: row["message"] as string,
    schemaPath: (row["schema_path"] as string | null) ?? undefined,
    createdAt: (row["created_at"] as Date).toISOString(),
  };
}

export const pgDiagnosticStore: DiagnosticStore = {
  async recordDiagnostic(input: RecordDiagnosticInput): Promise<IngestDiagnostic> {
    await ensureSchema();
    const sql = getDb();
    const diagnosticId = generateDiagnosticId();
    const message = redactDiagnosticMessage(input.message);

    const rows = await sql`
      INSERT INTO ap_ingest_diagnostics (
        diagnostic_id, integration_id, project_id, run_id, event_type,
        category, error_code, message, schema_path, created_at
      ) VALUES (
        ${diagnosticId},
        ${input.integrationId ?? null},
        ${input.projectId ?? null},
        ${input.runId ?? null},
        ${input.eventType ?? null},
        ${input.category},
        ${input.errorCode},
        ${message},
        ${input.schemaPath ?? null},
        NOW()
      )
      RETURNING *
    `;

    // Best-effort retention cleanup. Never blocks the write above.
    if (input.projectId) {
      try {
        const cutoff = new Date(Date.now() - DIAGNOSTIC_RETENTION_MS);
        await sql`
          DELETE FROM ap_ingest_diagnostics
          WHERE project_id = ${input.projectId} AND created_at < ${cutoff}
        `;
        await sql`
          DELETE FROM ap_ingest_diagnostics
          WHERE diagnostic_id IN (
            SELECT diagnostic_id FROM ap_ingest_diagnostics
            WHERE project_id = ${input.projectId}
            ORDER BY created_at DESC
            OFFSET ${MAX_DIAGNOSTICS_PER_PROJECT}
          )
        `;
      } catch (err) {
        console.error("[diagnostics] retention cleanup failed:", err);
      }
    }

    return rowToDiagnostic(rows[0] as Record<string, unknown>);
  },

  async listDiagnostics(filters): Promise<IngestDiagnostic[]> {
    await ensureSchema();
    const sql = getDb();
    const limit = filters?.limit && filters.limit > 0 ? filters.limit : 20;

    // Query a broader window ordered by recency, then apply filters in JS
    // (consistent with pgIntegrationStore.listIntegrations), so combined
    // projectId + integrationId filters behave as AND, not either/or.
    const rows = await sql`
      SELECT * FROM ap_ingest_diagnostics
      ORDER BY created_at DESC
      LIMIT ${Math.max(limit * 5, 200)}
    `;

    let items = rows.map((r) => rowToDiagnostic(r as Record<string, unknown>));

    if (filters?.projectId) {
      items = items.filter((d) => d.projectId === filters.projectId);
    }
    if (filters?.integrationId) {
      items = items.filter((d) => d.integrationId === filters.integrationId);
    }

    return items.slice(0, limit);
  },
};
