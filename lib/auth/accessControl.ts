/**
 * Centralized, Mode-Aware Authorization Layer for Reeprov.
 *
 * Implements authorizeRequest(request, { capability, projectId? })
 *
 * Capabilities:
 *   - DASHBOARD_READ: Read projects, runs, comparisons, evals, reports, baselines.
 *   - DASHBOARD_WRITE: Mutate projects, evals, experiments, baselines, forks.
 *   - INGEST: Emit trace events, boundaries, start/complete/fail runs.
 *             Requires project-scoped ingest key or deployment ingest key.
 *             Ingest credentials NEVER grant dashboard read/write access.
 *   - ADMIN: Migrations, demo reset, storage administration.
 *   - HEALTH_PUBLIC: Liveness/readiness probes.
 */

import { timingSafeEqual } from "node:crypto";
import { getOperatingMode, isLoopbackRequest, type OperatingMode } from "./operatingMode";
import { extractSessionToken, verifySessionToken } from "./session";
import { hashIngestKey } from "@/lib/integrations/ingestKey";
import { getReeprovEnv } from "@/lib/config/env";

export type AuthCapability =
  | "DASHBOARD_READ"
  | "DASHBOARD_WRITE"
  | "INGEST"
  | "ADMIN"
  | "HEALTH_PUBLIC";

export interface AuthorizeOptions {
  capability: AuthCapability;
  projectId?: string;
}

export interface AuthorizeResult {
  authorized: boolean;
  mode: OperatingMode;
  capability: AuthCapability;
  projectId?: string;
  integrationId?: string;
  integration?: import("@/lib/integrations/integrationTypes").ProjectIntegration;
  reason?: string;
}

export class AccessControlError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AccessControlError";
    this.status = status;
    this.code = code;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) return false;
  return timingSafeEqual(leftBuf, rightBuf);
}

/**
 * Extracts any provided access key from headers (x-reeprov-key, legacy x-agentpulse-key, or Authorization Bearer).
 */
export function extractProvidedKey(request: Request): string | null {
  const canonicalHeader = request.headers.get("x-reeprov-key");
  if (canonicalHeader) return canonicalHeader.trim();

  const legacyHeader = request.headers.get("x-agentpulse-key");
  if (legacyHeader) return legacyHeader.trim();

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  return null;
}

/**
 * Authorizes an incoming request based on operating mode, target capability, and project scope.
 * Throws AccessControlError (401 or 403) on failure.
 */
