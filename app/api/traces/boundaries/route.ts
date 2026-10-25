/**
 * POST /api/traces/boundaries
 *
 * Ingests replay-grade execution boundaries for a run.
 *
 * Auth: x-reeprov-key (REEPROV_INGEST_KEY or REEPROV_ACCESS_KEY)
 *
 * Body:
 *   boundaries: RawBoundaryInput[]
 */

import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { requireIngestAuth, getRunStore } from "@/lib/db/getStores";
import { captureBoundary } from "@/lib/core/capture/captureBoundary";
import { getCanonicalRun, saveCanonicalRun } from "@/lib/core/capture/persistence";
import type { RawBoundaryInput } from "@/lib/core/capture/types";

export async function POST(request: Request) {
  try {
    const auth = await requireIngestAuth(request, "POST /api/traces/boundaries");
    const body = (await request.json()) as Record<string, unknown>;
    const rawBoundaries = body["boundaries"];

    if (!Array.isArray(rawBoundaries)) {
      throw invalidRequest('Body must include a "boundaries" array.');
    }

    let accepted = 0;
    let rejected = 0;
    const errors: Array<{ boundary_id?: string; message: string }> = [];

    for (const raw of rawBoundaries) {
      const bInput = raw as RawBoundaryInput;
      if (!bInput.runId) {
        rejected++;
        errors.push({ message: 'Missing required "runId" on boundary.' });
        continue;
      }

      // Check run ownership / existence
      const run = await getRunStore().getRun(bInput.runId);
      const ownedByScope = !auth.integration || run?.runRecord.project_id === auth.integration.projectId;
      if (!run || !ownedByScope) {
        rejected++;
        errors.push({
          boundary_id: bInput.boundaryId,
          message: `Run "${bInput.runId}" not found or not owned by integration scope.`,
        });
        continue;
      }

      try {
        // The published SDK omits sequenceIndex and boundaryId. Assign both
        // from the stored run before normalization so repeated tool calls do
        // not overwrite the first boundary at sequence zero.
        const canonicalArtifact = await getCanonicalRun(bInput.runId);
        if (!canonicalArtifact) {
          throw new Error("Canonical run evidence is unavailable; boundary was not stored.");
        }
        const hasSequence = bInput.sequenceIndex !== undefined || bInput.sequence_index !== undefined;
        const nextSequence = canonicalArtifact.boundaries.reduce(
          (next, boundary) => Math.max(next, (boundary.sequence_index ?? 0) + 1), 0
        );
        const canonicalBoundary = await captureBoundary({
          ...bInput,
          sequenceIndex: hasSequence ? (bInput.sequenceIndex ?? bInput.sequence_index) : nextSequence,
        });

        // Link into canonical run artifact
          const existingIdx = canonicalArtifact.boundaries.findIndex(
            (b) => b.boundary_id === canonicalBoundary.boundary_id
          );
          if (existingIdx >= 0) {
            canonicalArtifact.boundaries[existingIdx] = canonicalBoundary;
          } else {
            canonicalArtifact.boundaries.push(canonicalBoundary);
          }
          canonicalArtifact.boundaries.sort(
            (a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0)
          );
          await saveCanonicalRun(canonicalArtifact);

        accepted++;
      } catch (err) {
        rejected++;
        errors.push({
          boundary_id: bInput.boundaryId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({ accepted, rejected, errors });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
