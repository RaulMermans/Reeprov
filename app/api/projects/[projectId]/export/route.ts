import { NextRequest, NextResponse } from "next/server";
import { ProjectExporter } from "@/lib/projects/projectExport";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { projectId } = await params;
    await authorizeRequest(request, { capability: "DASHBOARD_READ", projectId });

    const bundle = await ProjectExporter.exportProject(projectId);
    return NextResponse.json(bundle);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
