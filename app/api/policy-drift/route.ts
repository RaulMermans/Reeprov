import { NextRequest, NextResponse } from "next/server";
import {
  listPolicyDriftReports,
  getPolicyDriftReport,
  getPolicyBehaviorSnapshot,
  savePolicyBehaviorSnapshot,
} from "@/lib/core/policyDrift/persistence";
import { PolicySnapshotEngine } from "@/lib/core/policyDrift/snapshot";
import { PolicyDriftDetector } from "@/lib/core/policyDrift/detector";
import { getCanonicalRun } from "@/lib/core/capture/persistence";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

export async function GET(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const { searchParams } = new URL(request.url);
    const reportId = searchParams.get("id");

    if (reportId) {
      const report = await getPolicyDriftReport(reportId);
      if (!report) {
        return NextResponse.json({ error: `Policy drift report '${reportId}' not found.` }, { status: 404 });
      }
      return NextResponse.json({ report });
    }

    const reports = await listPolicyDriftReports();
    return NextResponse.json({ reports });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });
    const body = await request.json();
    const {
      baseline_run_id,
      candidate_run_id,
      baseline_snapshot_id,
      candidate_snapshot_id,
      policy_id = "default_policy",
      policy_version = 1,
      persist = true,
    } = body;

    let baselineSnap;
    let candidateSnap;

    if (baseline_snapshot_id && candidate_snapshot_id) {
      baselineSnap = await getPolicyBehaviorSnapshot(baseline_snapshot_id);
      candidateSnap = await getPolicyBehaviorSnapshot(candidate_snapshot_id);
    } else if (baseline_run_id && candidate_run_id) {
      const bRun = await getCanonicalRun(baseline_run_id);
      const cRun = await getCanonicalRun(candidate_run_id);
      if (!bRun) return NextResponse.json({ error: `Baseline run '${baseline_run_id}' not found.` }, { status: 404 });
      if (!cRun) return NextResponse.json({ error: `Candidate run '${candidate_run_id}' not found.` }, { status: 404 });

      baselineSnap = await PolicySnapshotEngine.captureSnapshot({
        projectId: bRun.identity.project_id ?? "default_project",
        runArtifact: bRun,
        policyId: policy_id,
        policyVersion: policy_version,
        persist,
      });
      candidateSnap = await PolicySnapshotEngine.captureSnapshot({
        projectId: cRun.identity.project_id ?? "default_project",
        runArtifact: cRun,
        policyId: policy_id,
        policyVersion: policy_version,
        persist,
      });
    } else {
      return NextResponse.json(
        { error: "Provide either (baseline_snapshot_id, candidate_snapshot_id) or (baseline_run_id, candidate_run_id)" },
        { status: 400 }
      );
    }

    if (!baselineSnap || !candidateSnap) {
      return NextResponse.json({ error: "Could not resolve baseline or candidate policy snapshots." }, { status: 404 });
    }

    const report = await PolicyDriftDetector.detect({
      baselineSnapshot: baselineSnap,
      candidateSnapshot: candidateSnap,
      persist,
    });

    return NextResponse.json({ report });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

