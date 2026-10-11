/**
 * POST /api/runs/[runId]/fork
 * Creates a derived run from a specified historical checkpoint.
 *
 * Auth: x-agentpulse-key
 */

import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { getCanonicalRun } from "@/lib/core/capture/persistence";
import { ForkRuntime } from "@/lib/core/fork/runtime";
import type { ExperimentMutation } from "@/lib/core/contracts/lineage";
import type { ForkExecutionMode } from "@/lib/core/fork/contracts";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    requireAccessKey(request);
    const { runId } = await params;

    const source = await getCanonicalRun(runId);
    if (!source) {
      return NextResponse.json(
        { message: `Run "${runId}" not found.` },
        { status: 404 }
      );
    }

    const body = (await request.json()) as {
      checkpoint_id?: string;
      checkpointId?: string;
      mutations?: ExperimentMutation[];
      execution_mode?: ForkExecutionMode;
    };

    const checkpointId = body.checkpoint_id ?? body.checkpointId;
    if (!checkpointId) {
      return NextResponse.json(
        { message: "Missing required parameter 'checkpoint_id'." },
        { status: 400 }
      );
    }

    const runtime = new ForkRuntime(source, checkpointId, {
      mutations: body.mutations ?? [],
      executionMode: body.execution_mode ?? "SAFE_OFFLINE_FORK",
      persist: true,
    });

    const result = await runtime.fork();

    const statusCode = result.status === "COMPLETED" ? 200 : result.status === "BLOCKED" ? 403 : 400;
    return NextResponse.json(result, { status: statusCode });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
