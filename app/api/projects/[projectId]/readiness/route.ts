import { NextRequest, NextResponse } from "next/server";
import { ProjectStore } from "@/lib/projects/projectStore";
import { computeCaptureReadiness } from "@/lib/projects/captureReadiness";
import { getCanonicalRun } from "@/lib/core/capture/persistence";
import { getRunStore } from "@/lib/db/getStores";
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

    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId") || project.stats.lastRunId;

    let canonicalRun = null;
    if (runId) {
      canonicalRun = await getCanonicalRun(runId);
    } else {
      const runs = await getRunStore().listRuns({ projectId, limit: 1 });
      if (runs.length > 0) {
        canonicalRun = await getCanonicalRun(runs[0].run_id);
      }
    }

    const report = await computeCaptureReadiness(canonicalRun);
    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
      },
      readiness: report,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
