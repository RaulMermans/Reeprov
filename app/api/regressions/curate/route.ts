import { NextRequest, NextResponse } from "next/server";
import { RegressionCaseCuration } from "@/lib/core/regression/curation";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

export async function POST(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });
    const body = await request.json();
    const {
      run_id,
      dataset_id,
      dataset_version,
      case_name,
      expected_behavior,
      failure_category = "TASK_FAILURE",
      curated_by = "dashboard_user",
      source_incident,
      tags,
    } = body;

    if (!run_id || !dataset_id || !case_name) {
      return NextResponse.json(
        { error: "run_id, dataset_id, and case_name are required." },
        { status: 400 }
      );
    }

    const evalCase = await RegressionCaseCuration.curateFailureAsRegressionCase({
      runId: run_id,
      datasetId: dataset_id,
      datasetVersion: dataset_version ?? 1,
      caseName: case_name,
      expectedBehavior: expected_behavior,
      failureCategory: failure_category,
      curatedBy: curated_by,
      sourceIncident: source_incident,
      tags,
    });

    return NextResponse.json({ evalCase }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
