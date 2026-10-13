import { NextRequest, NextResponse } from "next/server";
import {
  getRegressionBaseline,
  getRegressionGatePolicy,
} from "@/lib/core/regression/persistence";
import { RegressionGateEngine } from "@/lib/core/regression/gate";
import { getCanonicalRun } from "@/lib/core/capture/persistence";
import { getEvalSuite } from "@/lib/core/evals/persistence";
import { evaluateRun } from "@/lib/core/evals/runner";
import { compareRuns } from "@/lib/core/comparison/comparator";
import {
  regressionGatePolicySchema,
  type RegressionGatePolicy,
} from "@/lib/core/contracts/regression";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

export async function POST(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });
    const body = await request.json();
    const {
      baseline_id,
      candidate_run_id,
      policy_id,
      custom_policy,
      persist = true,
    } = body;

    if (!baseline_id || !candidate_run_id) {
      return NextResponse.json(
        { error: "baseline_id and candidate_run_id are required" },
        { status: 400 }
      );
    }

    const baseline = await getRegressionBaseline(baseline_id);
    if (!baseline) {
      return NextResponse.json(
        { error: `Regression baseline '${baseline_id}' not found.` },
        { status: 404 }
      );
    }

    const candidateRun = await getCanonicalRun(candidate_run_id);
    if (!candidateRun) {
      return NextResponse.json(
        { error: `Candidate run '${candidate_run_id}' not found.` },
        { status: 404 }
      );
    }

    const baselineRun = baseline.run_id ? await getCanonicalRun(baseline.run_id) : undefined;
    const suite = await getEvalSuite(baseline.eval_suite_id, baseline.eval_suite_version);
    if (!suite) {
      return NextResponse.json(
        {
          error: `EvalSuite '${baseline.eval_suite_id}@${baseline.eval_suite_version}' associated with baseline was not found.`,
        },
        { status: 404 }
      );
    }

    // Evaluate runs against baseline suite
    const candidateEvalRun = await evaluateRun(candidateRun, suite, {
      datasetId: baseline.dataset_id,
      datasetVersion: baseline.dataset_version,
      persist,
    });

    const baselineEvalRun = baselineRun
      ? await evaluateRun(baselineRun, suite, {
          datasetId: baseline.dataset_id,
          datasetVersion: baseline.dataset_version,
          persist: false,
        })
      : undefined;

    // Resolve gate policy
    let policy: RegressionGatePolicy | null = null;
    if (custom_policy) {
      policy = regressionGatePolicySchema.parse(custom_policy);
    } else if (policy_id) {
      policy = await getRegressionGatePolicy(policy_id);
    }

    if (!policy) {
      policy = regressionGatePolicySchema.parse({
        policy_id: "default_release_policy",
        version: 1,
        name: "Standard Production Release Gate",
      });
    }

    // Compare runs if baseline run is available
    const comparison = baselineRun ? await compareRuns(baselineRun, candidateRun) : undefined;

    const { gateResult, report, artifact } = await RegressionGateEngine.evaluateGate({
      baseline,
      candidateRunId: candidateRun.identity.run_id,
      candidateConfigHash: candidateRun.configuration_snapshot?.config_hash || "cand_hash",
      candidateContext: {
        suite_id: suite.suite_id,
        suite_version: suite.version,
        dataset_id: baseline.dataset_id,
        dataset_version: baseline.dataset_version,
      },
      baselineEvalRun,
      candidateEvalRun,
      baselineArtifact: baselineRun ?? undefined,
      candidateArtifact: candidateRun,
      comparison: comparison ?? undefined,
      policy,
      persist,
    });

    return NextResponse.json({
      status: gateResult.status,
      exit_code: artifact.exit_code,
      gateResult,
      report,
      artifact,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
