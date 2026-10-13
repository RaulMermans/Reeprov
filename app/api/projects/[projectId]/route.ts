import { NextRequest, NextResponse } from "next/server";
import { ProjectStore } from "@/lib/projects/projectStore";
import { ProjectDeletionManager } from "@/lib/projects/projectDelete";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { projectId } = await params;
    await authorizeRequest(request, { capability: "DASHBOARD_READ", projectId });

    const project = await ProjectStore.getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: `Project '${projectId}' not found.` }, { status: 404 });
    }

    return NextResponse.json({ project });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { projectId } = await params;
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE", projectId });

    const body = await request.json();
    const updated = await ProjectStore.updateProject(projectId, body);

    if (!updated) {
      return NextResponse.json({ error: `Project '${projectId}' not found.` }, { status: 404 });
    }

    return NextResponse.json({ project: updated });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { projectId } = await params;
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE", projectId });

    const { searchParams } = new URL(request.url);
    const confirmation = searchParams.get("confirmation") || projectId;

    const result = await ProjectDeletionManager.confirmDelete(projectId, confirmation);
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
