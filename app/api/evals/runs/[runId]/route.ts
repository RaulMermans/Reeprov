import { NextRequest, NextResponse } from "next/server";
import { getEvaluationRun } from "@/lib/core/evals/persistence";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  try {
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
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
