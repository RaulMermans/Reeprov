import { NextRequest, NextResponse } from "next/server";
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

    const preview = await ProjectDeletionManager.previewDeletion(projectId);
    return NextResponse.json(preview);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
