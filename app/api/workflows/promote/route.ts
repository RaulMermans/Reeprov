/**
 * POST /api/workflows/promote
 *
 * Promotes a SuggestedWorkflowSpec or inline WorkflowSpec into the Workflow Registry.
 * Protected by AGENTPULSE_ACCESS_KEY (x-agentpulse-key header).
 *
 * Input options (one of):
 *   A. { reportId, workflowId }                  — load report, reconstruct, find spec by workflowId
 *   B. { reportId, reconstructionId, workflowId } — same, with reconstruction provenance
 *   C. { spec: WorkflowSpec, metadata: {...} }    — inline spec with metadata
 *
 * Status assignment:
 *   - active:       high confidence AND no missing critical fields
 *   - needs_review: medium/low confidence OR missing fields present
 *   - draft:        manually provided spec with empty missingFields or explicit request
 *
 * Returns:
 *   { ok: true, registryId, redirectTo: "/dashboard/workflows/registry/{registryId}" }
 */

import { NextResponse } from "next/server";
import { apiErrorResponse, invalidRequest } from "@/lib/api/errors";
import { requireAccessKey } from "@/lib/auth/requireAccessKey";
import { getReportStore, getWorkflowStore } from "@/lib/db/getStores";
import { reconstructFromScanReport } from "@/lib/reconstruction/reconstructWorkflowSpec";
import { workflowSpecSchema } from "@/lib/proof-layer/schemas";
import type {
  WorkflowRegistryConfidence,
  WorkflowRegistrySource,
  WorkflowRegistryStatus,
} from "@/lib/workflows/workflowTypes";
import type { SuggestedWorkflowSpec } from "@/lib/reconstruction/types";

function assignStatus(
  confidence: WorkflowRegistryConfidence,
  missingFields: string[],
  source: WorkflowRegistrySource,
): WorkflowRegistryStatus {
  if (source === "manual" || source === "example") return "draft";
  if (confidence === "high" && missingFields.length === 0) return "active";
  return "needs_review";
}

export async function POST(request: Request) {
  try {
    requireAccessKey(request);

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw invalidRequest("Body must be valid JSON.");
    }

    if (!body || typeof body !== "object") {
      throw invalidRequest("Body must be a JSON object.");
    }

    // ── Path C: inline spec + metadata ───────────────────────────────────────

    if (body["spec"] && body["metadata"]) {
      const specParse = workflowSpecSchema.safeParse(body["spec"]);
      if (!specParse.success) {
        return NextResponse.json(
          {
            error: "invalid_spec",
            message: "The provided spec does not match the WorkflowSpec schema.",
            issues: specParse.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
            recoverable: true,
          },
          { status: 400 },
        );
      }

      const meta = body["metadata"] as Record<string, unknown>;
      const projectId = (meta["projectId"] as string | undefined) ?? "proj_unknown";
      const projectName = (meta["projectName"] as string | undefined) ?? specParse.data.name;
      const source = ((meta["source"] as string | undefined) ?? "manual") as WorkflowRegistrySource;
      const confidence = ((meta["confidence"] as string | undefined) ?? "low") as WorkflowRegistryConfidence;
      const sourceReportId = meta["sourceReportId"] as string | undefined;
      const evidencePaths = Array.isArray(meta["evidencePaths"]) ? (meta["evidencePaths"] as string[]) : [];
      const missingFields = Array.isArray(meta["missingFields"]) ? (meta["missingFields"] as string[]) : [];
      const status = assignStatus(confidence, missingFields, source);

      const saved = await getWorkflowStore().saveWorkflow({
        workflowId: specParse.data.workflow_id,
        projectId,
        projectName,
        name: specParse.data.name,
        source,
        confidence,
        status,
        sourceReportId,
        evidencePaths,
        missingFields,
        spec: specParse.data,
      });

      return NextResponse.json({
        ok: true,
        registryId: saved.registryId,
        redirectTo: `/dashboard/workflows/registry/${saved.registryId}`,
      });
    }

    // ── Paths A & B: from saved report + reconstruction ───────────────────────

    const reportId = typeof body["reportId"] === "string" ? body["reportId"] : null;
    const workflowId = typeof body["workflowId"] === "string" ? body["workflowId"] : null;

    if (!reportId) {
      throw invalidRequest('Provide "reportId" (with optional "workflowId") or "spec" + "metadata".');
    }

    const savedReport = await getReportStore().getReport(reportId);
    if (!savedReport) {
      return NextResponse.json(
        { message: `Report "${reportId}" not found.` },
        { status: 404 },
      );
    }

    const reconstruction = reconstructFromScanReport(savedReport);

    let targetSpec: SuggestedWorkflowSpec | null = null;

    if (workflowId) {
      targetSpec = reconstruction.workflowSpecs.find((s) => s.workflow_id === workflowId) ?? null;
      if (!targetSpec) {
        return NextResponse.json(
          { message: `Workflow "${workflowId}" not found in reconstruction for report "${reportId}".` },
          { status: 404 },
        );
      }
    } else {
      // Default to first spec if only one exists.
      if (reconstruction.workflowSpecs.length === 0) {
        return NextResponse.json(
          { message: "No WorkflowSpec was generated from this report. Not enough AI evidence detected." },
          { status: 400 },
        );
      }
      if (reconstruction.workflowSpecs.length > 1) {
        throw invalidRequest(
          `Report has ${reconstruction.workflowSpecs.length} workflow specs. Provide "workflowId" to select one.`,
        );
      }
      targetSpec = reconstruction.workflowSpecs[0]!;
    }

    const specParse = workflowSpecSchema.safeParse(targetSpec);
    if (!specParse.success) {
      return NextResponse.json(
        {
          error: "invalid_spec",
          message: "The reconstructed WorkflowSpec is invalid and cannot be promoted.",
          issues: specParse.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
          recoverable: true,
        },
        { status: 400 },
      );
    }

    const confidence: WorkflowRegistryConfidence = targetSpec.confidence;
    const missingFields = targetSpec.missingFields ?? [];
    const source: WorkflowRegistrySource = "scan_reconstruction";
    const status = assignStatus(confidence, missingFields, source);
    const reconstructionId = typeof body["reconstructionId"] === "string" ? body["reconstructionId"] : reconstruction.reconstructionId;

    const saved = await getWorkflowStore().saveWorkflow({
      workflowId: specParse.data.workflow_id,
      projectId: savedReport.projectId ?? `proj_${savedReport.repoName ?? "unknown"}`,
      projectName: savedReport.repoName ?? savedReport.projectId ?? "Unknown project",
      name: specParse.data.name,
      source,
      confidence,
      status,
      sourceReportId: reportId,
      sourceReconstructionId: reconstructionId,
      evidencePaths: targetSpec.evidencePaths ?? [],
      missingFields,
      missingLinks: reconstruction.missingLinks,
      spec: specParse.data,
    });

    return NextResponse.json({
      ok: true,
      registryId: saved.registryId,
      redirectTo: `/dashboard/workflows/registry/${saved.registryId}`,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
