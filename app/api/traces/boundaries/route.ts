/**
 * POST /api/traces/boundaries
 *
 * Ingests replay-grade execution boundaries for one or more runs.
 *
 * Auth: x-reeprov-key (REEPROV_INGEST_KEY or REEPROV_ACCESS_KEY)
 *
 * Body:
 *   boundaries: RawBoundaryInput[]
 *
 * Response: per-record accounting (see lib/core/capture/ingestBoundaries.ts).
 *   200 all records succeeded · 207 some rejected · 422 all rejected.
 * Clients must check `rejected` / `results`, never the HTTP status alone.
 */

import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { requireIngestAuth, getRunStore } from "@/lib/db/getStores";
import {
  ingestBoundariesForRun,
  ingestHttpStatus,
  summarizeIngest,
  type BoundaryIngestResult,
} from "@/lib/core/capture/ingestBoundaries";

export async function POST(request: Request) {
  try {
    const auth = await requireIngestAuth(request, "POST /api/traces/boundaries");
    const body = (await request.json()) as Record<string, unknown>;
    const rawBoundaries = body["boundaries"];

    if (!Array.isArray(rawBoundaries)) {
      throw invalidRequest('Body must include a "boundaries" array.');
    }

    const results: BoundaryIngestResult[] = [];
    const byRun = new Map<string, Array<{ index: number; raw: Record<string, unknown> }>>();
    rawBoundaries.forEach((item, index) => {
      const raw = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const runId = raw["runId"] ?? raw["run_id"];
      if (typeof runId !== "string" || runId.length === 0) {
        results.push({ index, status: "REJECTED", code: "MISSING_RUN_ID", message: 'Missing required "runId" on boundary.' });
        return;
      }
      byRun.set(runId, [...(byRun.get(runId) ?? []), { index, raw }]);
    });

    for (const [runId, records] of byRun) {
      const run = await getRunStore().getRun(runId);
      const ownedByScope = !auth.integration || run?.runRecord.project_id === auth.integration.projectId;
      if (!run || !ownedByScope) {
        for (const { index, raw } of records) {
          results.push({
            index, run_id: runId, boundary_id: (raw["boundaryId"] ?? raw["boundary_id"]) as string | undefined,
            status: "REJECTED", code: "RUN_NOT_FOUND",
            message: `Run "${runId}" not found or not owned by integration scope.`,
          });
        }
        continue;
      }
      try {
        results.push(...(await ingestBoundariesForRun(runId, records, { legacyRun: run })));
      } catch (err) {
        for (const { index } of records) {
          results.push({
            index, run_id: runId, status: "REJECTED", code: "PERSISTENCE_FAILED",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const summary = summarizeIngest(results);
    return NextResponse.json(summary, { status: ingestHttpStatus(summary) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
