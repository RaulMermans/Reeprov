import { NextRequest, NextResponse } from "next/server";
import {
  listReleaseEvidenceSnapshots,
  getReleaseEvidenceSnapshot,
  getReleaseEvidenceByVersion,
} from "@/lib/core/releases/persistence";
import { ReleaseEvidenceEngine } from "@/lib/core/releases/snapshot";
import { getRegressionBaseline, getRegressionGateResult } from "@/lib/core/regression/persistence";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

export async function GET(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const { searchParams } = new URL(request.url);
    const releaseId = searchParams.get("id");
    const version = searchParams.get("version");
    const agentId = searchParams.get("agent_id");

    if (releaseId) {
      const snap = await getReleaseEvidenceSnapshot(releaseId);
      if (!snap) return NextResponse.json({ error: `Release evidence '${releaseId}' not found.` }, { status: 404 });
      return NextResponse.json({ releaseEvidence: snap });
    }

    if (version) {
      const snap = await getReleaseEvidenceByVersion(version);
      if (!snap) return NextResponse.json({ error: `Release version '${version}' not found.` }, { status: 404 });
      return NextResponse.json({ releaseEvidence: snap });
    }

    let releases = await listReleaseEvidenceSnapshots();
    if (agentId) {
      releases = releases.filter((r) => r.agent_id === agentId);
    }

    return NextResponse.json({ releases });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });
    const body = await request.json();
    const {
      release_version,
      agent_id,
      candidate_run_id,
      baseline_id,
      gate_result_id,
      capability_snapshot_id,
      policy_snapshot_id,
      git_sha,
      approved_by,
      persist = true,
    } = body;

    if (!release_version || !agent_id || !baseline_id || !gate_result_id) {
      return NextResponse.json(
        {
          error:
            "release_version, agent_id, baseline_id, and gate_result_id are required",
        },
        { status: 400 }
      );
    }

    const baseline = await getRegressionBaseline(baseline_id);
    if (!baseline) return NextResponse.json({ error: `Baseline '${baseline_id}' not found.` }, { status: 404 });

    const gateResult = await getRegressionGateResult(gate_result_id);
    if (!gateResult) return NextResponse.json({ error: `Gate result '${gate_result_id}' not found.` }, { status: 404 });

    const snapshot = await ReleaseEvidenceEngine.createSnapshot({
      projectId: baseline.project_id,
      releaseVersion: release_version,
      agentId: agent_id,
      gitSha: git_sha,
      configurationHash: gateResult.candidate_config_hash,
      capabilitySnapshotId: capability_snapshot_id ?? "cap_snap_initial",
      policySnapshotId: policy_snapshot_id ?? "pol_snap_initial",
      evalSuiteId: baseline.eval_suite_id,
      evalSuiteVersion: baseline.eval_suite_version,
      datasetId: baseline.dataset_id,
      datasetVersion: baseline.dataset_version,
      regressionGateResultId: gate_result_id,
      regressionGateStatus: gateResult.status,
      approvedBy: approved_by,
      status: gateResult.status === "PASS" ? "CANDIDATE" : "REJECTED",
      persist,
    });

    return NextResponse.json({ releaseEvidence: snapshot }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

