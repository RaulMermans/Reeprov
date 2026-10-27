import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, AccessControlError } from "@/lib/auth/accessControl";
import { getCanonicalRun } from "@/lib/core/capture/persistence";
import { compareRuns, saveRunComparison, listRunComparisons } from "@/lib/core/comparison";
import { comparisonPolicySchema } from "@/lib/core/contracts/comparison";
import { assessImprovementClaim, type ImprovementClaim } from "@/lib/core/comparison/improvementClaim";
import { getEvaluationRun } from "@/lib/core/evals/persistence";
import { getReplayResult } from "@/lib/core/replay/persistence";

export async function GET(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
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
    if (error instanceof AccessControlError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const body = await request.json();
    const {
      baseline_run_id, candidate_run_id, enable_semantic, policy,
      baseline_evaluation_run_id, candidate_evaluation_run_id, baseline_replay_id,
    } = body;

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

    // Improvement is claimed only through the evidence gate, never from the
    // comparison verdict or a candidate's successful completion alone.
    let improvement_claim: ImprovementClaim | undefined;
    if (baseline_evaluation_run_id && candidate_evaluation_run_id) {
      const [be, ce, replay] = await Promise.all([
        getEvaluationRun(String(baseline_evaluation_run_id)),
        getEvaluationRun(String(candidate_evaluation_run_id)),
        baseline_replay_id ? getReplayResult(String(baseline_replay_id)) : Promise.resolve(null),
      ]);
      if (!be || !ce) {
        return NextResponse.json({ error: "Evaluation run not found." }, { status: 404 });
      }
      improvement_claim = assessImprovementClaim({
        baseline, candidate, comparison, baselineEvaluation: be, candidateEvaluation: ce, baselineReplay: replay ?? undefined,
      });
    }

    return NextResponse.json({ comparison, ...(improvement_claim ? { improvement_claim } : {}) });
  } catch (error) {
    if (error instanceof AccessControlError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
