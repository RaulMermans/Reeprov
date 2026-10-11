import { NextRequest, NextResponse } from "next/server";
import { getCanonicalRun } from "@/lib/core/capture/persistence";
import { compareRuns, saveRunComparison, listRunComparisons } from "@/lib/core/comparison";
import { comparisonPolicySchema } from "@/lib/core/contracts/comparison";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const baselineRunId = searchParams.get("baseline");
    const candidateRunId = searchParams.get("candidate");
    const projectId = searchParams.get("project_id");

    const comparisons = await listRunComparisons({
      baseline_run_id: baselineRunId ?? undefined,
      candidate_run_id: candidateRunId ?? undefined,
      project_id: projectId ?? undefined,
    });

    return NextResponse.json({ comparisons });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { baseline_run_id, candidate_run_id, enable_semantic, policy } = body;

    if (!baseline_run_id || !candidate_run_id) {
      return NextResponse.json(
        { error: "Both 'baseline_run_id' and 'candidate_run_id' are required." },
        { status: 400 }
      );
    }

    const baseline = await getCanonicalRun(baseline_run_id);
    if (!baseline) {
      return NextResponse.json(
        { error: `Baseline run '${baseline_run_id}' not found.` },
        { status: 404 }
      );
    }

    const candidate = await getCanonicalRun(candidate_run_id);
    if (!candidate) {
      return NextResponse.json(
        { error: `Candidate run '${candidate_run_id}' not found.` },
        { status: 404 }
      );
    }

    const parsedPolicy = policy ? comparisonPolicySchema.parse(policy) : undefined;

    const comparison = await compareRuns(baseline, candidate, {
      enableSemantic: Boolean(enable_semantic),
      policy: parsedPolicy,
    });

    await saveRunComparison(comparison);

    return NextResponse.json({ comparison });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
