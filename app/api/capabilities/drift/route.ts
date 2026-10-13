import { NextRequest, NextResponse } from "next/server";
import {
  listCapabilityDriftReports,
  getCapabilityDriftReport,
  getCapabilitySnapshot,
  getCapabilityHistory,
} from "@/lib/core/capability/persistence";
import { CapabilityDriftEngine } from "@/lib/core/capability/drift";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { apiErrorResponse } from "@/lib/api/errors";

export async function GET(request: NextRequest) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const { searchParams } = new URL(request.url);
    const reportId = searchParams.get("id");
    const agentId = searchParams.get("agent_id");
    const history = searchParams.get("history");

    if (history && agentId) {
      const capHistory = await getCapabilityHistory(agentId);
      return NextResponse.json({ history: capHistory });
    }

    if (reportId) {
      const report = await getCapabilityDriftReport(reportId);
      if (!report) {
        return NextResponse.json({ error: `Drift report '${reportId}' not found.` }, { status: 404 });
      }
      return NextResponse.json({ report });
    }

    let reports = await listCapabilityDriftReports();
    if (agentId) {
      reports = reports.filter((r) => r.agent_id === agentId);
    }

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
      baseline_snapshot_id,
      candidate_snapshot_id,
      config_diff,
      experiment_isolated,
      persist = true,
    } = body;

    if (!baseline_snapshot_id || !candidate_snapshot_id) {
      return NextResponse.json(
        { error: "baseline_snapshot_id and candidate_snapshot_id are required" },
        { status: 400 }
      );
    }

    const baseline = await getCapabilitySnapshot(baseline_snapshot_id);
    if (!baseline) {
      return NextResponse.json(
        { error: `Baseline snapshot '${baseline_snapshot_id}' not found.` },
        { status: 404 }
      );
    }

    const candidate = await getCapabilitySnapshot(candidate_snapshot_id);
    if (!candidate) {
      return NextResponse.json(
        { error: `Candidate snapshot '${candidate_snapshot_id}' not found.` },
        { status: 404 }
      );
    }

    const report = await CapabilityDriftEngine.analyzeDrift({
      baselineSnapshot: baseline,
      candidateSnapshot: candidate,
      configDiff: config_diff,
      experimentIsolated: experiment_isolated,
      persist,
    });

    return NextResponse.json({ report });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

