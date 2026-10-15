/**
 * Store factory — returns the correct store implementation based on environment.
 *
 * Selection rules:
 *   DATABASE_URL set:                     → Postgres stores (production and dev-with-db)
 *   DATABASE_URL not set + development:   → File-backed stores (local dev, tests)
 *   DATABASE_URL not set + production:    → Throws a clear error (misconfiguration)
 *
 * All API routes should call these getters rather than importing file stores
 * or pg stores directly.
 */

import { hasDatabaseUrl } from "./client";
import { ensureSchema } from "./migrate";
import { fileIntegrationStore } from "@/lib/integrations/integrationStore";
import { pgIntegrationStore } from "@/lib/integrations/pgIntegrationStore";
import { fileRunStore } from "@/lib/runs/runStore";
import { pgRunStore } from "@/lib/runs/pgRunStore";
import { fileReportStore } from "@/lib/reports/reportStore";
import { pgReportStore } from "@/lib/reports/pgReportStore";
import { fileWorkflowStore } from "@/lib/workflows/workflowStore";
import { pgWorkflowStore } from "@/lib/workflows/pgWorkflowStore";
import { fileDiagnosticStore } from "@/lib/diagnostics/fileDiagnosticStore";
import { pgDiagnosticStore } from "@/lib/diagnostics/pgDiagnosticStore";
import { requireIngestKey, IngestKeyError } from "@/lib/auth/requireIngestKey";
import { authorizeRequest, AccessControlError, extractProvidedKey } from "@/lib/auth/accessControl";
import { ApiError } from "@/lib/api/errors";
import { hashIngestKey } from "@/lib/integrations/ingestKey";
import type { IntegrationStore, ProjectIntegration } from "@/lib/integrations/integrationTypes";
import type { RunStore } from "@/lib/runs/runTypes";
import type { ReportStore } from "@/lib/reports/reportTypes";
import type { WorkflowStore } from "@/lib/workflows/workflowTypes";
import type { DiagnosticStore, RecordDiagnosticInput } from "@/lib/diagnostics/diagnosticTypes";

let loggedPostgresStore = false;
const postgresStoreWrappers = new WeakMap<object, object>();

function isProduction(): boolean {
  return process.env["NODE_ENV"] === "production";
}

function assertDatabaseConfigured(): void {
  throw new Error(
    "[AgentPulse] DATABASE_URL is required in production. " +
      "Set DATABASE_URL to a Postgres connection string (Neon, Vercel Postgres, or local). " +
      "AGENTPULSE_STORE_DIR and file-backed storage are only supported in development.",
  );
}

function usePostgresStore<T extends object>(store: T): T {
  if (!loggedPostgresStore) {
    console.info("AgentPulse using Postgres store");
    loggedPostgresStore = true;
  }

  const cached = postgresStoreWrappers.get(store);
  if (cached) return cached as T;

  const wrapped = new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;

      const method = value as (...args: unknown[]) => unknown;
      return async (...args: unknown[]) => {
        await ensureSchema();
        return method.apply(target, args);
      };
    },
  });

  postgresStoreWrappers.set(store, wrapped);
  return wrapped;
}

export function getIntegrationStore(): IntegrationStore {
  if (hasDatabaseUrl()) return usePostgresStore(pgIntegrationStore);
  if (isProduction()) assertDatabaseConfigured();
  return fileIntegrationStore;
}

export function getRunStore(): RunStore {
  if (hasDatabaseUrl()) return usePostgresStore(pgRunStore);
  if (isProduction()) assertDatabaseConfigured();
  return fileRunStore;
}

export function getReportStore(): ReportStore {
  if (hasDatabaseUrl()) return usePostgresStore(pgReportStore);
  if (isProduction()) assertDatabaseConfigured();
  return fileReportStore;
}

export function getWorkflowStore(): WorkflowStore {
  if (hasDatabaseUrl()) return usePostgresStore(pgWorkflowStore);
  if (isProduction()) assertDatabaseConfigured();
  return fileWorkflowStore;
}

export function getDiagnosticStore(): DiagnosticStore {
  if (hasDatabaseUrl()) return usePostgresStore(pgDiagnosticStore);
  if (isProduction()) assertDatabaseConfigured();
  return fileDiagnosticStore;
}

/**
 * Records a redacted ingest diagnostic for later display in the integration
 * setup page. Non-fatal: errors are logged but never propagate to callers,
 * so a diagnostics-store failure can never break ingestion itself.
 */
export async function recordIngestDiagnostic(input: RecordDiagnosticInput): Promise<void> {
  try {
    await getDiagnosticStore().recordDiagnostic(input);
  } catch (err) {
    console.error("[diagnostics] recordIngestDiagnostic error:", err);
  }
}

export interface IngestAuthResult {
  /** Set only when authentication succeeded via a per-integration scoped key. */
  integration?: ProjectIntegration;
  projectId?: string;
  integrationId?: string;
}

/**
 * Route-friendly adapter for ingestion authentication.
 * Delegates to canonical authorizeRequest(request, { capability: "INGEST", projectId }).
 * Records a redacted diagnostic on failure — never the provided key value.
 */
export async function requireIngestAuth(
  request: Request,
  routeLabel: string,
  projectId?: string
): Promise<IngestAuthResult> {
  try {
    const auth = await authorizeRequest(request, { capability: "INGEST", projectId });
    return {
      integration: auth.integration,
      projectId: auth.projectId,
      integrationId: auth.integrationId,
    };
  } catch (err) {
    const provided = extractProvidedKey(request);
    const status = err instanceof AccessControlError ? err.status : 401;
    const category = !provided
      ? "missing_auth_header"
      : err instanceof AccessControlError && err.code === "forbidden_project_scope"
        ? "invalid_ingest_key"
        : "invalid_ingest_key";

    await recordIngestDiagnostic({
      category,
      errorCode: String(status),
      message: `Ingest authentication failed on ${routeLabel}${err instanceof Error ? `: ${err.message}` : ""}.`,
      projectId,
    });

    if (err instanceof AccessControlError) {
      if (err.status === 403) {
        throw new ApiError(403, err.code, err.message, true);
      }
      throw new IngestKeyError(err.message);
    }
    throw new IngestKeyError();
  }
}

/**
 * Called from ingestion routes to keep integration status up-to-date.
 * Non-fatal: errors are logged but never propagate to callers.
 */
export async function touchIntegrationForProject(
  projectId: string,
  opts: { runId?: string; runStatus?: string } = {},
): Promise<void> {
  try {
    await getIntegrationStore().recordEventSeen(projectId, opts);
  } catch (err) {
    console.error("[integrations] touchIntegrationForProject error:", err);
  }
}
