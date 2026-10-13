/**
 * GET /api/runs/[runId]/lineage
 * Returns the lineage hierarchy (parent, root, ancestors, descendants) and materialized view for a run.
 *
 * Auth: x-agentpulse-key
 */

import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { authorizeRequest, AccessControlError } from "@/lib/auth/accessControl";
import { getCanonicalRun } from "@/lib/core/capture/persistence";
import {
  getParentRun,
  getRootRun,
  getAncestors,
  getChildren,
  getDescendants,
  materializeLineageView,
} from "@/lib/core/fork/lineage";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });
    const { runId } = await params;

    const canonical = await getCanonicalRun(runId);
    if (!canonical) {
      return NextResponse.json(
        { message: `Run "${runId}" not found.` },
        { status: 404 }
      );
    }

    const [parent, root, ancestors, children, descendants] = await Promise.all([
      getParentRun(runId),
      getRootRun(runId),
      getAncestors(runId),
      getChildren(runId),
      getDescendants(runId),
    ]);

    let materializedView = null;
    if (parent) {
      materializedView = materializeLineageView(parent, canonical);
    }

    return NextResponse.json({
      run_id: runId,
      parent_run_id: canonical.lineage?.parent_run_id ?? null,
      root_run_id: canonical.lineage?.root_run_id ?? runId,
      fork_checkpoint_id: canonical.lineage?.fork_checkpoint_id ?? null,
      fork_step_id: canonical.lineage?.fork_step_id ?? null,
      mutations: canonical.lineage?.mutations ?? [],
      ancestor_count: ancestors.length,
      children_count: children.length,
      descendant_count: descendants.length,
      ancestors: ancestors.map((a) => ({
        run_id: a.identity.run_id,
        created_at: a.identity.created_at,
        status: a.execution.status,
      })),
      children: children.map((c) => ({
        run_id: c.identity.run_id,
        fork_checkpoint_id: c.lineage?.fork_checkpoint_id,
        created_at: c.identity.created_at,
        status: c.execution.status,
      })),
      materialized_view: materializedView,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
