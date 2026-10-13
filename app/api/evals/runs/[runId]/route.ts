import { NextRequest, NextResponse } from "next/server";
import { getEvaluationRun } from "@/lib/core/evals/persistence";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const { runId } = await context.params;
    const run = await getEvaluationRun(runId);
    if (!run) {
      return NextResponse.json(
        { error: `Evaluation run '${runId}' not found.` },
        { status: 404 }
      );
    }
    return NextResponse.json({ evaluation_run: run });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
