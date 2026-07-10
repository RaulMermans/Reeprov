/**
 * GET  /api/integrations  — list project integrations
 * POST /api/integrations  — create a new integration
 *
 * Protected by AGENTPULSE_ACCESS_KEY (x-agentpulse-key header).
 *
 * GET query params:
 *   ?projectId=...    filter by projectId
 *   ?status=...       filter by status
 *   ?mode=...         filter by mode
 *   ?language=...     filter by language
 *   ?limit=N          max results (default 50)
 *
 * POST body:
 *   { projectId, projectName, description?, defaultWorkflowId?,
 *     repositoryUrl?, language?, framework?, mode? }
 */

import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { getIntegrationStore, getRunStore, getWorkflowStore } from "@/lib/db/getStores";
import type {
  IntegrationLanguage,
  IntegrationMode,
  IntegrationStatus,
} from "@/lib/integrations/integrationTypes";

export async function GET(request: Request) {
  try {
    requireAccessKey(request);

    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const status = (url.searchParams.get("status") ?? undefined) as IntegrationStatus | undefined;
    const mode = (url.searchParams.get("mode") ?? undefined) as IntegrationMode | undefined;
    const language = (url.searchParams.get("language") ?? undefined) as IntegrationLanguage | undefined;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.max(1, Math.min(200, parseInt(limitParam, 10))) : 50;

    const integrations = await getIntegrationStore().listIntegrations({
      projectId,
      status,
      mode,
      language,
      limit,
    });

    const enrichedIntegrations = await Promise.all(integrations.map(async (integration) => {
      try {
        const [workflows, runs] = await Promise.all([
          getWorkflowStore().listWorkflows({ projectId: integration.projectId, limit: 100 }),
          getRunStore().listRuns({ projectId: integration.projectId, limit: 1 }),
        ]);
        const hasMatchingSpec = integration.defaultWorkflowId
          ? workflows.some((workflow) => workflow.workflowId === integration.defaultWorkflowId)
          : workflows.length > 0;
        return {
          ...integration,
          readiness: {
            lastRunAt: runs[0]?.started_at ?? null,
            workflowCount: workflows.length,
            workflowMode: hasMatchingSpec ? "registered_spec" : "inferred",
          },
        };
      } catch {
        return {
          ...integration,
          readiness: {
            lastRunAt: null,
            workflowCount: 0,
            workflowMode: "inferred",
          },
        };
      }
    }));

    return NextResponse.json({ integrations: enrichedIntegrations, count: integrations.length });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireAccessKey(request);

    const body = await request.json() as Record<string, unknown>;

    const projectId = body["projectId"];
    const projectName = body["projectName"];

    if (!projectId || typeof projectId !== "string") {
      throw invalidRequest("projectId is required.");
    }
    if (!projectName || typeof projectName !== "string") {
      throw invalidRequest("projectName is required.");
    }

    const description = typeof body["description"] === "string" ? body["description"] : undefined;
    const defaultWorkflowId = typeof body["defaultWorkflowId"] === "string" ? body["defaultWorkflowId"] : undefined;
    const repositoryUrl = typeof body["repositoryUrl"] === "string" ? body["repositoryUrl"] : undefined;
    const language = typeof body["language"] === "string" ? body["language"] as IntegrationLanguage : undefined;
    const framework = typeof body["framework"] === "string" ? body["framework"] : undefined;
    const mode = typeof body["mode"] === "string" ? body["mode"] as IntegrationMode : undefined;

    const integration = await getIntegrationStore().createIntegration({
      projectId,
      projectName,
      description,
      defaultWorkflowId,
      repositoryUrl,
      language,
      framework,
      mode,
    });

    return NextResponse.json(integration, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
