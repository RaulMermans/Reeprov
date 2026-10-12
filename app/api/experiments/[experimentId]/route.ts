import { NextRequest, NextResponse } from "next/server";
import {
  getExperimentDefinition,
  getExperimentResult,
} from "@/lib/core/experiment/persistence";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ experimentId: string }> }
) {
  try {
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
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