export async function authorizeRequest(
  request: Request,
  options: AuthorizeOptions
): Promise<AuthorizeResult> {
  const mode = getOperatingMode();
  const { capability, projectId } = options;

  // 1. Public endpoints (e.g. /api/health)
  if (capability === "HEALTH_PUBLIC") {
    return {
      authorized: true,
      mode,
      capability,
    };
  }

  // 2. INGEST Authority (Strictly isolated from dashboard credentials)
  if (capability === "INGEST") {
    const provided = extractProvidedKey(request);
    if (!provided) {
      throw new AccessControlError(
        401,
        "missing_ingest_key",
        "Missing ingest key. Provide 'x-reeprov-key' or 'Authorization: Bearer <key>'."
      );
    }

    // Ingest keys format check (ree_live_... / legacy ap_live_...) or deployment-wide key
    const deploymentIngestKey = getReeprovEnv("REEPROV_INGEST_KEY");
    if (deploymentIngestKey && constantTimeEqual(provided, deploymentIngestKey)) {
      return {
        authorized: true,
        mode,
        capability,
        projectId,
      };
    }

    // Scoped per-project ingest key lookup
    const keyHash = hashIngestKey(provided);
    const { getIntegrationStore } = await import("@/lib/db/getStores");
    const integration = await getIntegrationStore().findByIngestKeyHash(keyHash);

    if (integration) {
      if (projectId && integration.projectId !== projectId) {
        throw new AccessControlError(
          403,
          "forbidden_project_scope",
          `Scoped ingest key for project '${integration.projectId}' cannot operate on project '${projectId}'.`
        );
      }
      return {
        authorized: true,
        mode,
        capability,
        projectId: integration.projectId,
        integrationId: integration.integrationId,
        integration,
      };
    }

    // Dev fallback for PERSONAL_LOCAL mode if no ingest key configured
    const accessKey = getReeprovEnv("REEPROV_ACCESS_KEY");
    if (mode === "personal_local" && accessKey && constantTimeEqual(provided, accessKey)) {
      return {
        authorized: true,
        mode,
        capability,
        projectId,
      };
    }

    throw new AccessControlError(
      401,
      "invalid_ingest_key",
      "Invalid or revoked ingest key."
    );
  }

  // 3. DASHBOARD_READ, DASHBOARD_WRITE, ADMIN Authority
  // Notice: Ingest keys (ree_live_... or legacy ap_live_...) must NEVER be accepted for dashboard access.
  const providedKey = extractProvidedKey(request);
  if (providedKey?.startsWith("ree_live_") || providedKey?.startsWith("ap_live_")) {
    throw new AccessControlError(
      403,
      "ingest_key_disallowed",
      "Ingest keys cannot be used to access dashboard or management APIs."
    );
  }

  // Check Mode Policies:
  if (mode === "personal_local") {
    // Loopback privacy guarantee: local requests are automatically allowed
    const isLocal = isLoopbackRequest(request);
    if (!isLocal) {
      throw new AccessControlError(
        403,
        "loopback_required",
        "Loopback privacy guarantee: PERSONAL_LOCAL only accepts local loopback connections (127.0.0.1 or ::1). Set REEPROV_MODE=self_hosted to allow remote access."
      );
    }

    const accessKey = getReeprovEnv("REEPROV_ACCESS_KEY");
    if (accessKey) {
      // Check session cookie
      const sessionToken = extractSessionToken(request);
      const session = verifySessionToken(sessionToken);
      if (session) {
        return {
          authorized: true,
          mode,
          capability,
          projectId,
        };
      }

      // Check access key header
      if (providedKey && constantTimeEqual(providedKey, accessKey)) {
        return {
          authorized: true,
          mode,
          capability,
          projectId,
        };
      }

      throw new AccessControlError(
        401,
        "unauthorized",
        "Authentication required. Missing or invalid access key."
      );
    }

    // Local loopback is authorized by default if AGENTPULSE_ACCESS_KEY is not configured
    return {
      authorized: true,
      mode,
      capability,
      projectId,
    };
  }

  if (mode === "self_hosted") {
    // In self_hosted mode, authentication is mandatory.
    // Check 1: HttpOnly bounded session cookie
    const sessionToken = extractSessionToken(request);
    const session = verifySessionToken(sessionToken);
    if (session) {
      return {
        authorized: true,
        mode,
        capability,
        projectId,
      };
    }

    // Check 2: Direct access key in header
    const accessKey = getReeprovEnv("REEPROV_ACCESS_KEY");
    if (accessKey && providedKey && constantTimeEqual(providedKey, accessKey)) {
      return {
        authorized: true,
        mode,
        capability,
        projectId,
      };
    }

    throw new AccessControlError(
      401,
      "unauthorized_session",
      "Authentication required. Please unlock the instance with your access key."
    );
  }

  if (mode === "headless_ci") {
    // In headless_ci mode: loopback or explicit access key / CI token
    const isLocal = isLoopbackRequest(request);
    const accessKey = process.env.AGENTPULSE_ACCESS_KEY || process.env.AGENTPULSE_CI_TOKEN;

    if (isLocal) {
      return {
        authorized: true,
        mode,
        capability,
        projectId,
      };
    }

    if (accessKey && providedKey && constantTimeEqual(providedKey, accessKey)) {
      return {
        authorized: true,
        mode,
        capability,
        projectId,
      };
    }

    throw new AccessControlError(
      401,
      "unauthorized_ci",
      "Authentication required for remote HEADLESS_CI requests."
    );
  }

  return {
    authorized: true,
    mode,
    capability,
    projectId,
  };
}
