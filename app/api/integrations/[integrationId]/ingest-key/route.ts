/**
 * POST   /api/integrations/[integrationId]/ingest-key  — generate or rotate a scoped ingest key
 * DELETE /api/integrations/[integrationId]/ingest-key  — revoke a scoped ingest key
 *
 * Protected by REEPROV_ACCESS_KEY (dashboard key), not the ingest key.
 *
 * The raw key is returned exactly once, in the POST response body. Only its
 * SHA-256 hash and a short non-secret preview are ever persisted. Generating
 * a new key immediately invalidates any previous scoped key for this
 * integration (this endpoint doubles as rotation).
 *
 * Revoking a scoped key does not disable ingestion for the project — the
 * shared deployment-wide REEPROV_INGEST_KEY, if configured, still works.
 */

import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { authorizeRequest, AccessControlError } from "@/lib/auth/accessControl";
import { getIntegrationStore } from "@/lib/db/getStores";

type RouteContext = { params: Promise<{ integrationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });

    const { integrationId } = await context.params;
    const result = await getIntegrationStore().generateIngestKey(integrationId);
    if (!result) {
      return NextResponse.json(
        { error: "not_found", message: "Integration not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      integration: result.integration,
      rawKey: result.rawKey,
      warning: "This key is shown only once. Store it now — Reeprov never displays the full value again.",
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });

    const { integrationId } = await context.params;
    const updated = await getIntegrationStore().revokeIngestKey(integrationId);
    if (!updated) {
      return NextResponse.json(
        { error: "not_found", message: "Integration not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ integration: updated });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
