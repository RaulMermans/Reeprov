import { NextRequest, NextResponse } from "next/server";
import {
  listCapabilitySnapshots,
  getCapabilitySnapshot,
} from "@/lib/core/capability/persistence";
import { CapabilitySnapshotEngine } from "@/lib/core/capability/snapshot";
import { getCanonicalRun } from "@/lib/core/capture/persistence";
import { listEvaluationRuns } from "@/lib/core/evals/persistence";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const snapshotId = searchParams.get("id");
    const agentId = searchParams.get("agent_id");

    if (snapshotId) {
      const snapshot = await getCapabilitySnapshot(snapshotId);
      if (!snapshot) {
        return NextResponse.json({ error: `Snapshot '${snapshotId}' not found.` }, { status: 404 });
      }
      return NextResponse.json({ snapshot });
    }

    let snapshots = await listCapabilitySnapshots();
    if (agentId) {
      snapshots = snapshots.filter((s) => s.agent_id === agentId);
    }

    return NextResponse.json({ snapshots });
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
    const {
      agent_id,
      agent_version = "1.0.0",
      configuration_hash = "config_hash",
      suite_id,
      suite_version = 1,
      dataset_id,
      dataset_version,
      run_id,
      project_id = "default_project",
      persist = true,
    } = body;

    if (!agent_id || !suite_id) {
      return NextResponse.json({ error: "agent_id and suite_id are required" }, { status: 400 });
    }

    let runArtifact;
    let evalRuns: any[] = [];
    if (run_id) {
      runArtifact = (await getCanonicalRun(run_id)) ?? undefined;
      const allEvals = await listEvaluationRuns();
      evalRuns = allEvals.filter((e) => e.target_run_ids?.includes(run_id));
    }

    const snapshot = await CapabilitySnapshotEngine.createSnapshot({
      projectId: project_id,
      agentId: agent_id,
      agentVersion: agent_version,
      configurationHash: runArtifact?.configuration_snapshot?.config_hash || configuration_hash,
      suiteId: suite_id,
      suiteVersion: suite_version,
      datasetId: dataset_id,
      datasetVersion: dataset_version,
      evalRuns,
      runArtifact,
      persist,
    });

    return NextResponse.json({ snapshot }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
