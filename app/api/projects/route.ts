import { NextRequest, NextResponse } from "next/server";
import { ProjectStore } from "@/lib/projects/projectStore";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

export async function GET(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const projects = await ProjectStore.listProjects();
    return NextResponse.json({ projects, count: projects.length });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });
    const body = await request.json();

    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json(
        { error: "Project name is required." },
        { status: 400 }
      );
    }

    const { project, rawIngestKey } = await ProjectStore.createProject({
      id: body.id,
      name: body.name.trim(),
      description: body.description,
      language: body.language,
      framework: body.framework,
      defaultWorkflowId: body.defaultWorkflowId,
      repositoryUrl: body.repositoryUrl,
    });

    return NextResponse.json({ project, rawIngestKey }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
