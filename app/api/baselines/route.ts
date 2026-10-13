import { NextRequest, NextResponse } from "next/server";
import {
  listRegressionBaselines,
  getRegressionBaseline,
} from "@/lib/core/regression/persistence";
import { BaselineManager } from "@/lib/core/regression/baseline";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const baselineId = searchParams.get("id");
    const agentId = searchParams.get("agent_id");
    const projectId = searchParams.get("project_id");

    if (baselineId) {
      const baseline = await getRegressionBaseline(baselineId);
      if (!baseline) {
        return NextResponse.json({ error: `Baseline '${baselineId}' not found.` }, { status: 404 });
      }
      return NextResponse.json({ baseline });
    }

    let baselines = await listRegressionBaselines();
    if (agentId) {
      baselines = baselines.filter((b) => b.agent_id === agentId);
    }
    if (projectId) {
      baselines = baselines.filter((b) => b.project_id === projectId);
    }

    return NextResponse.json({ baselines });
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
    const action = body.action || "create";

    if (action === "revoke") {
      if (!body.baseline_id) {
        return NextResponse.json({ error: "baseline_id required for revoke" }, { status: 400 });
      }
      const updated = await BaselineManager.revokeBaseline(
        body.baseline_id,
        body.revoked_by ?? "api_user",
        body.reason ?? "Revoked via API"
      );
      return NextResponse.json({ baseline: updated });
    }

    if (action === "supersede") {
      if (!body.previous_baseline_id || !body.candidate_run_id) {
        return NextResponse.json(
          { error: "previous_baseline_id and candidate_run_id required for supersede" },
          { status: 400 }
        );
      }
      const { previous, next } = await BaselineManager.supersedeBaseline(
        body.previous_baseline_id,
        {
          projectId: body.project_id ?? "default_project",
          agentId: body.agent_id,
          runId: body.candidate_run_id,
          configurationHash: body.candidate_config_hash ?? "cand_hash",
          evalSuiteId: body.eval_suite_id,
          evalSuiteVersion: body.eval_suite_version ?? 1,
          datasetId: body.dataset_id,
          datasetVersion: body.dataset_version,
          approvedBy: body.approved_by,
          label: body.label,
          releaseVersion: body.release_version,
        },
        body.reason
      );
      return NextResponse.json({ previous, baseline: next }, { status: 201 });
    }

    // Default: create baseline
    const baseline = await BaselineManager.createBaseline({
      projectId: body.project_id ?? "default_project",
      agentId: body.agent_id,
      runId: body.run_id,
      configurationHash: body.configuration_hash ?? "initial_hash",
      evalSuiteId: body.eval_suite_id,
      evalSuiteVersion: body.eval_suite_version ?? 1,
      datasetId: body.dataset_id,
      datasetVersion: body.dataset_version,
      approvedBy: body.approved_by,
      label: body.label,
      releaseVersion: body.release_version,
    });

    return NextResponse.json({ baseline }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
