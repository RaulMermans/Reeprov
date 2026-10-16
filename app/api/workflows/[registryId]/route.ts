/**
 * GET    /api/workflows/[registryId]  — Get a saved workflow spec
 * PATCH  /api/workflows/[registryId]  — Update status
 * DELETE /api/workflows/[registryId]  — Delete workflow registry entry
 *
 * All protected by REEPROV_ACCESS_KEY (x-reeprov-key header).
 */

import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { authorizeRequest, AccessControlError } from "@/lib/auth/accessControl";
import { getWorkflowStore } from "@/lib/db/getStores";
import type { WorkflowRegistryStatus } from "@/lib/workflows/workflowTypes";

const VALID_STATUSES: WorkflowRegistryStatus[] = ["draft", "active", "needs_review", "archived"];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ registryId: string }> },
) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const { registryId } = await params;
    const workflow = await getWorkflowStore().getWorkflow(registryId);
    if (!workflow) {
      return NextResponse.json({ message: `Workflow "${registryId}" not found.` }, { status: 404 });
    }
    return NextResponse.json(workflow);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ registryId: string }> },
) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });
    const { registryId } = await params;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw invalidRequest("Body must be valid JSON.");
    }

    const status = body["status"] as string | undefined;
    if (!status || !VALID_STATUSES.includes(status as WorkflowRegistryStatus)) {
      throw invalidRequest(`"status" must be one of: ${VALID_STATUSES.join(", ")}.`);
    }

    const updated = await getWorkflowStore().updateWorkflowStatus(registryId, status as WorkflowRegistryStatus);
    if (!updated) {
      return NextResponse.json({ message: `Workflow "${registryId}" not found.` }, { status: 404 });
    }

    return NextResponse.json({ ok: true, workflow: updated });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ registryId: string }> },
) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });
    const { registryId } = await params;
    const deleted = await getWorkflowStore().deleteWorkflow(registryId);
    if (!deleted) {
      return NextResponse.json({ message: `Workflow "${registryId}" not found or could not be deleted.` }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted: registryId });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
