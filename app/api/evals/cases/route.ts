import { NextRequest, NextResponse } from "next/server";
import { saveRunAsEvalCase } from "@/lib/core/evals/persistence";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { run_id, dataset_id, dataset_version, case_name, checkpoint_id, expected, tags } = body;

    if (!run_id || !dataset_id || !case_name) {
      return NextResponse.json(
        { error: "run_id, dataset_id, and case_name are required." },
        { status: 400 }
      );
    }

    const evalCase = await saveRunAsEvalCase(run_id, {
      datasetId: dataset_id,
      datasetVersion: dataset_version,
      caseName: case_name,
      checkpointId: checkpoint_id,
      expected,
      tags,
    });

    return NextResponse.json({ case: evalCase }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
