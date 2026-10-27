/**
 * POST /api/runs/[runId]/forks
 *
 * Stores a child run produced by the developer-side host runner
 * (`reeprov host-fork --upload`). The server never executes host code; it
 * verifies lineage, the checkpoint's state validity, adapter identity, the
 * resume proof (execution started at the checkpoint's resume step and the
 * prefix was not re-executed), prefix non-duplication and the absence of
 * live side effects before persisting the child.
 *
 * Auth: x-reeprov-key (dashboard write)
 */

import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { authorizeRequest } from "@/lib/auth/accessControl";
import { getCanonicalRun, saveCanonicalRun } from "@/lib/core/capture/persistence";
import { capturePolicyForRun } from "@/lib/core/capture/runPolicy";
import { sanitizeCanonicalRecord } from "@/lib/core/capture/redaction";
import { canonicalJsonStringify } from "@/lib/core/capture/hashing";
import { runArtifactSchema } from "@/lib/core/contracts/runArtifact";
import { validateUploadedFork } from "@/lib/core/external/hostRunner";
import { assessCheckpoint, verifiedResumesFrom } from "@/lib/core/fork/restorability";
import { getChildren } from "@/lib/core/fork/lineage";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    await authorizeRequest(request, { capability: "DASHBOARD_WRITE" });
    const { runId } = await params;
    const body = (await request.json()) as { child_artifact?: unknown };
    const parsed = runArtifactSchema.safeParse(body.child_artifact);
    if (!parsed.success) throw invalidRequest(`Invalid child artifact: ${parsed.error.issues.map((i) => i.message).join("; ")}`);

    const parent = await getCanonicalRun(runId);
    if (!parent) return NextResponse.json({ message: `Run "${runId}" not found.` }, { status: 404 });

    const child = sanitizeCanonicalRecord(parsed.data, capturePolicyForRun(parent));
    const validation = validateUploadedFork(parent, child);
    if (!validation.ok) return NextResponse.json({ status: "REJECTED", errors: validation.errors }, { status: 422 });

    const existing = await getCanonicalRun(child.identity.run_id);
    if (existing) {
      if (canonicalJsonStringify(existing) === canonicalJsonStringify(child)) {
        return NextResponse.json({ status: "DUPLICATE", derived_run_id: child.identity.run_id }, { status: 200 });
      }
      return NextResponse.json(
        { status: "REJECTED", errors: [`RUN_ID_CONFLICT: run "${child.identity.run_id}" already exists.`] },
        { status: 409 },
      );
    }

    await saveCanonicalRun(child);
    const assessment = assessCheckpoint(parent, validation.checkpoint, {
      verifiedResumes: verifiedResumesFrom(await getChildren(runId)),
    });
    return NextResponse.json(
      { status: "STORED", derived_run_id: child.identity.run_id, parent_run_id: runId, checkpoint_assessment: assessment },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
