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
import { fileIntegrationStore } from "@/lib/integrations/integrationStore";
import { pgIntegrationStore } from "@/lib/integrations/pgIntegrationStore";
import { fileRunStore } from "@/lib/runs/runStore";
import { pgRunStore } from "@/lib/runs/pgRunStore";
import { fileReportStore } from "@/lib/reports/reportStore";
import { pgReportStore } from "@/lib/reports/pgReportStore";
import { fileWorkflowStore } from "@/lib/workflows/workflowStore";
import { pgWorkflowStore } from "@/lib/workflows/pgWorkflowStore";
import type { IntegrationStore } from "@/lib/integrations/integrationTypes";
import type { RunStore } from "@/lib/runs/runTypes";
import type { ReportStore } from "@/lib/reports/reportTypes";
import type { WorkflowStore } from "@/lib/workflows/workflowTypes";

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

export function getIntegrationStore(): IntegrationStore {
  if (hasDatabaseUrl()) return pgIntegrationStore;
  if (isProduction()) assertDatabaseConfigured();
  return fileIntegrationStore;
}

export function getRunStore(): RunStore {
  if (hasDatabaseUrl()) return pgRunStore;
  if (isProduction()) assertDatabaseConfigured();
  return fileRunStore;
}

export function getReportStore(): ReportStore {
  if (hasDatabaseUrl()) return pgReportStore;
  if (isProduction()) assertDatabaseConfigured();
  return fileReportStore;
}

export function getWorkflowStore(): WorkflowStore {
  if (hasDatabaseUrl()) return pgWorkflowStore;
  if (isProduction()) assertDatabaseConfigured();
  return fileWorkflowStore;
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
