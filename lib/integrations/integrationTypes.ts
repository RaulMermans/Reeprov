/**
 * Project Integration Registry types.
 *
 * A ProjectIntegration tracks a connected external AI project — its identity,
 * configuration, live-pulse status, and setup metadata.
 *
 * Mode:
 *   static_only         — project was scanned but not trace-instrumented
 *   trace_sdk           — project emits trace events via the AgentPulse SDK/client
 *   manual_trace_import — trace data was manually imported
 *   gateway_future      — planned; not yet implemented
 *
 * Status lifecycle:
 *   configured                → project registered, not yet sending events
 *   waiting_for_first_event   → configured, watching for first trace event
 *   receiving_events          → trace events have arrived for this project
 *   stale                     → lastEventAt is older than STALE_THRESHOLD_MS
 *   error                     → an error was recorded for this integration
 */

// ── Enums ─────────────────────────────────────────────────────────────────────

export type IntegrationMode =
  | "static_only"
  | "trace_sdk"
  | "manual_trace_import"
  | "gateway_future";

export type IntegrationStatus =
  | "configured"
  | "waiting_for_first_event"
  | "receiving_events"
  | "stale"
  | "error";

export type IntegrationLanguage = "typescript" | "python" | "other";

// ── ProjectIntegration — the unit of persistence ──────────────────────────────

export interface ProjectIntegration {
  integrationId: string;
  projectId: string;
  projectName: string;
  description?: string;
  defaultWorkflowId?: string;
  repositoryUrl?: string;
  language?: IntegrationLanguage;
  framework?: string;
  status: IntegrationStatus;
  mode: IntegrationMode;
  /** SHA-256 hash of the project-specific ingest key, if generated. Never the raw key. */
  ingestKeyHash?: string;
  /** Short non-secret preview: "ap_live_...9f2a". Never the full key. */
  ingestKeyPreview?: string;
  lastEventAt?: string;
  lastRunId?: string;
  lastRunStatus?: string;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

// ── Store input ───────────────────────────────────────────────────────────────

export interface CreateIntegrationInput {
  projectId: string;
  projectName: string;
  description?: string;
  defaultWorkflowId?: string;
  repositoryUrl?: string;
  language?: IntegrationLanguage;
  framework?: string;
  mode?: IntegrationMode;
}

export interface UpdateIntegrationInput {
  projectName?: string;
  description?: string;
  defaultWorkflowId?: string;
  repositoryUrl?: string;
  language?: IntegrationLanguage;
  framework?: string;
  mode?: IntegrationMode;
  status?: IntegrationStatus;
}

// ── Store interface ───────────────────────────────────────────────────────────

export interface IntegrationStore {
  createIntegration(input: CreateIntegrationInput): Promise<ProjectIntegration>;
  listIntegrations(filters?: {
    status?: IntegrationStatus;
    mode?: IntegrationMode;
    language?: IntegrationLanguage;
    projectId?: string;
    limit?: number;
  }): Promise<ProjectIntegration[]>;
  getIntegration(integrationId: string): Promise<ProjectIntegration | null>;
  getIntegrationByProjectId(projectId: string): Promise<ProjectIntegration | null>;
  updateIntegration(integrationId: string, patch: UpdateIntegrationInput): Promise<ProjectIntegration | null>;
  deleteIntegration(integrationId: string): Promise<boolean>;
  recordEventSeen(
    projectId: string,
    opts: { runId?: string; runStatus?: string }
  ): Promise<ProjectIntegration | null>;
}

// ── Stale threshold ───────────────────────────────────────────────────────────

export const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Compute the effective display status: marks an entry "stale" at read-time
 * if lastEventAt is older than STALE_THRESHOLD_MS and status is "receiving_events".
 */
export function computeDisplayStatus(integration: ProjectIntegration): IntegrationStatus {
  if (
    integration.status === "receiving_events" &&
    integration.lastEventAt
  ) {
    const age = Date.now() - new Date(integration.lastEventAt).getTime();
    if (age > STALE_THRESHOLD_MS) return "stale";
  }
  return integration.status;
}
