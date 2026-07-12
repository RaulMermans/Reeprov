/**
 * GET /api/dashboard/pulse
 *
 * Protected, bounded command-center data. The route returns only aggregate
 * display evidence; trace payloads, prompts, model outputs, ingest keys, and
 * auth headers never leave the server.
 */

import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { getDiagnosticStore, getIntegrationStore, getRunStore, getWorkflowStore } from "@/lib/db/getStores";
import {
  buildDashboardPulse,
  DASHBOARD_DIAGNOSTIC_WINDOW,
  DASHBOARD_RUN_WINDOW_PER_INTEGRATION,
} from "@/lib/dashboard/buildDashboardPulse";
import { getBuiltInWorkflowSpec } from "@/lib/workflows/builtInWorkflowSpecs";
import type { SavedRun } from "@/lib/runs/runTypes";
import type { WorkflowSpec } from "@/lib/proof-layer/schemas";

const DASHBOARD_INTEGRATION_LIMIT = 200;

export async function GET(request: Request) {
  try {
    requireAccessKey(request);

    const integrations = await getIntegrationStore().listIntegrations({ limit: DASHBOARD_INTEGRATION_LIMIT });
    const diagnosticsPromise = getDiagnosticStore()
      .listDiagnostics({ limit: DASHBOARD_DIAGNOSTIC_WINDOW })
      .catch(() => []);

    const inputs = await Promise.all(integrations.map(async (integration) => {
      const summaries = await getRunStore().listRuns({
        projectId: integration.projectId,
        limit: DASHBOARD_RUN_WINDOW_PER_INTEGRATION,
      }).catch(() => []);
      const savedRuns = await Promise.all(summaries.map((summary) => getRunStore().getRun(summary.run_id).catch(() => null)));
      const runs: SavedRun[] = savedRuns.filter((run): run is SavedRun => run !== null);
      const workflowId = integration.defaultWorkflowId ?? summaries[0]?.workflow_id;

      let workflowSpec: WorkflowSpec | undefined;
      if (workflowId) {
        const registered = await getWorkflowStore().getWorkflowByWorkflowId(workflowId).catch(() => null);
        workflowSpec = registered?.spec ?? getBuiltInWorkflowSpec(integration.projectId, workflowId);
      }

      return { integration, runs, workflowSpec };
    }));

    const diagnostics = await diagnosticsPromise;
    return NextResponse.json({ pulse: buildDashboardPulse({ integrations: inputs, diagnostics }) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
