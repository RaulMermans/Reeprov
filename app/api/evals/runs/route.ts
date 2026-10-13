import { NextRequest, NextResponse } from "next/server";
import {
  listEvaluationRuns,
  getEvalSuite,
} from "@/lib/core/evals/persistence";
import { evaluateRun } from "@/lib/core/evals/runner";
import { getCanonicalRun } from "@/lib/core/capture/persistence";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

export async function GET(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const runs = await listEvaluationRuns();
    return NextResponse.json({ evaluation_runs: runs });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });
    const body = await request.json();
    const { run_id, suite_id, suite_version } = body;

    if (!run_id || !suite_id) {
      return NextResponse.json(
        { error: "run_id and suite_id are required." },
        { status: 400 }
      );
    }

    const artifact = await getCanonicalRun(run_id);
    if (!artifact) {
      return NextResponse.json(
        { error: `Run '${run_id}' not found.` },
        { status: 404 }
      );
    }

    const version = suite_version ? parseInt(String(suite_version), 10) : 1;
    const suite = await getEvalSuite(suite_id, version);
    if (!suite) {
      return NextResponse.json(
        { error: `Suite '${suite_id}@${version}' not found.` },
        { status: 404 }
      );
    }

    const evaluationRun = await evaluateRun(artifact, suite);
    return NextResponse.json({ evaluation_run: evaluationRun }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
