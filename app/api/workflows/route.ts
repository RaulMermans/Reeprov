/**
 * GET /api/workflows
 *
 * Lists workflow registry summaries.
 * Protected by AGENTPULSE_ACCESS_KEY (x-agentpulse-key header).
 *
 * Query params:
 *   ?projectId=...    filter by projectId
 *   ?source=...       filter by source (example|scan_reconstruction|manual|runtime_observed)
 *   ?status=...       filter by status (draft|active|needs_review|archived)
 *   ?confidence=...   filter by confidence (high|medium|low)
 *   ?workflowId=...   filter by workflowId
 *   ?limit=N          max results (default 50)
 */

import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { authorizeRequest, AccessControlError } from "@/lib/auth/accessControl";
import { getWorkflowStore } from "@/lib/db/getStores";
import type {
  WorkflowRegistrySource,
  WorkflowRegistryStatus,
  WorkflowRegistryConfidence,
} from "@/lib/workflows/workflowTypes";

export async function GET(request: Request) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_READ" });

    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const source = (url.searchParams.get("source") ?? undefined) as WorkflowRegistrySource | undefined;
    const status = (url.searchParams.get("status") ?? undefined) as WorkflowRegistryStatus | undefined;
    const confidence = (url.searchParams.get("confidence") ?? undefined) as WorkflowRegistryConfidence | undefined;
    const workflowId = url.searchParams.get("workflowId") ?? undefined;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.max(1, Math.min(200, parseInt(limitParam, 10))) : 50;

    const workflows = await getWorkflowStore().listWorkflows({
      projectId,
      source,
      status,
      confidence,
      workflowId,
      limit,
    });

    return NextResponse.json({ workflows, count: workflows.length });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
