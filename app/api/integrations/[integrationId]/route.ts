/**
 * GET    /api/integrations/[integrationId]  — get integration details
 * PATCH  /api/integrations/[integrationId]  — update integration fields
 * DELETE /api/integrations/[integrationId]  — delete integration entry
 *
 * All routes protected by AGENTPULSE_ACCESS_KEY.
 * Deleting an integration does NOT delete associated runs/reports/workflows.
 */

import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { getDiagnosticStore, getIntegrationStore, getRunStore, getWorkflowStore } from "@/lib/db/getStores";
import type { IntegrationLanguage, IntegrationMode, IntegrationStatus } from "@/lib/integrations/integrationTypes";
import type { RunSummary } from "@/lib/runs/runTypes";

type RouteContext = { params: Promise<{ integrationId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    requireAccessKey(request);

    const { integrationId } = await context.params;
    const integration = await getIntegrationStore().getIntegration(integrationId);
    if (!integration) {
      return NextResponse.json(
        { error: "not_found", message: "Integration not found." },
        { status: 404 },
      );
    }

    // Include recent runs for this project.
    let recentRuns: RunSummary[] = [];
    try {
      recentRuns = await getRunStore().listRuns({
        projectId: integration.projectId,
        limit: 10,
      });
    } catch {
      // Non-fatal.
    }

    let workflows: Awaited<ReturnType<ReturnType<typeof getWorkflowStore>["listWorkflows"]>> = [];
    try {
      workflows = await getWorkflowStore().listWorkflows({
        projectId: integration.projectId,
        limit: 100,
      });
    } catch {
      // Readiness remains useful when the workflow registry is unavailable.
    }

    const registeredWorkflow = integration.defaultWorkflowId
      ? workflows.find((workflow) => workflow.workflowId === integration.defaultWorkflowId)
      : workflows[0];

    // Recent redacted ingest diagnostics for this integration/project.
    let recentIngestErrors: Array<{ at: string; message: string; category: string }> = [];
    let diagnosticsAvailable = true;
    try {
      const diagnostics = await getDiagnosticStore().listDiagnostics({
        projectId: integration.projectId,
        limit: 20,
      });
      recentIngestErrors = diagnostics.map((d) => ({
        at: d.createdAt,
        message: d.message,
        category: d.category,
      }));
    } catch {
      diagnosticsAvailable = false;
    }

    return NextResponse.json({
      integration,
      recentRuns,
      readiness: {
        lastRunAt: recentRuns[0]?.started_at ?? null,
        workflowCount: workflows.length,
        workflowMode: registeredWorkflow ? "registered_spec" : "inferred",
        registeredWorkflow: registeredWorkflow ?? null,
        recentIngestErrors,
        diagnosticsAvailable,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    requireAccessKey(request);

    const { integrationId } = await context.params;
    const body = await request.json() as Record<string, unknown>;

    const patch = {
      ...(typeof body["projectName"] === "string" ? { projectName: body["projectName"] } : {}),
      ...(typeof body["description"] === "string" ? { description: body["description"] } : {}),
      ...(typeof body["defaultWorkflowId"] === "string" ? { defaultWorkflowId: body["defaultWorkflowId"] } : {}),
      ...(typeof body["repositoryUrl"] === "string" ? { repositoryUrl: body["repositoryUrl"] } : {}),
      ...(typeof body["language"] === "string" ? { language: body["language"] as IntegrationLanguage } : {}),
      ...(typeof body["framework"] === "string" ? { framework: body["framework"] } : {}),
      ...(typeof body["mode"] === "string" ? { mode: body["mode"] as IntegrationMode } : {}),
      ...(typeof body["status"] === "string" ? { status: body["status"] as IntegrationStatus } : {}),
    };

    const updated = await getIntegrationStore().updateIntegration(integrationId, patch);
    if (!updated) {
      return NextResponse.json(
        { error: "not_found", message: "Integration not found." },
        { status: 404 },
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    requireAccessKey(request);

    const { integrationId } = await context.params;
    const deleted = await getIntegrationStore().deleteIntegration(integrationId);
    if (!deleted) {
      return NextResponse.json(
        { error: "not_found", message: "Integration not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
