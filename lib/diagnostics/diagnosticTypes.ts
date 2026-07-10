/**
 * Ingest diagnostics types.
 *
 * A persisted, redacted record of an ingestion failure — auth rejections,
 * schema validation failures, unknown event types, missing required fields,
 * malformed metadata, run-not-found errors. Diagnostics exist so integration
 * setup problems are visible in the dashboard instead of only in the HTTP
 * response returned to the sending client.
 *
 * Never store: ingest keys, Authorization headers, raw prompts, raw model
 * outputs, full payloads, secrets, or unnecessary personal data. Only
 * redacted, human-safe summaries.
 */

export type IngestDiagnosticCategory =
  | "missing_auth_header"
  | "invalid_ingest_key"
  | "unknown_event_type"
  | "missing_run_id"
  | "missing_project_id"
  | "schema_validation_failed"
  | "malformed_metadata"
  | "timestamp_parse_error"
  | "run_not_found"
  | "persistence_unavailable"
  | "other";

export interface IngestDiagnostic {
  diagnosticId: string;
  integrationId?: string;
  projectId?: string;
  runId?: string;
  eventType?: string;
  category: IngestDiagnosticCategory;
  errorCode: string;
  message: string;
  schemaPath?: string;
  createdAt: string;
}

export interface RecordDiagnosticInput {
  integrationId?: string;
  projectId?: string;
  runId?: string;
  eventType?: string;
  category: IngestDiagnosticCategory;
  errorCode: string;
  message: string;
  schemaPath?: string;
}

export interface DiagnosticStore {
  recordDiagnostic(input: RecordDiagnosticInput): Promise<IngestDiagnostic>;
  listDiagnostics(filters?: {
    projectId?: string;
    integrationId?: string;
    limit?: number;
  }): Promise<IngestDiagnostic[]>;
}

/** Maximum diagnostics retained per project/integration. Older entries are pruned on write. */
export const MAX_DIAGNOSTICS_PER_PROJECT = 50;

/** Diagnostics older than this are pruned on write (best-effort). */
export const DIAGNOSTIC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
