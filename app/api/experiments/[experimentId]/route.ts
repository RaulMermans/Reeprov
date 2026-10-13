import { NextRequest, NextResponse } from "next/server";
import {
  getExperimentDefinition,
  getExperimentResult,
} from "@/lib/core/experiment/persistence";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ experimentId: string }> }
) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const { experimentId } = await context.params;
    const definition = await getExperimentDefinition(experimentId);
    const result = await getExperimentResult(experimentId);

    if (!definition && !result) {
      return NextResponse.json(
        { error: `Experiment '${experimentId}' not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      experiment: definition,
      result,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
