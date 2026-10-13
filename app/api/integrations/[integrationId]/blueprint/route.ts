/**
 * GET /api/integrations/[integrationId]/blueprint
 *
 * Returns an aggregate IntegrationWorkflowBlueprint built from a bounded
 * window of the integration's most recent runs, plus a registered
 * WorkflowSpec when one exists (registry first, then built-in example specs).
 *
 * Auth: x-agentpulse-key (AGENTPULSE_ACCESS_KEY). Fails closed — unauthorized
 * requests never reach the run store. Diagnostics are already redacted by
 * DiagnosticStore; no raw payloads or secrets are ever included here.
 */

import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { authorizeRequest, AccessControlError } from "@/lib/auth/accessControl";
import { getDiagnosticStore, getIntegrationStore, getRunStore, getWorkflowStore } from "@/lib/db/getStores";
import { getBuiltInWorkflowSpec } from "@/lib/workflows/builtInWorkflowSpecs";
import { buildIntegrationBlueprint, DEFAULT_BLUEPRINT_RUN_WINDOW } from "@/lib/integrations/buildIntegrationBlueprint";
import type { SavedRun } from "@/lib/runs/runTypes";
import type { WorkflowSpec } from "@/lib/proof-layer/schemas";

type RouteContext = { params: Promise<{ integrationId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });

    const { integrationId } = await context.params;
    const integration = await getIntegrationStore().getIntegration(integrationId);
    if (!integration) {
      return NextResponse.json(
        { error: "not_found", message: "Integration not found." },
        { status: 404 },
      );
    }

    const runSummaries = await getRunStore().listRuns({
      projectId: integration.projectId,
      limit: DEFAULT_BLUEPRINT_RUN_WINDOW,
    });

    const loadedRuns = await Promise.all(runSummaries.map((s) => getRunStore().getRun(s.run_id)));
    const runs: SavedRun[] = loadedRuns.filter((r): r is SavedRun => r !== null);

    const candidateWorkflowId = integration.defaultWorkflowId ?? runSummaries[0]?.workflow_id;

    let workflowSpec: WorkflowSpec | undefined;
    if (candidateWorkflowId) {
      let registrySpec = null;
      try {
        registrySpec = await getWorkflowStore().getWorkflowByWorkflowId(candidateWorkflowId);
      } catch {
        // Registry unavailable — fall through to the built-in example spec, if any.
      }
      workflowSpec = registrySpec?.spec ?? getBuiltInWorkflowSpec(integration.projectId, candidateWorkflowId);
    }

    let diagnostics: Array<{ category: string; createdAt: string }> | undefined;
    try {
      const recorded = await getDiagnosticStore().listDiagnostics({
        projectId: integration.projectId,
        limit: 50,
      });
      diagnostics = recorded.map((d) => ({ category: d.category, createdAt: d.createdAt }));
    } catch {
      diagnostics = undefined;
    }

    const blueprint = buildIntegrationBlueprint({
      integrationId: integration.integrationId,
      projectId: integration.projectId,
      runs,
      workflowSpec,
      lastEventAt: integration.lastEventAt,
      diagnostics,
    });

    return NextResponse.json({ blueprint });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
